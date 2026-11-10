import { spawn } from 'child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from 'fs'
import { createServer, type Socket } from 'net'
import { homedir, tmpdir } from 'os'
import { delimiter, dirname, join } from 'path'
import { app, nativeImage } from 'electron'
import type { BrowserName, BrowserStatus } from '../shared/ipc'
import { describe, logger } from './log'
import { resourcePath } from './resources'
import { TransportError, type BrowserRead, type RawTab, type TabTransport } from './tab-transport'

// Reaches YouTube Music tabs on Linux through Music Bar's browser extension
// (extension/), since there's no AppleScript. The browser starts the
// extension's native messaging host (native-host/music-bar-host.js), which
// connects to the socket here. Each connection is one browser profile with
// the extension; requests go to it and it runs Music Bar's scripts in the
// tab with chrome.userScripts, in an isolated world, as macOS does.
//
// Setting up a browser: Music Bar installs the host for every supported
// browser at startup. The user loads the extension once (chrome://extensions
// → Developer mode → Load unpacked) and turns on "Allow User Scripts" for it.

type LinuxBrowser = 'Brave Browser' | 'Google Chrome' | 'Chromium'

const BROWSERS: LinuxBrowser[] = ['Brave Browser', 'Google Chrome', 'Chromium']

interface BrowserInfo {
    /** Commands that start it, the first one on PATH wins. */
    commands: string[]
    /** Its profile folder under ~/.config, where native hosts are registered. */
    configDir: string
    /** Its name in icon themes. */
    icon: string
    /** Matches the path of its running executable. */
    executable: RegExp
}

const INFO: Record<LinuxBrowser, BrowserInfo> = {
    'Brave Browser': {
        commands: ['brave-browser', 'brave-browser-stable', 'brave'],
        configDir: 'BraveSoftware/Brave-Browser',
        icon: 'brave-browser',
        executable: /\/brave\.com\/brave\/brave$/,
    },
    'Google Chrome': {
        commands: ['google-chrome-stable', 'google-chrome'],
        configDir: 'google-chrome',
        icon: 'google-chrome',
        executable: /\/google\/chrome\/chrome$/,
    },
    Chromium: {
        commands: ['chromium', 'chromium-browser'],
        configDir: 'chromium',
        icon: 'chromium',
        executable: /\/chromium[^/]*\/chrom(e|ium)$/,
    },
}

const isLinuxBrowser = (browser: BrowserName): browser is LinuxBrowser => (BROWSERS as BrowserName[]).includes(browser)

/** The native messaging host's name; the extension connects to it by this name. */
const HOST_NAME = 'dev.shrey.music_bar'
/** The extension's id, fixed by the key in extension/manifest.json. */
const EXTENSION_ID = 'iahjmfmcanmfbcdnkbnlmkcigeehaneb'

const REQUEST_TIMEOUT_MS = 10_000
const HELLO_TIMEOUT_MS = 5000
// Seconds a request gets beyond the tab's own timeout, for the round trip.
const ROUND_TRIP_SLACK_MS = 2000
const RUNNING_CACHE_MS = 1000

const log = logger('linux-bridge')

const configHome = () => process.env.XDG_CONFIG_HOME || join(homedir(), '.config')

// The same path the host works out (native-host/music-bar-host.js).
const runtimeDir = () => process.env.XDG_RUNTIME_DIR || join(tmpdir(), `music-bar-${process.getuid?.()}`)
const socketPath = () => process.env.MUSIC_BAR_SOCKET || join(runtimeDir(), 'music-bar', 'bridge.sock')

/** Where the extension is copied for the user to load, so the path survives updates. */
export const extensionDir = () => join(app.getPath('userData'), 'extension')

function findCommand(commands: string[]): string | null {
    const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
    for (const command of commands) {
        for (const dir of dirs) {
            const path = join(dir, command)
            try {
                if (statSync(path).isFile()) return path
            } catch {
                // Not here.
            }
        }
    }
    return null
}

const commandPaths = new Map<LinuxBrowser, string>()
for (const browser of BROWSERS) {
    const path = findCommand(INFO[browser].commands)
    if (path) commandPaths.set(browser, path)
}

let runningCache: { at: number; executables: string[] } | null = null

/**
 * A process's executable: where /proc/<pid>/exe points, else its argv[0].
 * Chromium-based browsers rewrite their command line into one string with
 * spaces between the arguments, so argv[0] is read up to the first space.
 */
function executableOf(pid: string): string | null {
    try {
        return readlinkSync(`/proc/${pid}/exe`)
    } catch {
        try {
            return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')[0].split(' ')[0] || null
        } catch {
            return null // Gone.
        }
    }
}

/** The executables of every process this user can see. */
function runningExecutables(): string[] {
    if (runningCache && Date.now() - runningCache.at < RUNNING_CACHE_MS) return runningCache.executables
    const executables = new Set<string>()
    for (const pid of readdirSync('/proc')) {
        if (!/^\d+$/.test(pid)) continue
        const executable = executableOf(pid)
        if (executable) executables.add(executable)
    }
    runningCache = { at: Date.now(), executables: [...executables] }
    return runningCache.executables
}

const isRunning = (browser: LinuxBrowser) => runningExecutables().some((path) => INFO[browser].executable.test(path))

/** The browser's icon from the icon theme, as installed alongside it. */
function findIcon(browser: LinuxBrowser): string | null {
    const dataDirs = [
        process.env.XDG_DATA_HOME || join(homedir(), '.local/share'),
        ...(process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(delimiter),
    ]
    const command = commandPaths.get(browser)
    if (command) {
        try {
            // Its own share folder, e.g. a Nix store path's.
            dataDirs.push(join(dirname(dirname(realpathSync(command))), 'share'))
        } catch {
            // Dangling link.
        }
    }
    for (const dir of dataDirs) {
        for (const size of ['128x128', '256x256', '96x96', '64x64', '48x48']) {
            const path = join(dir, 'icons/hicolor', size, 'apps', `${INFO[browser].icon}.png`)
            if (existsSync(path)) return path
        }
    }
    const pixmap = join('/usr/share/pixmaps', `${INFO[browser].icon}.png`)
    return existsSync(pixmap) ? pixmap : null
}

/** Quotes a string for sh. */
const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

/**
 * Puts the extension where the user loads it from, and registers the native
 * host with every supported browser. Run at each start: an update moves the
 * app (a new Nix store path, say), and the host must follow it.
 */
function install(): void {
    const extension = extensionDir()
    rmSync(extension, { recursive: true, force: true })
    cpSync(resourcePath('extension'), extension, { recursive: true })

    // The browser runs the host with no arguments, so a script hands Music
    // Bar's own Electron binary the host to run as plain Node.
    const hostScript = join(app.getPath('userData'), 'native-host')
    writeFileSync(
        hostScript,
        [
            '#!/bin/sh',
            '# Written by Music Bar at each start. Browsers run it for the Music Bar extension.',
            'export ELECTRON_RUN_AS_NODE=1',
            `exec ${shellQuote(process.execPath)} ${shellQuote(resourcePath('music-bar-host.js'))} "$@"`,
            '',
        ].join('\n'),
    )
    chmodSync(hostScript, 0o755)

    const manifest = JSON.stringify(
        {
            name: HOST_NAME,
            description: 'Music Bar',
            path: hostScript,
            type: 'stdio',
            allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
        },
        null,
        4,
    )
    for (const browser of BROWSERS) {
        // Only browsers that have a profile; others would get a folder for nothing.
        const profile = join(configHome(), INFO[browser].configDir)
        if (!existsSync(profile)) continue
        const hosts = join(profile, 'NativeMessagingHosts')
        mkdirSync(hosts, { recursive: true })
        writeFileSync(join(hosts, `${HOST_NAME}.json`), manifest)
    }
}

interface Connection {
    socket: Socket
    /** Null until the extension says which browser it's in. */
    browser: LinuxBrowser | null
    /** The tabs its last read found, so requests for them come back here. */
    tabs: Set<number>
    pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>
}

const connections = new Set<Connection>()
let nextRequestId = 1

function request<T>(connection: Connection, op: string, args: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    const id = nextRequestId++
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            connection.pending.delete(id)
            reject(new TransportError(`${connection.browser ?? 'The browser'} didn't answer in time`, 'timeout'))
        }, timeoutMs)
        connection.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
        connection.socket.write(JSON.stringify({ id, op, ...args }) + '\n')
    })
}

function onMessage(connection: Connection, line: string): void {
    let message: { id?: number; result?: unknown; error?: { message: string; code: string | null } }
    try {
        message = JSON.parse(line)
    } catch {
        return
    }
    const pending = message.id === undefined ? undefined : connection.pending.get(message.id)
    if (!pending) return
    connection.pending.delete(message.id!)
    clearTimeout(pending.timer)
    if (message.error) pending.reject(new TransportError(message.error.message, message.error.code))
    else pending.resolve(message.result)
}

function shippedExtensionVersion(): string | null {
    try {
        return JSON.parse(readFileSync(resourcePath('extension/manifest.json'), 'utf8')).version
    } catch {
        return null
    }
}

async function greet(connection: Connection): Promise<void> {
    try {
        const hello = await request<{ browser: string | null; version: string; userScripts: boolean }>(
            connection,
            'hello',
            {},
            HELLO_TIMEOUT_MS,
        )
        connection.browser = hello.browser && isLinuxBrowser(hello.browser as BrowserName) ? (hello.browser as LinuxBrowser) : null
        log.info(`extension connected in ${hello.browser ?? 'an unknown browser'}`, {
            version: hello.version,
            userScripts: hello.userScripts,
        })
        // The copy in the extension folder is newer (Music Bar was updated):
        // the browser only reads it on a reload.
        const shipped = shippedExtensionVersion()
        if (shipped && hello.version !== shipped) {
            log.info(`reloading the extension: ${hello.version} → ${shipped}`)
            void request(connection, 'reload', {}).catch(() => {})
        }
    } catch (error) {
        log.warn(`extension didn't say hello: ${describe(error)}`)
    }
}

/** Starts the socket the native host connects to, after installing the host. */
export function startLinuxBridge(): void {
    try {
        install()
    } catch (error) {
        log.error(`couldn't install the browser extension's host: ${describe(error)}`)
    }

    const path = socketPath()
    // The socket lives in a folder only this user can open: whoever reaches
    // it can run scripts in their YouTube Music tabs.
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    chmodSync(dirname(path), 0o700)
    rmSync(path, { force: true })

    const server = createServer((socket) => {
        const connection: Connection = { socket, browser: null, tabs: new Set(), pending: new Map() }
        connections.add(connection)
        let buffered = ''
        socket.setEncoding('utf8')
        socket.on('data', (chunk: string) => {
            buffered += chunk
            let newline
            while ((newline = buffered.indexOf('\n')) !== -1) {
                onMessage(connection, buffered.slice(0, newline))
                buffered = buffered.slice(newline + 1)
            }
        })
        socket.on('error', () => {})
        socket.on('close', () => {
            connections.delete(connection)
            for (const { reject, timer } of connection.pending.values()) {
                clearTimeout(timer)
                reject(new TransportError(`${connection.browser ?? 'The browser'} disconnected`, 'disconnected'))
            }
            log.info(`extension disconnected from ${connection.browser ?? 'an unknown browser'}`)
        })
        void greet(connection)
    })
    server.on('error', (error) => log.error(`browser bridge socket failed: ${describe(error)}`))
    server.listen(path, () => log.info(`listening for the browser extension on ${path}`))
}

/**
 * Opens the browser's extensions page, where the user loads the extension
 * (Brave and Chromium take chrome:// addresses too).
 */
export function openExtensionsPage(browser: BrowserName): void {
    const command = isLinuxBrowser(browser) ? commandPaths.get(browser) : undefined
    if (!command) throw new Error('Unsupported browser')
    spawn(command, ['chrome://extensions/'], { detached: true, stdio: 'ignore' }).unref()
}

const connectionsFor = (browser: BrowserName) => [...connections].filter((connection) => connection.browser === browser)

/** The connection that owns a tab, else any for that browser. */
function connectionForTab(browser: BrowserName, tabId: number): Connection {
    const candidates = connectionsFor(browser)
    const connection = candidates.find((candidate) => candidate.tabs.has(tabId)) ?? candidates[0]
    if (!connection) throw new TransportError(`The Music Bar extension isn't connected in ${browser}`, 'no-extension')
    return connection
}

export const linuxTransport: TabTransport = {
    browsers: BROWSERS,
    openHint: 'Open YouTube Music in Brave, Chrome or Chromium',

    installedBrowsers: () => [...commandPaths.keys()],

    async browserIcon(browser) {
        if (!isLinuxBrowser(browser)) return null
        const path = findIcon(browser)
        if (!path) return null
        const image = nativeImage.createFromPath(path)
        return image.isEmpty() ? null : image.resize({ width: 72, height: 72, quality: 'best' }).toDataURL()
    },

    openBrowser(browser) {
        const command = isLinuxBrowser(browser) ? commandPaths.get(browser) : undefined
        if (!command) return
        spawn(command, [], { detached: true, stdio: 'ignore' }).unref()
    },

    async readTabs(browser, js, skipTabIds, tabTimeoutSeconds, timeoutMs = REQUEST_TIMEOUT_MS) {
        if (!isLinuxBrowser(browser)) throw new Error('Unsupported browser')
        const browserConnections = connectionsFor(browser)
        if (browserConnections.length === 0) {
            if (!isRunning(browser)) return { running: false, tabs: [] }
            throw new TransportError(`The Music Bar extension isn't connected in ${browser}`, 'no-extension')
        }
        // One per profile with the extension; together they're the browser.
        const reads = await Promise.all(
            browserConnections.map(async (connection): Promise<RawTab[]> => {
                try {
                    const tabs = await request<RawTab[]>(
                        connection,
                        'read',
                        { code: js, skip: skipTabIds, timeoutMs: tabTimeoutSeconds * 1000 },
                        timeoutMs,
                    )
                    connection.tabs = new Set(tabs.flatMap((tab) => ('tabId' in tab ? [tab.tabId] : [])))
                    return tabs
                } catch (error) {
                    const code = error instanceof TransportError ? error.code : null
                    return [{ kind: 'error', code, message: describe(error) }]
                }
            }),
        )
        return { running: true, tabs: reads.flat() }
    },

    executeInTab(source, js, timeoutSeconds) {
        const timeoutMs = timeoutSeconds * 1000
        return request<string>(
            connectionForTab(source.browser, source.tabId),
            'exec',
            { tabId: source.tabId, code: js, timeoutMs },
            timeoutMs + ROUND_TRIP_SLACK_MS,
        )
    },

    activateTab: (source) => request<string>(connectionForTab(source.browser, source.tabId), 'activate', { tabId: source.tabId }),

    async restoreTab(source, previousTabId) {
        await request(connectionForTab(source.browser, source.tabId), 'restore', {
            tabId: source.tabId,
            previousTabId: Number(previousTabId),
        })
    },

    async showTab(source) {
        await request(connectionForTab(source.browser, source.tabId), 'show', { tabId: source.tabId })
    },

    async openTab(browser, url) {
        const connection = connectionsFor(browser)[0]
        if (!connection) throw new TransportError(`The Music Bar extension isn't connected in ${browser}`, 'no-extension')
        const opened = await request<{ windowId: number; tabId: number; placement: 'shown' | 'background' }>(
            connection,
            'open',
            { url },
        )
        connection.tabs.add(opened.tabId)
        return opened
    },

    status({ browser, results }: BrowserRead): BrowserStatus {
        const errors = results.flatMap((result) => ('error' in result ? [result] : []))
        if (errors.some((error) => error.code === 'no-extension')) return { browser, state: 'needs-extension' }
        // "Allow User Scripts" is this platform's "Allow JavaScript from Apple Events".
        if (errors.some((error) => error.code === 'user-scripts-off')) return { browser, state: 'needs-setup' }
        // Inactive tabs count as connected: the card offers to load them.
        if (results.some((result) => 'source' in result)) return { browser, state: 'connected' }
        if (errors[0]) return { browser, state: 'error', message: errors[0].error }
        return { browser, state: 'no-tab' }
    },
}
