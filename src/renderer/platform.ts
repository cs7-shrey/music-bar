// What the UI says and listens for differs a little by platform. Shortcuts
// are written the macOS way everywhere ('⌘⇧O'); Linux uses Ctrl where macOS
// uses ⌘, and `keys` writes them the way Linux keyboards say them.

export const isMac = window.musicBar.platform === 'darwin'

/**
 * Wayland: no app may take a global key, so the launcher opens from a key
 * the user binds in their desktop's settings to this command.
 */
export const isWayland = window.musicBar.wayland
export const TOGGLE_COMMAND = 'music-bar --toggle'

const LINUX_KEYS: Record<string, string> = { '⌘': 'Ctrl', '⇧': 'Shift', '⌥': 'Alt' }

/** '⌘⇧O' on macOS, 'Ctrl+Shift+O' on Linux. */
export function keys(shortcut: string): string {
    if (isMac) return shortcut
    const modifiers: string[] = []
    let key = shortcut
    while (key && LINUX_KEYS[key[0]]) {
        modifiers.push(LINUX_KEYS[key[0]])
        key = key.slice(1)
    }
    return [...modifiers, key].join('+')
}

/** Key caps, one per key: ['⌘', '⇧', 'Space'] on macOS, ['Ctrl', 'Shift', 'Space'] on Linux. */
export const keyCaps = (caps: string[]) => (isMac ? caps : caps.map((key) => LINUX_KEYS[key] ?? key))

/** The key that plays ⌘'s part: ⌘ on macOS, Ctrl on Linux (KeyboardEvent.key). */
export const MODIFIER_KEY = isMac ? 'Meta' : 'Control'

/** Whether ⌘ (Linux: Ctrl) is down. */
export const hasModifier = (event: { metaKey: boolean; ctrlKey: boolean }) => (isMac ? event.metaKey : event.ctrlKey)

/** Where the app's icon lives: the menu bar, or a Linux panel's tray. */
export const TRAY = isMac ? 'menu bar' : 'tray'

/** The browsers Music Bar works with here. */
export const SUPPORTED_BROWSERS = isMac ? 'Brave, Chrome and Helium' : 'Brave, Chrome and Chromium'

/** What to do so scripts can run in a browser's tabs. */
export const SCRIPTING_SETUP = isMac
    ? 'View → Developer → Allow JavaScript from Apple Events'
    : 'add the Music Bar extension (Settings → Browsers)'
