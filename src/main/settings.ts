import { app } from 'electron'
import { chmodSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { BrowserName } from '../shared/ipc'

// User settings, kept as JSON in the app's data folder
// (~/Library/Application Support/Music Bar/settings.json).

export interface Settings {
    /** Browsers Music Bar may talk to; null until chosen in setup. */
    browsers: BrowserName[] | null
    /**
     * Setup is done but Music Bar hasn't been opened with its shortcut yet.
     * Until it is, setup stays open on its last screen, which teaches it.
     */
    awaitingShortcut: boolean
    /** Music Bar reads and controls the Spotify app. Off until turned on, like browsers. */
    spotify: boolean
    /**
     * The user's own Spotify app (developer.spotify.com), for search and the
     * queue through Spotify's Web API. Null until connected.
     */
    spotifyAccount: {
        clientId: string
        /** The refresh token, encrypted with safeStorage when the system can (base64). */
        refreshToken: string
        encrypted: boolean
        displayName: string | null
    } | null
}

const DEFAULTS: Settings = { browsers: null, awaitingShortcut: false, spotify: false, spotifyAccount: null }

let cached: Settings | null = null

const settingsFile = () => join(app.getPath('userData'), 'settings.json')

export function getSettings(): Settings {
    if (!cached) {
        try {
            cached = { ...DEFAULTS, ...JSON.parse(readFileSync(settingsFile(), 'utf8')) }
        } catch {
            cached = { ...DEFAULTS }
        }
    }
    return cached!
}

export function updateSettings(changes: Partial<Settings>): void {
    cached = { ...getSettings(), ...changes }
    // Only this user may read it: it holds the Spotify sign-in.
    writeFileSync(settingsFile(), JSON.stringify(cached, null, 4), { mode: 0o600 })
    chmodSync(settingsFile(), 0o600)
}
