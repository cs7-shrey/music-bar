import { app } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { logger } from './log'

// Open at login, as a LaunchAgent: a plist in ~/Library/LaunchAgents that
// launchd reads at each login. Not Electron's login item (SMAppService),
// because on macOS 13+ it can't tell the app it was opened at login, and a
// login launch must start quietly in the menu bar, not pop the launcher.
// Here launchd passes LOGIN_FLAG instead. The file existing is the setting.

const LABEL = 'dev.shrey.music-bar'
const LOGIN_FLAG = '--login'

const log = logger('login-item')

const plistPath = () => join(homedir(), 'Library/LaunchAgents', `${LABEL}.plist`)

/** True when launchd started this run at login. */
export const openedAtLogin = process.argv.includes(LOGIN_FLAG)

/**
 * Only the packaged app can open itself at login; in development the
 * executable is Electron's own, which can't run Music Bar alone.
 */
export const canOpenAtLogin = () => app.isPackaged

export function isOpenAtLogin(): boolean {
    return existsSync(plistPath())
}

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function writePlist(): void {
    mkdirSync(join(plistPath(), '..'), { recursive: true })
    writeFileSync(
        plistPath(),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xml(app.getPath('exe'))}</string>
        <string>${LOGIN_FLAG}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>ProcessType</key>
    <string>Interactive</string>
</dict>
</plist>
`,
    )
}

export function setOpenAtLogin(enabled: boolean): void {
    if (!canOpenAtLogin()) throw new Error('Open at login works only in the built app')
    if (enabled) writePlist()
    else rmSync(plistPath(), { force: true })
    log.info(enabled ? `on: ${app.getPath('exe')}` : 'off')
}

/**
 * Points the agent at wherever the app is now. Run at startup: an app moved
 * after turning this on (say from Downloads to Applications) would otherwise
 * have launchd look for it in the old place.
 */
export function refreshOpenAtLogin(): void {
    if (canOpenAtLogin() && isOpenAtLogin()) writePlist()
}
