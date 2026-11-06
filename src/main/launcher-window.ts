import { app, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { IPC } from '../shared/ipc'
import { markAsSystemDialog } from './system-dialog'

const WIDTH = 750
const HEIGHT = 475

let window: BrowserWindow | null = null
// Until this time, losing focus doesn't hide the launcher (see holdThroughBlur).
let ignoreBlurUntil = 0
// A launcher shown before its page has loaded would be blank, so a show
// asked for at startup waits for the load.
let loaded = false
let showWhenLoaded = false

export function createLauncherWindow(): BrowserWindow {
    window = new BrowserWindow({
        width: WIDTH,
        height: HEIGHT,
        show: false,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        // NSPanel so the launcher can float over full-screen apps without
        // pulling the user to another Space.
        type: 'panel',
        // Borderless, not just frameless: Electron gives a frameless window a
        // hidden title bar and buttons for its rounded corners. Window
        // managers count a window with a close button as theirs to manage
        // (see system-dialog.ts). The renderer draws the corners instead.
        roundedCorners: false,
        // Transparent so the renderer's rounded, solid panel defines the shape.
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: true,
        webPreferences: {
            preload: join(__dirname, 'preload.js'),
            contextIsolation: true,
            sandbox: true,
        },
    })

    // Kept out of window managers' hands (see system-dialog.ts).
    markAsSystemDialog(window)
    window.setAlwaysOnTop(true, 'floating')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    // Raycast behaviour: clicking anywhere else dismisses the launcher.
    window.on('blur', () => {
        if (Date.now() < ignoreBlurUntil) return
        if (!window?.webContents.isDevToolsOpened()) window?.hide()
    })

    window.on('hide', () => window?.webContents.send(IPC.launcherHidden))

    window.webContents.once('did-finish-load', () => {
        loaded = true
        if (showWhenLoaded) showLauncher()
    })

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
    } else {
        void window.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`))
    }

    return window
}

/** Sends an event to the launcher's page, if the window exists. */
export function sendToLauncher(channel: string): void {
    window?.webContents.send(channel)
}

export function showLauncher(): void {
    if (!window) return
    if (!loaded) {
        showWhenLoaded = true
        return
    }
    // Open on the display the user is working on, a little above centre.
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    window.setPosition(
        Math.round(workArea.x + (workArea.width - WIDTH) / 2),
        Math.round(workArea.y + workArea.height * 0.22),
    )
    window.show()
    window.focus()
    window.webContents.send(IPC.launcherShown)
}

/**
 * Keeps the launcher up through a focus loss Music Bar causes itself, such
 * as a browser bringing itself forward when a tab is opened in it.
 */
export function holdThroughBlur(ms: number): void {
    ignoreBlurUntil = Date.now() + ms
}

/**
 * Gives the keyboard back to the launcher after another app took it. The
 * panel doesn't activate Music Bar, so the app in front stays in front.
 */
export function focusLauncher(): void {
    if (window?.isVisible()) window.focus()
}

/**
 * Hides the launcher and hands focus back to whatever app was frontmost
 * before it opened. Pass `returnFocus: false` when another Music Bar window
 * takes focus next.
 */
export function hideLauncher({ returnFocus = true } = {}): void {
    if (!window?.isVisible()) return
    window.hide()
    if (returnFocus && process.platform === 'darwin') app.hide()
}

export function toggleLauncher(): void {
    if (window?.isVisible() && window.isFocused()) hideLauncher()
    else showLauncher()
}
