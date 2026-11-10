import { app } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { logger } from './log'

// Open at login, written as a file the system reads at each login, with
// LOGIN_FLAG on the command so a login launch starts quietly in the menu bar
// instead of popping the launcher. The file existing is the setting.
//
// macOS: a LaunchAgent, a plist in ~/Library/LaunchAgents that launchd
// reads. Not Electron's login item (SMAppService), because on macOS 13+ it
// can't tell the app it was opened at login.
//
// Linux: an XDG autostart entry in ~/.config/autostart, which GNOME, KDE,
// Xfce and other desktops run at login (window managers like Hyprland or
// Sway need their own autostart line; see the README).

const LABEL = 'dev.shrey.music-bar'
const LOGIN_FLAG = '--login'

const log = logger('login-item')

const isMac = process.platform === 'darwin'

const itemPath = () =>
    isMac
        ? join(homedir(), 'Library/LaunchAgents', `${LABEL}.plist`)
        : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autostart', 'music-bar.desktop')

/** True when this run was started at login. */
export const openedAtLogin = process.argv.includes(LOGIN_FLAG)

/**
 * Only the packaged app can open itself at login; in development the
 * executable is Electron's own, which can't run Music Bar alone.
 */
export const canOpenAtLogin = () => app.isPackaged

export function isOpenAtLogin(): boolean {
    return existsSync(itemPath())
}

/**
 * What starts Music Bar. Packages that run it through a shared Electron (Nix
 * does) set MUSIC_BAR_LAUNCHER to their command, since the executable is then
 * Electron's.
 */
const launcher = () => process.env.MUSIC_BAR_LAUNCHER || app.getPath('exe')

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function writePlist(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xml(launcher())}</string>
        <string>${LOGIN_FLAG}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>ProcessType</key>
    <string>Interactive</string>
</dict>
</plist>
`
}

/** An Exec= argument, quoted as the desktop entry spec asks. */
const desktopArgument = (value: string) =>
    /[\s"'\\$`]/.test(value) ? `"${value.replace(/(["`$\\])/g, '\\$1')}"` : value

function writeDesktopEntry(): string {
    return `[Desktop Entry]
Type=Application
Name=Music Bar
Comment=Starts Music Bar quietly in the tray
Exec=${desktopArgument(launcher())} ${LOGIN_FLAG}
Icon=music-bar
Terminal=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
`
}

function writeItem(): void {
    mkdirSync(join(itemPath(), '..'), { recursive: true })
    writeFileSync(itemPath(), isMac ? writePlist() : writeDesktopEntry())
}

export function setOpenAtLogin(enabled: boolean): void {
    if (!canOpenAtLogin()) throw new Error('Open at login works only in the built app')
    if (enabled) writeItem()
    else rmSync(itemPath(), { force: true })
    log.info(enabled ? `on: ${launcher()}` : 'off')
}

/**
 * Points the item at wherever the app is now. Run at startup: an app moved
 * after turning this on (say from Downloads to Applications) would otherwise
 * be looked for in the old place.
 */
export function refreshOpenAtLogin(): void {
    if (canOpenAtLogin() && isOpenAtLogin()) writeItem()
}
