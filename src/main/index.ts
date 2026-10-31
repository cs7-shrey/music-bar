import { execFile } from 'child_process'
import { app, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, shell, Tray, type NativeImage } from 'electron'
import { join } from 'path'
import { IPC, type BrowserName, type PlayerControl, type SettingsSection, type TrackSource } from '../shared/ipc'
import {
    createLauncherWindow,
    focusLauncher,
    hideLauncher,
    holdThroughBlur,
    showLauncher,
    toggleLauncher,
} from './launcher-window'
import * as youtubeMusic from './youtube-music'
import * as youtubeMusicSearch from './youtube-music-search'
import { fetchArtwork } from './artwork'
import { activateApp, frontmostApp } from './frontmost-app'
import { getSettings, updateSettings } from './settings'
import { closeSetup, isSetupOpen, showSetup } from './setup-window'
import { describe, logFile, logger } from './log'
import { canOpenAtLogin, isOpenAtLogin, openedAtLogin, refreshOpenAtLogin, setOpenAtLogin } from './login-item'
import { borrowSystemShortcut, returnSystemShortcuts } from './system-shortcuts'

// macOS 27 gives ⌘⇧Space to Siri; Music Bar borrows it while running (see
// system-shortcuts.ts). If that fails, ⌥⇧Space opens the launcher too.
const SHORTCUT = 'Command+Shift+Space'
const FALLBACK_SHORTCUT = 'Alt+Shift+Space'
const SETTINGS_SHORTCUT = 'CommandOrControl+,'

let tray: Tray | null = null

const log = logger('app')

// Logged rather than shown as Electron's error dialog; the app keeps running.
process.on('uncaughtException', (error) => log.error('uncaught exception', error))
process.on('unhandledRejection', (reason) => log.error('unhandled rejection', reason))
app.on('render-process-gone', (_event, contents, { reason, exitCode }) =>
    log.error(`renderer gone (${contents.getURL()})`, { reason, exitCode }),
)
app.on('child-process-gone', (_event, { type, reason, exitCode }) =>
    log.error(`${type} process gone`, { reason, exitCode }),
)
// Warnings and errors from every window, uncaught renderer errors included.
app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', ({ level, message, sourceId, lineNumber }) => {
        if (level === 'warning' || level === 'error') {
            const where = `${contents.getURL().split('#')[1] ?? 'launcher'}: ${sourceId.split('/').pop()}:${lineNumber}`
            logger('renderer')[level === 'error' ? 'error' : 'warn'](message, where)
        }
    })
})

/**
 * Handles an IPC call for something the user did, logging it with its
 * arguments, how long it took and how it ended.
 */
function handleAction<Args extends unknown[]>(channel: string, action: (...args: Args) => unknown): void {
    ipcMain.handle(channel, async (_event, ...args) => {
        const started = Date.now()
        try {
            const result = await action(...(args as Args))
            log.info(`${channel} ok in ${Date.now() - started}ms`, ...args)
            return result
        } catch (error) {
            log.warn(`${channel} failed in ${Date.now() - started}ms: ${describe(error)}`, ...args)
            throw error
        }
    })
}

if (!app.requestSingleInstanceLock()) {
    app.quit()
}

// Until browsers are chosen, and then until Music Bar is first opened with
// its shortcut, every way into Music Bar leads to setup.
const needsSetup = () => getSettings().browsers === null || getSettings().awaitingShortcut

function openMusicBar(): void {
    // An open setup window comes forward, e.g. on a click on the Dock icon
    // it adds.
    if (needsSetup() || isSetupOpen()) showSetup()
    else showLauncher()
}

function openSettings(section?: SettingsSection): void {
    hideLauncher()
    showSetup(section)
}

/** A menu icon from an SF Symbol, sharp on Retina and tinted like menu text. */
function menuIcon(symbol: string): NativeImage {
    const source = nativeImage.createFromNamedImage(symbol)
    const icon = nativeImage.createEmpty()
    for (const scaleFactor of [1, 2]) {
        const buffer = source.resize({ height: 16 * scaleFactor, quality: 'best' }).toPNG()
        icon.addRepresentation({ scaleFactor, buffer })
    }
    icon.setTemplateImage(true)
    return icon
}

app.on('second-instance', openMusicBar)
// Opening the app again from Spotlight, Finder or Launchpad while it runs
// reopens it rather than starting a second copy. Show the launcher, like
// Raycast, instead of quietly taking focus with nothing on screen.
app.on('activate', openMusicBar)

function createTray(): void {
    // A template image: macOS tints it for light and dark menu bars and picks
    // trayTemplate@2x.png on Retina screens. Packaged builds carry it in
    // Resources (extraResource in forge.config.ts).
    const assets = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'assets')
    const icon = nativeImage.createFromPath(join(assets, 'trayTemplate.png'))
    icon.setTemplateImage(true)
    tray = new Tray(icon)
    tray.setToolTip('Music Bar')
    tray.setContextMenu(
        Menu.buildFromTemplate([
            { label: 'Open Music Bar', accelerator: SHORTCUT, click: openMusicBar },
            { label: 'Settings…', icon: menuIcon('gearshape'), accelerator: SETTINGS_SHORTCUT, click: () => openSettings() },
            { label: 'Show Log File', click: () => shell.showItemInFolder(logFile()) },
            { type: 'separator' },
            { label: 'Quit Music Bar', role: 'quit' },
        ]),
    )
}

app.whenReady().then(() => {
    log.info(`Music Bar ${app.getVersion()} started`, {
        electron: process.versions.electron,
        macOS: process.getSystemVersion(),
        arch: process.arch,
        packaged: app.isPackaged,
        openedAtLogin,
        openAtLogin: isOpenAtLogin(),
        installed: youtubeMusic.installedBrowsers().map(({ browser }) => browser),
        chosen: getSettings().browsers,
    })
    // Replaces Electron's default menu, whose Hide item owns ⌘H before the
    // launcher sees it (⌘H is "previous"). The Edit menu keeps copy/paste
    // working in the search box, and ⌘, opens settings from the launcher.
    Menu.setApplicationMenu(
        Menu.buildFromTemplate([
            {
                label: app.name,
                submenu: [
                    { label: 'Settings…', accelerator: SETTINGS_SHORTCUT, click: () => openSettings() },
                    { type: 'separator' },
                    { role: 'quit' },
                ],
            },
            { role: 'editMenu' },
        ]),
    )
    // Covers `pnpm dev`, where LSUIElement from forge.config.ts does not apply.
    app.dock?.hide()
    // Always dark for now: drives both the vibrancy material and the
    // renderer's prefers-color-scheme.
    nativeTheme.themeSource = 'dark'

    createLauncherWindow()
    createTray()
    refreshOpenAtLogin()
    // Opening the app shows setup the first time, then the launcher. Not the
    // launcher at login, which starts quietly in the menu bar, or in
    // `pnpm dev`, which restarts the app on every main-process change.
    if (needsSetup()) showSetup()
    else if (app.isPackaged && !openedAtLogin) showLauncher()

    ipcMain.on(IPC.launcherHide, () => hideLauncher())
    ipcMain.handle(IPC.nowPlayingGet, () => youtubeMusic.getNowPlaying())
    ipcMain.handle(IPC.nowPlayingGetFollowed, () => youtubeMusic.getFollowedNowPlaying())
    // Reads poll every second or so and aren't logged per call;
    // youtube-music.ts logs when what they find changes.
    handleAction(IPC.nowPlayingControl, (source: TrackSource, control: PlayerControl) =>
        youtubeMusic.control(source, control),
    )
    handleAction(IPC.nowPlayingSetPlaying, (source: TrackSource, playing: boolean) =>
        youtubeMusic.setPlaying(source, playing),
    )
    handleAction(IPC.nowPlayingLoadTab, (source: TrackSource) => youtubeMusic.loadTab(source))
    handleAction(IPC.nowPlayingSetLoop, (source: TrackSource, enabled: boolean) => youtubeMusic.setLoop(source, enabled))
    handleAction(IPC.openYouTubeMusic, async (browser: BrowserName) => {
        // The browser comes forward when the tab is made. The app the user
        // was in goes back in front right after, and the launcher takes the
        // keyboard again; it stays up through all that so the search results
        // still show.
        const previousApp = await frontmostApp()
        const returnFocus = async () => {
            if (previousApp && previousApp.pid !== process.pid) await activateApp(previousApp)
            focusLauncher()
        }
        holdThroughBlur(15_000)
        return youtubeMusic.openYouTubeMusic(browser, returnFocus).finally(() => holdThroughBlur(0))
    })
    ipcMain.on(IPC.setupShow, (_event, section?: SettingsSection) => openSettings(section))
    ipcMain.handle(IPC.loginItemGet, () => ({ enabled: isOpenAtLogin(), available: canOpenAtLogin() }))
    handleAction(IPC.loginItemSet, (enabled: boolean) => setOpenAtLogin(enabled))
    ipcMain.handle(IPC.setupGet, async () => ({
        installed: await Promise.all(
            youtubeMusic.installedBrowsers().map(async ({ browser, path }) => ({
                browser,
                // Not app.getFileIcon: it crashes Electron on macOS 26.
                icon: await nativeImage
                    .createThumbnailFromPath(path, { width: 72, height: 72 })
                    .then((image) => image.toDataURL())
                    .catch(() => null),
            })),
        ),
        chosen: getSettings().browsers,
        awaitingShortcut: getSettings().awaitingShortcut,
    }))
    handleAction(IPC.setupSetBrowsers, (browsers: BrowserName[]) => updateSettings({ browsers }))
    ipcMain.handle(IPC.setupCheck, (_event, browser: BrowserName) => youtubeMusic.checkBrowser(browser))
    handleAction(IPC.setupOpenBrowser, (browser: BrowserName) => {
        if (!youtubeMusic.installedBrowsers().some((installed) => installed.browser === browser)) return
        execFile('open', ['-a', browser])
    })
    ipcMain.handle(IPC.setupOpenAutomationSettings, () =>
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Automation'),
    )
    ipcMain.on(IPC.setupFinish, () => {
        updateSettings({ awaitingShortcut: true })
        log.info('setup finished', getSettings())
    })
    ipcMain.handle(IPC.artworkFetch, (_event, url: string) => fetchArtwork(url))
    ipcMain.handle(IPC.searchSuggest, (_event, query: string) => youtubeMusicSearch.suggest(query))
    ipcMain.handle(IPC.searchRun, (_event, query: string) => youtubeMusicSearch.search(query))
    handleAction(IPC.playNow, (videoId: string) => youtubeMusic.playNow(videoId))
    handleAction(IPC.playNext, (videoId: string) => youtubeMusic.playNext(videoId))
    handleAction(IPC.showTab, (source: TrackSource) => youtubeMusic.showTab(source))
    handleAction(IPC.startRadio, (source: TrackSource) => youtubeMusic.startRadio(source))
    handleAction(IPC.startRadioFromSong, (videoId: string) => youtubeMusic.startRadioFromSong(videoId))

    const openFromShortcut = () => {
        if (getSettings().browsers === null) return showSetup()
        if (getSettings().awaitingShortcut) {
            // Setup's last screen asked for this press: the user has the
            // shortcut now, so setup is over.
            updateSettings({ awaitingShortcut: false })
            log.info('opened with the shortcut for the first time')
            return void closeSetup().then(showLauncher)
        }
        toggleLauncher()
    }
    const borrowed = borrowSystemShortcut(SHORTCUT)
    for (const shortcut of borrowed ? [SHORTCUT] : [SHORTCUT, FALLBACK_SHORTCUT]) {
        if (!globalShortcut.register(shortcut, openFromShortcut)) {
            log.warn(`couldn't register ${shortcut}; another app may own it`)
        }
    }
})

app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    returnSystemShortcuts()
})

// Background app: closing the launcher must never quit it.
app.on('window-all-closed', () => {})
