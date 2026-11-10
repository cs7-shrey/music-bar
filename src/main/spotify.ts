import { execFile, spawn } from 'child_process'
import { existsSync, statSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'
import type { PlayerControl, RepeatMode, SpotifySource, SpotifyState, Track } from '../shared/ipc'
import { describe, logger } from './log'

// Reads and controls the Spotify desktop app, the way youtube-music.ts does
// a YouTube Music tab. On Linux through MPRIS, the D-Bus interface Spotify
// publishes for media keys (org.mpris.MediaPlayer2.spotify), via busctl. On
// macOS through Spotify's AppleScript dictionary, which asks the user for
// Automation permission once, as for browsers.
//
// Search and the queue aren't part of either; they go through Spotify's Web
// API (spotify-account.ts).

const log = logger('spotify')

const SOURCE: SpotifySource = { service: 'spotify' }
export const SPOTIFY_TRACK_ID = /^[0-9A-Za-z]{22}$/

const isMac = process.platform === 'darwin'

/** What a read found. */
export type SpotifyRead = { state: 'ready'; track: Track | null } | { state: Exclude<SpotifyState, 'ready'>; message?: string }

function run(file: string, args: string[], timeoutMs = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(file, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
            if (error) reject(new Error(stderr.trim() || error.message))
            else resolve(stdout.trim())
        })
    })
}

// What the loop was before Music Bar looped one song, so turning it off
// puts that back (as youtube-music.ts does per tab).
let modeBeforeLoop: RepeatMode = 'NONE'

interface Platform {
    installed(): boolean
    launch(): void
    read(): Promise<SpotifyRead>
    setPlaying(playing: boolean): Promise<void>
    control(action: PlayerControl): Promise<void>
    /** Null where looping one song can't be done. */
    setRepeat: ((mode: RepeatMode) => Promise<void>) | null
    playTrack(id: string): Promise<void>
    show(): Promise<void>
}

// ---- Linux: MPRIS ---------------------------------------------------------

const BUS_NAME = 'org.mpris.MediaPlayer2.spotify'
const OBJECT_PATH = '/org/mpris/MediaPlayer2'
const PLAYER = 'org.mpris.MediaPlayer2.Player'

const busctl = (...args: string[]) => run('busctl', ['--user', ...args])
const callPlayer = (method: string, ...args: string[]) => busctl('call', BUS_NAME, OBJECT_PATH, PLAYER, method, ...args)

// MPRIS LoopStatus ↔ the repeat modes the launcher shows.
const LOOP_STATUS: Record<string, RepeatMode> = { None: 'NONE', Playlist: 'ALL', Track: 'ONE' }
const TO_LOOP_STATUS: Record<RepeatMode, string> = { NONE: 'None', ALL: 'Playlist', ONE: 'Track' }

/** busctl --json=short's variant: { type, data }. */
type Variant = { type: string; data: unknown }

function findCommand(names: string[]): string | null {
    for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
        for (const name of names) {
            try {
                if (statSync(join(dir, name)).isFile()) return join(dir, name)
            } catch {
                // Not here.
            }
        }
    }
    return null
}

// Spotify's Flatpak, installed system-wide or for this user.
const FLATPAK_DIRS = ['/var/lib/flatpak/app/com.spotify.Client', join(homedir(), '.local/share/flatpak/app/com.spotify.Client')]

const linuxCommand = () => findCommand(['spotify']) ?? (FLATPAK_DIRS.some(existsSync) ? findCommand(['flatpak']) : null)

const linux: Platform = {
    installed: () => linuxCommand() !== null,

    launch() {
        const command = linuxCommand()
        if (!command) return
        const args = command.endsWith('flatpak') ? ['run', 'com.spotify.Client'] : []
        spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
    },

    async read() {
        let output: string
        try {
            output = await busctl('--json=short', 'call', BUS_NAME, OBJECT_PATH, 'org.freedesktop.DBus.Properties', 'GetAll', 's', PLAYER)
        } catch (error) {
            // Not on the bus: Spotify isn't running.
            if (/not activatable|was not provided|ServiceUnknown/i.test(describe(error))) return { state: 'not-running' }
            return { state: 'error', message: describe(error) }
        }
        const properties = (JSON.parse(output) as { data: [Record<string, Variant>] }).data[0]
        const value = <T>(name: string) => properties[name]?.data as T | undefined
        const metadata = value<Record<string, Variant>>('Metadata') ?? {}
        const meta = <T>(name: string) => metadata[name]?.data as T | undefined

        const title = meta<string>('xesam:title')
        if (!title) return { state: 'ready', track: null }
        const trackId = meta<string>('mpris:trackid') ?? ''
        const status = value<string>('PlaybackStatus')
        const length = meta<number>('mpris:length')
        return {
            state: 'ready',
            track: {
                title,
                artist: (meta<string[]>('xesam:artist') ?? []).join(', '),
                album: meta<string>('xesam:album') ?? '',
                // Older clients gave open.spotify.com/image/… for the same picture.
                artworkUrl: meta<string>('mpris:artUrl')?.replace('https://open.spotify.com/image/', 'https://i.scdn.co/image/') ?? null,
                isPlaying: status === 'Playing',
                isLoading: false,
                repeatMode: LOOP_STATUS[value<string>('LoopStatus') ?? 'None'] ?? 'NONE',
                isAsleep: false,
                // MPRIS times are in microseconds.
                position: (value<number>('Position') ?? 0) / 1e6,
                duration: length ? length / 1e6 : null,
                readAt: Date.now(),
                // Free accounts' ads come as tracks of their own.
                isAd: /\/ad\/|^spotify:ad:/.test(trackId),
                playBlocked: false,
                source: SOURCE,
            },
        }
    },

    // Play and Pause, not PlayPause: a repeated or late request can't flip
    // playback the wrong way (see the table in AGENTS.md).
    setPlaying: (playing) => callPlayer(playing ? 'Play' : 'Pause').then(() => {}),

    control: (action) => callPlayer(action === 'next' ? 'Next' : 'Previous').then(() => {}),

    async setRepeat(mode) {
        await busctl('set-property', BUS_NAME, OBJECT_PATH, PLAYER, 'LoopStatus', 's', TO_LOOP_STATUS[mode])
    },

    playTrack: (id) => callPlayer('OpenUri', 's', `spotify:track:${id}`).then(() => {}),

    show: () => busctl('call', BUS_NAME, OBJECT_PATH, 'org.mpris.MediaPlayer2', 'Raise').then(() => {}),
}

// ---- macOS: AppleScript ---------------------------------------------------

// By bundle id, never by name (see BUNDLE_IDS in mac-transport.ts).
const APP = 'application id "com.spotify.client"'
const ERROR_NOT_AUTHORIZED = -1743

const appPath = () =>
    [join('/Applications', 'Spotify.app'), join(homedir(), 'Applications', 'Spotify.app')].find(existsSync) ?? null

const osascript = (script: string) => run('osascript', ['-e', script], 10_000)
// Telling an app something launches it; only playing a song should.
const tellSpotify = (body: string) => osascript(`if ${APP} is running then tell ${APP} to ${body}`).then(() => {})
const launchAndTellSpotify = (body: string) => osascript(`tell ${APP} to ${body}`).then(() => {})

const mac: Platform = {
    installed: () => appPath() !== null,

    launch() {
        execFile('open', ['-b', 'com.spotify.client'])
    },

    async read() {
        // One line, tab-separated: state, name, artist, album, artwork, position
        // (seconds), duration (ms), id ("spotify:track:…"), repeating.
        let output: string
        try {
            output = await osascript(`
if ${APP} is not running then return "not running"
set sep to character id 9
tell ${APP}
    if player state is stopped then return "stopped"
    set t to current track
    return (player state as text) & sep & (name of t) & sep & (artist of t) & sep & (album of t) & sep & (artwork url of t) & sep & (player position as text) & sep & (duration of t as text) & sep & (id of t) & sep & (repeating as text)
end tell`)
        } catch (error) {
            const message = describe(error)
            if (message.includes(`(${ERROR_NOT_AUTHORIZED})`)) return { state: 'needs-permission' }
            return { state: 'error', message }
        }
        if (output === 'not running') return { state: 'not-running' }
        if (output === 'stopped') return { state: 'ready', track: null }
        const [state, title, artist, album, artwork, position, duration, id, repeating] = output.split('\t')
        return {
            state: 'ready',
            track: {
                title,
                artist,
                album,
                artworkUrl: artwork || null,
                isPlaying: state === 'playing',
                isLoading: false,
                // AppleScript only says whether the queue repeats, not one song.
                repeatMode: repeating === 'true' ? 'ALL' : 'NONE',
                isAsleep: false,
                // Reals print with the system's decimal separator.
                position: Number(position.replace(',', '.')) || 0,
                duration: Number(duration) ? Number(duration) / 1000 : null,
                readAt: Date.now(),
                isAd: id.startsWith('spotify:ad:'),
                playBlocked: false,
                source: SOURCE,
            },
        }
    },

    setPlaying: (playing) => tellSpotify(playing ? 'play' : 'pause'),
    control: (action) => tellSpotify(action === 'next' ? 'next track' : 'previous track'),
    setRepeat: null,
    playTrack: (id) => launchAndTellSpotify(`play track "spotify:track:${id}"`),
    show: () => tellSpotify('activate'),
}

const platform = isMac ? mac : linux

// ---- Shared ---------------------------------------------------------------

/** Spotify is installed on this computer. */
export const isInstalled = () => platform.installed()

export const canLoop = () => platform.setRepeat !== null

export function launch(): void {
    platform.launch()
}

// What the last read found, logged when it changes.
let lastState: string | null = null

export async function read(): Promise<SpotifyRead> {
    if (!platform.installed()) return { state: 'not-installed' }
    const result = await platform.read()
    if (result.state !== lastState) {
        log.info(`spotify: ${lastState ?? 'unknown'} → ${result.state}`, 'message' in result ? (result.message ?? '') : '')
        lastState = result.state
    }
    return result
}

// Spotify takes requests one at a time, in order, like the YouTube Music
// tabs (see enqueue in youtube-music.ts).
let queue: Promise<unknown> = Promise.resolve()
function enqueue(action: () => Promise<void>): Promise<void> {
    const next = queue.then(action)
    queue = next.catch(() => {})
    return next
}

export function setPlaying(playing: boolean): Promise<void> {
    if (typeof playing !== 'boolean') throw new Error('Invalid play request')
    return enqueue(() => platform.setPlaying(playing))
}

export function control(action: PlayerControl): Promise<void> {
    if (action !== 'previous' && action !== 'next') throw new Error('Invalid player control')
    return enqueue(() => platform.control(action))
}

/** Loops the current song; off puts back the repeat mode from before. */
export function setLoop(enabled: boolean): Promise<void> {
    if (typeof enabled !== 'boolean') throw new Error('Invalid loop request')
    const setRepeat = platform.setRepeat
    if (!setRepeat) throw new Error("Spotify can't loop one song from Music Bar on macOS")
    return enqueue(async () => {
        const fresh = await platform.read()
        const current = fresh.state === 'ready' ? fresh.track?.repeatMode : undefined
        if (enabled) {
            if (current && current !== 'ONE') modeBeforeLoop = current
            await setRepeat('ONE')
        } else {
            await setRepeat(modeBeforeLoop === 'ALL' ? 'ALL' : 'NONE')
            modeBeforeLoop = 'NONE'
        }
    })
}

/** Plays a track right away (the app's own "play", no account needed). */
export function playTrack(id: string): Promise<void> {
    if (!SPOTIFY_TRACK_ID.test(id)) throw new Error('Invalid Spotify track id')
    return enqueue(() => platform.playTrack(id))
}

/** Brings the Spotify window to the front. */
export function show(): Promise<void> {
    return platform.show()
}
