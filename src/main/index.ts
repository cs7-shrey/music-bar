import { execFile } from 'child_process'
import { app, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, shell, Tray, type NativeImage } from 'electron'
import { join } from 'path'
import { IPC, type BrowserName, type PlayerControl, type TrackSource } from '../shared/ipc'
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

const SHORTCUT = 'CommandOrControl+Shift+Space'
const SETTINGS_SHORTCUT = 'CommandOrControl+,'

let tray: Tray | null = null

if (!app.requestSingleInstanceLock()) {
    app.quit()
}

// Until browsers are chosen, every way into Music Bar leads to setup.
const needsSetup = () => getSettings().browsers === null

function openMusicBar(): void {
    // An open setup window comes forward, e.g. on a click on the Dock icon
    // it adds.
    if (needsSetup() || isSetupOpen()) showSetup()
    else showLauncher()
}

function openSettings(): void {
    hideLauncher()
    showSetup()
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
            { label: 'Settings…', icon: menuIcon('gearshape'), accelerator: SETTINGS_SHORTCUT, click: openSettings },
            { type: 'separator' },
            { label: 'Quit Music Bar', role: 'quit' },
        ]),
    )
}

app.whenReady().then(() => {
    // Replaces Electron's default menu, whose Hide item owns ⌘H before the
    // launcher sees it (⌘H is "previous"). The Edit menu keeps copy/paste
    // working in the search box, and ⌘, opens settings from the launcher.
    Menu.setApplicationMenu(
        Menu.buildFromTemplate([
            {
                label: app.name,
                submenu: [
                    { label: 'Settings…', accelerator: SETTINGS_SHORTCUT, click: openSettings },
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
    // Opening the app shows setup the first time, then the launcher. Not the
    // launcher in `pnpm dev`, which restarts the app on every main-process
    // change.
    if (needsSetup()) showSetup()
    else if (app.isPackaged) showLauncher()

    ipcMain.on(IPC.launcherHide, () => hideLauncher())
    ipcMain.handle(IPC.nowPlayingGet, () => youtubeMusic.getNowPlaying())
    ipcMain.handle(IPC.nowPlayingGetFollowed, () => youtubeMusic.getFollowedNowPlaying())
    ipcMain.handle(IPC.nowPlayingControl, (_event, source: TrackSource, control: PlayerControl) =>
        youtubeMusic.control(source, control),
    )
    ipcMain.handle(IPC.nowPlayingSetPlaying, (_event, source: TrackSource, playing: boolean) =>
        youtubeMusic.setPlaying(source, playing),
    )
    ipcMain.handle(IPC.nowPlayingLoadTab, (_event, source: TrackSource) => youtubeMusic.loadTab(source))
    ipcMain.handle(IPC.nowPlayingSetLoop, (_event, source: TrackSource, enabled: boolean) =>
        youtubeMusic.setLoop(source, enabled),
    )
    ipcMain.handle(IPC.openYouTubeMusic, async (_event, browser: BrowserName) => {
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
    ipcMain.on(IPC.setupShow, openSettings)
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
    }))
    ipcMain.handle(IPC.setupSetBrowsers, (_event, browsers: BrowserName[]) => updateSettings({ browsers }))
    ipcMain.handle(IPC.setupCheck, (_event, browser: BrowserName) => youtubeMusic.checkBrowser(browser))
    ipcMain.handle(IPC.setupOpenBrowser, (_event, browser: BrowserName) => {
        if (!youtubeMusic.installedBrowsers().some((installed) => installed.browser === browser)) return
        execFile('open', ['-a', browser])
    })
    ipcMain.handle(IPC.setupOpenAutomationSettings, () =>
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Automation'),
    )
    ipcMain.on(IPC.setupFinish, () => {
        void closeSetup().then(showLauncher)
    })
    ipcMain.handle(IPC.artworkFetch, (_event, url: string) => fetchArtwork(url))
    ipcMain.handle(IPC.searchSuggest, (_event, query: string) => youtubeMusicSearch.suggest(query))
    ipcMain.handle(IPC.searchRun, (_event, query: string) => youtubeMusicSearch.search(query))
    ipcMain.handle(IPC.playNow, (_event, videoId: string) => youtubeMusic.playNow(videoId))
    ipcMain.handle(IPC.playNext, (_event, videoId: string) => youtubeMusic.playNext(videoId))
    ipcMain.handle(IPC.showTab, (_event, source: TrackSource) => youtubeMusic.showTab(source))
    ipcMain.handle(IPC.startRadio, (_event, source: TrackSource) => youtubeMusic.startRadio(source))
    ipcMain.handle(IPC.startRadioFromSong, (_event, videoId: string) => youtubeMusic.startRadioFromSong(videoId))

    if (!globalShortcut.register(SHORTCUT, () => (needsSetup() ? showSetup() : toggleLauncher()))) {
        console.warn(`[music-bar] could not register ${SHORTCUT}; another app may own it`)
    }
})

app.on('will-quit', () => globalShortcut.unregisterAll())

// Background app: closing the launcher must never quit it.
app.on('window-all-closed', () => {})
