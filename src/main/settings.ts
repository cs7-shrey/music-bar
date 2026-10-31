import { app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
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
}

const DEFAULTS: Settings = { browsers: null, awaitingShortcut: false }

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
    writeFileSync(settingsFile(), JSON.stringify(cached, null, 4))
}
