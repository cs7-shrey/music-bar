import { createHash, randomBytes } from 'crypto'
import { createServer, type Server } from 'http'
import { net, safeStorage, shell } from 'electron'
import type { SearchSong } from '../shared/ipc'
import { getSettings, updateSettings } from './settings'
import { describe, logger } from './log'

// The user's Spotify account, through Spotify's Web API: search, and adding
// to the queue. The desktop app's own interfaces (spotify.ts) can play a
// track but can't search or queue one.
//
// The Web API needs an app registered at developer.spotify.com. Music Bar
// has no servers, so each user registers their own (a minute's work, which
// Settings → Spotify walks through) and gives Music Bar its Client ID.
// Signing in is OAuth's authorization code flow with PKCE, which needs no
// client secret: the browser opens Spotify's sign-in page and comes back to
// a one-off server on 127.0.0.1.

const log = logger('spotify-account')

const PORT = 43117
export const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`
// Searching needs no scope; queueing reads and changes the player.
const SCOPES = ['user-read-playback-state', 'user-modify-playback-state']
const SIGN_IN_TIMEOUT_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 8000
const MAX_SONGS = 5

const CLIENT_ID = /^[0-9a-f]{32}$/i

let accessToken: { value: string; expiresAt: number } | null = null

const base64url = (buffer: Buffer) => buffer.toString('base64url')

/**
 * Whether safeStorage really encrypts: the system keyring (macOS Keychain,
 * libsecret or KWallet on Linux). Without a keyring Linux falls back to
 * 'basic_text', a fixed key that protects nothing.
 */
const canEncrypt = () =>
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')

function storeRefreshToken(refreshToken: string): Pick<NonNullable<ReturnType<typeof getSettings>['spotifyAccount']>, 'refreshToken' | 'encrypted'> {
    // Otherwise it's kept as is, in settings.json, which only this user can
    // read (settings.ts).
    if (canEncrypt()) {
        return { refreshToken: safeStorage.encryptString(refreshToken).toString('base64'), encrypted: true }
    }
    return { refreshToken: Buffer.from(refreshToken).toString('base64'), encrypted: false }
}

function readRefreshToken(): string | null {
    const account = getSettings().spotifyAccount
    if (!account) return null
    const bytes = Buffer.from(account.refreshToken, 'base64')
    try {
        return account.encrypted ? safeStorage.decryptString(bytes) : bytes.toString()
    } catch (error) {
        log.warn(`couldn't read the saved sign-in: ${describe(error)}`)
        return null
    }
}

async function tokenRequest(clientId: string, body: Record<string, string>): Promise<{
    access_token: string
    expires_in: number
    refresh_token?: string
}> {
    const response = await net.fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, ...body }).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(json.error_description || json.error || `Spotify sign-in failed (${response.status})`)
    return json
}

/** A current access token, refreshed when it's about to run out. */
async function token(): Promise<string> {
    if (accessToken && accessToken.expiresAt > Date.now() + 30_000) return accessToken.value
    const account = getSettings().spotifyAccount
    const refreshToken = readRefreshToken()
    if (!account || !refreshToken) throw new Error('Connect your Spotify account in Settings → Spotify first')
    const result = await tokenRequest(account.clientId, { grant_type: 'refresh_token', refresh_token: refreshToken })
    accessToken = { value: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 }
    // Spotify may rotate the refresh token. Re-read: the user may have
    // disconnected while this was on its way, and that must stick.
    const current = getSettings().spotifyAccount
    if (current && result.refresh_token && result.refresh_token !== refreshToken) {
        updateSettings({ spotifyAccount: { ...current, ...storeRefreshToken(result.refresh_token) } })
    }
    return accessToken.value
}

async function api<T>(path: string, init: { method?: string } = {}): Promise<T | null> {
    const response = await net.fetch(`https://api.spotify.com/v1/${path}`, {
        method: init.method ?? 'GET',
        headers: { Authorization: `Bearer ${await token()}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (response.status === 401) accessToken = null
    if (!response.ok) {
        const json = await response.json().catch(() => ({}))
        const reason = json.error?.reason
        if (reason === 'PREMIUM_REQUIRED') throw new Error('Spotify only lets Premium accounts change the queue')
        if (reason === 'NO_ACTIVE_DEVICE') throw new Error('Start playing in Spotify first')
        throw new Error(json.error?.message || `Spotify said no (${response.status})`)
    }
    const text = await response.text()
    return text ? (JSON.parse(text) as T) : null
}

export const isConnected = () => getSettings().spotifyAccount !== null

// The sign-in under way: its server, and how to call it off.
let signingIn: { server: Server; cancel: (reason: string) => void } | null = null

/**
 * Signs in with the user's own Spotify app: opens Spotify's sign-in page in
 * the browser and waits for it to come back to REDIRECT_URI.
 */
export async function connect(clientId: string): Promise<void> {
    const id = typeof clientId === 'string' ? clientId.trim() : ''
    if (!CLIENT_ID.test(id)) throw new Error('A Client ID is 32 letters and digits, from your app in the Spotify dashboard')
    signingIn?.cancel('A newer sign-in took over')

    const verifier = base64url(randomBytes(64))
    const challenge = base64url(createHash('sha256').update(verifier).digest())
    const state = base64url(randomBytes(16))

    const code = await new Promise<string>((resolve, reject) => {
        const server = createServer((request, response) => {
            const url = new URL(request.url ?? '/', REDIRECT_URI)
            if (url.pathname !== '/callback') {
                response.writeHead(404).end()
                return
            }
            const finish = (ok: boolean, message: string) => {
                response.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
                response.end(
                    `<!doctype html><title>Music Bar</title><body style="font:16px system-ui;background:#121212;color:#fff;display:grid;place-items:center;height:90vh"><p>${message}</p></body>`,
                )
                server.close()
            }
            // Not this sign-in's answer (an old link, or a page poking at the
            // port): turned away, and the real one is still awaited.
            if (url.searchParams.get('state') !== state) {
                response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
                response.end('This sign-in link is out of date. Try again from Music Bar.')
                return
            }
            const error = url.searchParams.get('error')
            const received = url.searchParams.get('code')
            if (error || !received) {
                finish(false, 'Spotify sign-in was cancelled. You can close this tab.')
                return reject(new Error(error === 'access_denied' ? 'Sign-in was cancelled' : `Spotify said: ${error}`))
            }
            finish(true, 'Music Bar is connected to Spotify. You can close this tab.')
            resolve(received)
        })
        const cancel = (reason: string) => {
            server.close()
            reject(new Error(reason))
        }
        signingIn = { server, cancel }
        const timer = setTimeout(() => cancel('Sign-in took too long; try again'), SIGN_IN_TIMEOUT_MS)
        server.on('close', () => {
            clearTimeout(timer)
            if (signingIn?.server === server) signingIn = null
        })
        server.on('error', (error) => reject(new Error(`Couldn't wait for Spotify on port ${PORT}: ${error.message}`)))
        server.listen(PORT, '127.0.0.1', () => {
            const authorize = new URL('https://accounts.spotify.com/authorize')
            authorize.search = new URLSearchParams({
                client_id: id,
                response_type: 'code',
                redirect_uri: REDIRECT_URI,
                code_challenge_method: 'S256',
                code_challenge: challenge,
                scope: SCOPES.join(' '),
                state,
            }).toString()
            void shell.openExternal(authorize.toString())
        })
    })

    const result = await tokenRequest(id, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
    })
    if (!result.refresh_token) throw new Error('Spotify gave no lasting sign-in; try again')
    accessToken = { value: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 }
    updateSettings({ spotifyAccount: { clientId: id, ...storeRefreshToken(result.refresh_token), displayName: null } })
    const me = await api<{ display_name?: string; id: string }>('me').catch(() => null)
    updateSettings({ spotifyAccount: { ...getSettings().spotifyAccount!, displayName: me?.display_name ?? me?.id ?? null } })
    log.info('connected')
}

export function disconnect(): void {
    accessToken = null
    updateSettings({ spotifyAccount: null })
    log.info('disconnected')
}

interface SpotifyTrack {
    id: string
    name: string
    is_playable?: boolean
    artists: { name: string }[]
    album: { images: { url: string; width: number }[] }
}

/** Songs for a query, best first. */
export async function searchTracks(query: string): Promise<SearchSong[]> {
    if (!isConnected()) throw new Error('Connect your Spotify account in Settings → Spotify to search Spotify')
    const params = new URLSearchParams({ q: query, type: 'track', limit: String(MAX_SONGS) })
    const result = await api<{ tracks: { items: (SpotifyTrack | null)[] } }>(`search?${params}`)
    return (result?.tracks.items ?? []).flatMap((track) => {
        if (!track || track.is_playable === false) return []
        // The smallest picture that's still sharp on the 40px row.
        const images = [...track.album.images].sort((a, b) => a.width - b.width)
        return [
            {
                service: 'spotify' as const,
                id: track.id,
                title: track.name,
                artist: track.artists.map((artist) => artist.name).join(', '),
                kind: 'song' as const,
                thumbnailUrl: (images.find((image) => image.width >= 80) ?? images.at(-1))?.url ?? null,
            },
        ]
    })
}

/** Adds a track after the current one (Spotify Premium). */
export async function addToQueue(id: string): Promise<void> {
    if (!isConnected()) throw new Error('Connect your Spotify account in Settings → Spotify to queue songs')
    await api(`me/player/queue?${new URLSearchParams({ uri: `spotify:track:${id}` })}`, { method: 'POST' })
}
