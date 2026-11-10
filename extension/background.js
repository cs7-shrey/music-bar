// Music Bar's way into this browser on Linux, where there's no AppleScript.
// The Music Bar app sends requests through a native messaging host
// (native-host/music-bar-host.js, which the browser starts for this
// extension); this answers them, the way AppleScript's `execute javascript`
// does on macOS: it lists YouTube Music tabs and runs Music Bar's scripts in
// them, in an isolated world (chrome.userScripts), on background tabs too.
//
// It can only reach YouTube Music: its only host permission is
// music.youtube.com, so Chrome refuses to run code anywhere else.

const HOST = 'dev.shrey.music_bar'
const YT_MUSIC = 'https://music.youtube.com/'
const RECONNECT_MS = 5000

class CodedError extends Error {
    constructor(message, code) {
        super(message)
        this.code = code
    }
}

/**
 * Whether the user has turned on "Allow User Scripts" for this extension
 * (its Details page in chrome://extensions). Without it, chrome.userScripts
 * is missing and scripts can't run.
 */
function userScriptsAllowed() {
    try {
        chrome.userScripts.getScripts()
        return true
    } catch {
        return false
    }
}

let worldConfigured = null

/**
 * Some of Music Bar's scripts add a <script> to the page, to reach YouTube
 * Music's own objects in the page's world (inPageWorld in youtube-music.ts).
 * Chrome checks a script an isolated world adds against that world's CSP,
 * and the user script world's default allows no inline scripts, so it's
 * relaxed here; the page's own CSP still applies to what it then runs. A
 * tab picks this up the first time a script runs in it, so it's set before
 * the first one.
 */
function configureWorld() {
    worldConfigured ??= chrome.userScripts
        .configureWorld({ csp: "script-src 'self' 'unsafe-inline'; object-src 'self'" })
        .catch((error) => {
            worldConfigured = null
            throw error
        })
    return worldConfigured
}

async function requireUserScripts() {
    if (!userScriptsAllowed()) {
        throw new CodedError('Turn on Allow User Scripts for the Music Bar extension', 'user-scripts-off')
    }
    await configureWorld()
}

/** Which browser this is, under the name Music Bar uses for it. */
function browserName() {
    const brands = navigator.userAgentData?.brands.map((item) => item.brand) ?? []
    if (navigator.brave || brands.includes('Brave')) return 'Brave Browser'
    if (brands.includes('Google Chrome')) return 'Google Chrome'
    if (brands.includes('Chromium')) return 'Chromium'
    return null
}

/**
 * Runs a script in a YouTube Music tab and returns its value as text, ''
 * for none. Scripts all run in one isolated world that lasts as long as the
 * page, so what one leaves on `window` the next can read, as on macOS.
 */
async function run(tabId, code, timeoutMs) {
    await requireUserScripts()
    const tab = await chrome.tabs.get(tabId)
    if (!tab.url?.startsWith(YT_MUSIC)) throw new CodedError('Not a YouTube Music tab', 'not-youtube-music')
    let timer
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new CodedError("The tab didn't answer in time", 'timeout')), timeoutMs)
    })
    try {
        const [injection] = await Promise.race([
            chrome.userScripts.execute({ target: { tabId }, js: [{ code }], world: 'USER_SCRIPT', injectImmediately: true }),
            timeout,
        ])
        if (injection?.error) throw new Error(injection.error)
        const result = injection?.result
        return result === undefined || result === null ? '' : String(result)
    } finally {
        clearTimeout(timer)
    }
}

const OPS = {
    hello: () => ({
        browser: browserName(),
        version: chrome.runtime.getManifest().version,
        userScripts: userScriptsAllowed(),
    }),

    /**
     * Every YouTube Music tab, each read with `code`, except the ones in
     * `skip`. A tab the browser hasn't loaded (restored at startup, or
     * discarded to save memory) or that doesn't answer in time is 'unloaded'.
     */
    async read({ code, skip, timeoutMs }) {
        await requireUserScripts()
        const tabs = await chrome.tabs.query({ url: `${YT_MUSIC}*` })
        return Promise.all(
            tabs.map(async (tab) => {
                const where = { windowId: tab.windowId, tabId: tab.id }
                if (skip.includes(tab.id)) return { kind: 'skipped', ...where }
                if (tab.discarded || tab.status === 'unloaded') return { kind: 'unloaded', ...where }
                try {
                    return { kind: 'tab', ...where, json: await run(tab.id, code, timeoutMs) }
                } catch (error) {
                    if (error.code === 'timeout') return { kind: 'unloaded', ...where }
                    return { kind: 'error', code: error.code ?? null, message: error.message }
                }
            }),
        )
    },

    exec: ({ tabId, code, timeoutMs }) => run(tabId, code, timeoutMs),

    /** Makes a tab the one shown in its window; returns the id of the tab shown before. */
    async activate({ tabId }) {
        const tab = await chrome.tabs.get(tabId)
        const [previous] = await chrome.tabs.query({ active: true, windowId: tab.windowId })
        await chrome.tabs.update(tabId, { active: true })
        return previous ? String(previous.id) : ''
    },

    /** Shows `previousTabId` again, unless the user has moved off `tabId` meanwhile. */
    async restore({ tabId, previousTabId }) {
        const tab = await chrome.tabs.get(tabId)
        if (tab.active && previousTabId !== tabId) await chrome.tabs.update(previousTabId, { active: true })
    },

    /** Brings a tab and its window to the front, for the user to click in. */
    async show({ tabId }) {
        const tab = await chrome.tabs.update(tabId, { active: true })
        await chrome.windows.update(tab.windowId, { focused: true })
    },

    /**
     * Opens YouTube Music in a background tab of the last used window, or in
     * a new window if there's none.
     */
    async open({ url }) {
        if (typeof url !== 'string' || !url.startsWith(YT_MUSIC)) throw new Error('Not a YouTube Music address')
        const front = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null)
        if (!front) {
            const window = await chrome.windows.create({ url, focused: false })
            return { windowId: window.id, tabId: window.tabs[0].id, placement: 'shown' }
        }
        const tab = await chrome.tabs.create({ windowId: front.id, url, active: false })
        return { windowId: tab.windowId, tabId: tab.id, placement: 'background' }
    },

    /** Picks up a newer copy of this extension that Music Bar put in place. */
    reload: () => {
        setTimeout(() => chrome.runtime.reload(), 100)
        return null
    },
}

let port = null

async function handle({ id, op, ...args }) {
    try {
        if (!Object.hasOwn(OPS, op)) throw new Error(`Unknown request: ${op}`)
        const result = await OPS[op](args)
        port?.postMessage({ id, result: result ?? null })
    } catch (error) {
        port?.postMessage({ id, error: { message: error?.message ?? String(error), code: error?.code ?? null } })
    }
}

/**
 * Connects to Music Bar's native host. An open native port also keeps this
 * service worker running, so requests get answered at once. If the host
 * can't start (Music Bar never ran, so it isn't installed yet), retries.
 */
function connect() {
    if (port) return
    port = chrome.runtime.connectNative(HOST)
    port.onMessage.addListener((message) => void handle(message))
    port.onDisconnect.addListener(() => {
        // Read so Chrome doesn't log it as unchecked; the reason is usually
        // that the host isn't installed yet.
        void chrome.runtime.lastError
        port = null
        setTimeout(connect, RECONNECT_MS)
    })
}

// The worker can still be stopped while disconnected; the alarm wakes it to
// try again.
chrome.alarms.create('connect', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener(connect)
chrome.runtime.onStartup.addListener(connect)
chrome.runtime.onInstalled.addListener(connect)
connect()
