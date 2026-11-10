import { execFile } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { nativeImage } from 'electron'
import type { BrowserName, BrowserStatus, TrackSource } from '../shared/ipc'
import { logger } from './log'
import { TransportError, type BrowserRead, type RawTab, type TabTransport } from './tab-transport'

// Reaches YouTube Music tabs through each browser's AppleScript `execute
// javascript` command. This works on background tabs, but each browser needs
// View → Developer → Allow JavaScript from Apple Events turned on once.

type MacBrowser = 'Brave Browser' | 'Google Chrome' | 'Helium'

const BROWSERS: MacBrowser[] = ['Brave Browser', 'Google Chrome', 'Helium']

// Each browser's bundle id. Scripts address browsers by id, never by name:
// macOS can resolve an app name to a different app (on one Mac, "Brave
// Browser" while Brave wasn't running turned out to mean Helium), and then
// Music Bar would drive, and ask permission for, a browser nobody chose.
const BUNDLE_IDS: Record<MacBrowser, string> = {
    'Brave Browser': 'com.brave.Browser',
    'Google Chrome': 'com.google.Chrome',
    Helium: 'net.imput.helium',
}

const isMacBrowser = (browser: BrowserName): browser is MacBrowser => (BROWSERS as BrowserName[]).includes(browser)

/** The browser as an AppleScript application reference, by bundle id. */
function appRef(browser: BrowserName): string {
    if (!isMacBrowser(browser)) throw new Error('Unsupported browser')
    return `application id ${asString(BUNDLE_IDS[browser])}`
}

const YT_MUSIC_URL = 'https://music.youtube.com/'

// Where each supported browser is installed, if it is.
const appPaths = new Map(
    BROWSERS.flatMap((name) => {
        const path = [join('/Applications', `${name}.app`), join(homedir(), 'Applications', `${name}.app`)].find(existsSync)
        return path ? [[name as BrowserName, path] as const] : []
    }),
)

/** Quotes a string as an AppleScript string literal. */
function asString(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

const log = logger('applescript')

function runAppleScript(script: string, timeoutMs = 10_000): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile('osascript', ['-e', script], { timeout: timeoutMs }, (error, stdout, stderr) => {
            if (error?.killed) {
                // Its first line says which browser it was talking to.
                log.warn(`osascript timed out after ${timeoutMs}ms`, script.trim().split('\n')[0])
            }
            if (error) {
                // AppleScript's error number ends the message, e.g. "(-1743)".
                const message = stderr.trim() || error.message
                const code = message.match(/\((-?\d+)\)\s*$/)?.[1]
                reject(new TransportError(message, code ? Number(code) : null))
            } else resolve(stdout.trim())
        })
    })
}

// AppleScript error numbers that get their own browser status.
const ERROR_JS_FROM_APPLE_EVENTS_OFF = 12
const ERROR_NOT_AUTHORIZED = -1743

// Where each browser keeps its profiles, under ~/Library/Application Support.
const PROFILE_DIRS: Record<MacBrowser, string> = {
    'Brave Browser': 'BraveSoftware/Brave-Browser',
    'Google Chrome': 'Google/Chrome',
    Helium: 'net.imput.helium',
}

/**
 * The "Allow JavaScript from Apple Events" switch as saved in the browser's
 * last-used profile; null when it can't be read. A missing entry means the
 * default, off. Only a fallback: the file lags behind a fresh change.
 */
function savedJavaScriptSetting(browser: MacBrowser): boolean | null {
    try {
        const dir = join(homedir(), 'Library/Application Support', PROFILE_DIRS[browser])
        const localState = JSON.parse(readFileSync(join(dir, 'Local State'), 'utf8'))
        const profile = localState.profile?.last_used ?? 'Default'
        const preferences = JSON.parse(readFileSync(join(dir, profile, 'Preferences'), 'utf8'))
        return preferences.browser?.allow_javascript_apple_events === true
    } catch {
        return null
    }
}

/** AppleScript that finds `source`'s tab in its window `w`, leaving its index in `i`. */
const indexOf = (tabId: string) => `
    set i to 0
    repeat with t in tabs of w
        set i to i + 1
        if (id of t as text) is "${tabId}" then exit repeat
    end repeat`

function tellWindow(source: TrackSource, body: string): Promise<string> {
    return runAppleScript(`
tell ${appRef(source.browser)}
    set w to window id ${source.windowId}
${body}
end tell`)
}

export const macTransport: TabTransport = {
    browsers: BROWSERS,
    openHint: 'Open YouTube Music in Brave, Chrome or Helium',

    installedBrowsers: () => [...appPaths.keys()],

    async browserIcon(browser) {
        const path = appPaths.get(browser)
        if (!path) return null
        // Not app.getFileIcon: it crashes Electron on macOS 26.
        return nativeImage
            .createThumbnailFromPath(path, { width: 72, height: 72 })
            .then((image) => image.toDataURL())
            .catch(() => null)
    },

    /** Launches a browser, found by bundle id (see BUNDLE_IDS). */
    openBrowser(browser) {
        if (!appPaths.has(browser) || !isMacBrowser(browser)) return
        execFile('open', ['-b', BUNDLE_IDS[browser]])
    },

    async readTabs(browser, js, skipTabIds, tabTimeoutSeconds, timeoutMs) {
        const skipIds = skipTabIds.map((id) => asString(String(id)))
        // `tab` is a class name inside the browser's dictionary, so the separator
        // is bound before entering the tell block. The `whose` filter finds YT
        // Music tabs in one request instead of asking each tab for its URL.
        const script = `
set sep to character id 9
set out to ""
set skipIds to {${skipIds.join(', ')}}
set ytTabs to 0
if ${appRef(browser)} is running then
    set out to "running" & linefeed
    tell ${appRef(browser)}
        repeat with w in windows
            repeat with t in (tabs of w whose URL starts with ${asString(YT_MUSIC_URL)})
                set ytTabs to ytTabs + 1
                if skipIds contains (id of t as text) then
                    set out to out & "skipped" & sep & (id of w as text) & sep & (id of t as text) & linefeed
                else
                    try
                        with timeout of ${tabTimeoutSeconds} seconds
                            set r to execute t javascript ${asString(js)}
                        end timeout
                        if r is missing value then set r to ""
                        set out to out & "tab" & sep & (id of w as text) & sep & (id of t as text) & sep & r & linefeed
                    on error message number errorNumber
                        if errorNumber is -1712 then
                            set out to out & "unloaded" & sep & (id of w as text) & sep & (id of t as text) & linefeed
                        else
                            set out to out & "error" & sep & errorNumber & sep & message & linefeed
                        end if
                    end try
                end if
            end repeat
        end repeat
        if ytTabs is 0 then
            try
                with timeout of ${tabTimeoutSeconds} seconds
                    execute (active tab of window 1) javascript "1"
                end timeout
                set out to out & "probe" & sep & "ok" & linefeed
            on error message number errorNumber
                set out to out & "probe" & sep & errorNumber & linefeed
            end try
        end if
    end tell
end if
return out`

        const lines = (await runAppleScript(script, timeoutMs)).split('\n').filter(Boolean)
        const running = lines[0] === 'running'
        const probeLine = lines.find((line) => line.startsWith('probe\t'))
        const probe = probeLine ? (probeLine.split('\t')[1] === 'ok' ? 'ok' : Number(probeLine.split('\t')[1])) : undefined
        const tabs = lines
            .slice(running ? 1 : 0)
            .filter((line) => line !== probeLine)
            .map((line): RawTab => {
                const [kind, ...rest] = line.split('\t')
                if (kind === 'error') return { kind, code: Number(rest[0]), message: rest.slice(1).join('\t') }
                const [windowId, tabId, json] = rest
                const where = { windowId: Number(windowId), tabId: Number(tabId) }
                if (kind === 'skipped' || kind === 'unloaded') return { kind, ...where }
                return { kind: 'tab', ...where, json: json ?? '' }
            })
        return { running, tabs, probe }
    },

    executeInTab(source, js, timeoutSeconds) {
        return runAppleScript(`
with timeout of ${timeoutSeconds} seconds
    tell ${appRef(source.browser)}
        execute (tab id ${source.tabId} of window id ${source.windowId}) javascript ${asString(js)}
    end tell
end timeout`)
    },

    activateTab(source) {
        return tellWindow(
            source,
            `
    set previousTabId to id of active tab of w
${indexOf(String(source.tabId))}
    set active tab index of w to i
    return previousTabId as text`,
        )
    },

    async restoreTab(source, previousTabId) {
        // Brave reports tab ids as text, so they're compared as text.
        await tellWindow(
            source,
            `
    if (id of active tab of w as text) is "${source.tabId}" then
${indexOf(previousTabId)}
        set active tab index of w to i
    end if`,
        )
    },

    async showTab(source) {
        await runAppleScript(`
tell ${appRef(source.browser)}
    set w to window id ${source.windowId}
${indexOf(String(source.tabId))}
    set active tab index of w to i
    set index of w to 1
    activate
end tell`)
    },

    async openTab(browser, url) {
        const created = await runAppleScript(`
tell ${appRef(browser)}
    if (count of windows) is 0 then
        set w to make new window
        set URL of active tab of w to ${asString(url)}
        return (id of w as text) & " " & (id of active tab of w as text) & " shown"
    end if
    set w to window 1
    set previousIndex to active tab index of w
    set t to make new tab at end of tabs of w with properties {URL:${asString(url)}}
    set active tab index of w to previousIndex
    return (id of w as text) & " " & (id of t as text) & " background"
end tell`)
        const [windowId, tabId, placement] = created.split(' ')
        return { windowId: Number(windowId), tabId: Number(tabId), placement: placement === 'shown' ? 'shown' : 'background' }
    },

    status({ browser, results, probe }: BrowserRead): BrowserStatus {
        const errors = results.flatMap((result) => ('error' in result ? [result] : []))
        if (errors.some((error) => error.code === ERROR_JS_FROM_APPLE_EVENTS_OFF)) return { browser, state: 'needs-setup' }
        if (errors.some((error) => error.code === ERROR_NOT_AUTHORIZED)) return { browser, state: 'needs-permission' }
        // Inactive tabs count as connected: the card offers to load them.
        if (results.some((result) => 'source' in result)) return { browser, state: 'connected' }
        if (errors[0]) return { browser, state: 'error', message: errors[0].error }
        // No YT Music tab: the probe in its front tab says whether one would work.
        if (probe === ERROR_JS_FROM_APPLE_EVENTS_OFF) return { browser, state: 'needs-setup' }
        if (probe === ERROR_NOT_AUTHORIZED) return { browser, state: 'needs-permission' }
        // Inconclusive probe (no window, or the tab didn't answer): the saved setting.
        if (probe !== 'ok' && isMacBrowser(browser) && savedJavaScriptSetting(browser) === false) {
            return { browser, state: 'needs-setup' }
        }
        return { browser, state: 'no-tab' }
    },
}
