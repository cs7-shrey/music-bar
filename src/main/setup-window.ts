import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { frontmostApp } from './frontmost-app'
import { getSettings } from './settings'

// The setup window: an ordinary window rather than the launcher panel, since
// setup sends the user to their browser's menus and to macOS prompts, and the
// launcher hides whenever it loses focus. Same renderer, routed by the hash:
// #setup for the first run, #settings once browsers are chosen.

const HANDOFF_TIMEOUT_MS = 1500

let window: BrowserWindow | null = null

export function isSetupOpen(): boolean {
    return window !== null
}

export function showSetup(): void {
    if (window) {
        window.show()
        window.focus()
        app.focus({ steal: true })
        return
    }

    const page = getSettings().browsers === null ? 'setup' : 'settings'
    window = new BrowserWindow({
        // Setup is one narrow column. Settings has a sidebar of sections and
        // room to grow.
        ...(page === 'setup'
            ? { width: 560, height: 660, resizable: false }
            : { width: 820, height: 580, minWidth: 680, minHeight: 440 }),
        show: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        title: page === 'setup' ? 'Set Up Music Bar' : 'Music Bar Settings',
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#121212',
        webPreferences: {
            preload: join(__dirname, 'preload.js'),
            contextIsolation: true,
            sandbox: true,
        },
    })

    window.once('ready-to-show', () => {
        // In the Dock and the ⌘Tab switcher while the window is open, so it
        // can't get lost behind other apps; gone again when it closes.
        void app.dock?.show()
        window?.show()
        app.focus({ steal: true })
    })
    window.on('closed', () => {
        window = null
        app.dock?.hide()
    })

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        void window.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#${page}`)
    } else {
        void window.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), { hash: page })
    }
}

/**
 * Closes the window and resolves once another app is in front. Dropping the
 * Dock icon hands the front to another app a moment after the close, and a
 * launcher shown before that lands would lose focus to it and hide.
 */
export async function closeSetup(): Promise<void> {
    const closing = window
    if (!closing) return
    closing.close()
    const deadline = Date.now() + HANDOFF_TIMEOUT_MS
    while (Date.now() < deadline) {
        const front = await frontmostApp()
        if (front && front.pid !== process.pid) return
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
}
