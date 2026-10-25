import { app, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { IPC } from '../shared/ipc'

const WIDTH = 750
const HEIGHT = 475

let window: BrowserWindow | null = null
// Until this time, losing focus doesn't hide the launcher (see holdThroughBlur).
let ignoreBlurUntil = 0

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

    window.setAlwaysOnTop(true, 'floating')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    // Raycast behaviour: clicking anywhere else dismisses the launcher.
    window.on('blur', () => {
        if (Date.now() < ignoreBlurUntil) return
        if (!window?.webContents.isDevToolsOpened()) window?.hide()
    })

    window.on('hide', () => window?.webContents.send(IPC.launcherHidden))

    // Renderer warnings and errors land in the terminal running the app.
    window.webContents.on('console-message', ({ level, message }) => {
        if (level === 'warning' || level === 'error') console.log(`[renderer:${level}] ${message}`)
    })

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
    } else {
        void window.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`))
    }

    return window
}

export function showLauncher(): void {
    if (!window) return
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

export function hideLauncher(): void {
    if (!window?.isVisible()) return
    window.hide()
    // Hand focus back to whatever app was frontmost before we opened.
    if (process.platform === 'darwin') app.hide()
}

export function toggleLauncher(): void {
    if (window?.isVisible() && window.isFocused()) hideLauncher()
    else showLauncher()
}
