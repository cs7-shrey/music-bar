import type { BrowserName, BrowserStatus, TabTrack, TabSource } from '../shared/ipc'

// How youtube-music.ts reaches browser tabs. Each platform has its own way
// in: AppleScript's `execute javascript` on macOS (mac-transport.ts), Music
// Bar's browser extension on Linux (linux-transport.ts). Both run the same
// scripts in an isolated world of the tab, on background tabs too, so
// everything above this layer is shared.

/** A transport's error code: AppleScript's error number, or a name on Linux. */
export type ErrorCode = number | string | null

/** A failure the transport can tell apart by code (see TabTransport.status). */
export class TransportError extends Error {
    constructor(
        message: string,
        readonly code: ErrorCode,
    ) {
        super(message)
    }
}

/** One YT Music tab as a transport read it. */
export type RawTab =
    | { kind: 'tab'; windowId: number; tabId: number; json: string }
    /** Not run: the tab didn't answer recently (see youtube-music.ts). */
    | { kind: 'skipped'; windowId: number; tabId: number }
    /** The browser hasn't loaded the tab, or it didn't answer in time. */
    | { kind: 'unloaded'; windowId: number; tabId: number }
    | { kind: 'error'; code: ErrorCode; message: string }

export interface RawRead {
    running: boolean
    tabs: RawTab[]
    /** With no YT Music tab: whether a script would run, if the transport can tell. */
    probe?: 'ok' | ErrorCode
}

/**
 * One YT Music tab, or a failed read. `loaded` is false for a tab the browser
 * hasn't loaded (restored at launch without being opened, or discarded to
 * save memory): its scripts never answer.
 */
export type TabResult =
    | { source: TabSource; track: TabTrack | null; loaded: boolean; busy?: boolean }
    | { error: string; code: ErrorCode }

/** One browser's read: whether it's open, and what its YT Music tabs returned. */
export interface BrowserRead {
    browser: BrowserName
    running: boolean
    results: TabResult[]
    probe?: 'ok' | ErrorCode
}

export interface TabTransport {
    /** The browsers this platform supports, in the order setup lists them. */
    readonly browsers: readonly BrowserName[]
    /** "Open YouTube Music in …", naming this platform's browsers. */
    readonly openHint: string
    /** Supported browsers that are installed. */
    installedBrowsers(): BrowserName[]
    /** The browser's icon as a data: URL, for setup. */
    browserIcon(browser: BrowserName): Promise<string | null>
    openBrowser(browser: BrowserName): void
    /**
     * Every YT Music tab in a browser, each read with `js` except the tabs in
     * `skipTabIds`. A tab gets `tabTimeoutSeconds` to answer. Throws a
     * TransportError when the browser can't be read at all.
     */
    readTabs(
        browser: BrowserName,
        js: string,
        skipTabIds: number[],
        tabTimeoutSeconds: number,
        timeoutMs?: number,
    ): Promise<RawRead>
    /** Runs JavaScript in one tab and returns its value as text. */
    executeInTab(source: TabSource, js: string, timeoutSeconds: number): Promise<string>
    /** Shows a tab in its window; returns the id of the tab shown before, as text. */
    activateTab(source: TabSource): Promise<string>
    /** Shows `previousTabId` again, if `source` is still the tab in front. */
    restoreTab(source: TabSource, previousTabId: string): Promise<void>
    /** Brings a tab, its window and its browser to the front. */
    showTab(source: TabSource): Promise<void>
    /**
     * Opens `url` in a new tab of the browser's front window, without
     * switching to it ('background'), or in a new window if there's none
     * ('shown').
     */
    openTab(browser: BrowserName, url: string): Promise<{ windowId: number; tabId: number; placement: 'shown' | 'background' }>
    /** Sums up an open browser's read for the browser status list. */
    status(read: BrowserRead): BrowserStatus
}
