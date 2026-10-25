import { app, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, Tray } from 'electron'
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

const SHORTCUT = 'CommandOrControl+Shift+Space'

let tray: Tray | null = null

if (!app.requestSingleInstanceLock()) {
    app.quit()
}

app.on('second-instance', () => showLauncher())

function createTray(): void {
    // Text-only status item until we have a proper template icon.
    tray = new Tray(nativeImage.createEmpty())
    tray.setTitle('♫')
    tray.setToolTip('Music Bar')
    tray.setContextMenu(
        Menu.buildFromTemplate([
            { label: 'Open Music Bar', accelerator: SHORTCUT, click: () => showLauncher() },
            { type: 'separator' },
            { label: 'Quit Music Bar', role: 'quit' },
        ]),
    )
}

app.whenReady().then(() => {
    // Replaces Electron's default menu, whose Hide item owns ⌘H before the
    // launcher sees it (⌘H is "previous"). The Edit menu keeps copy/paste
    // working in the search box.
    Menu.setApplicationMenu(
        Menu.buildFromTemplate([{ label: app.name, submenu: [{ role: 'quit' }] }, { role: 'editMenu' }]),
    )
    // Covers `pnpm dev`, where LSUIElement from forge.config.ts does not apply.
    app.dock?.hide()
    // Always dark for now: drives both the vibrancy material and the
    // renderer's prefers-color-scheme.
    nativeTheme.themeSource = 'dark'

    createLauncherWindow()
    createTray()

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
    ipcMain.handle(IPC.artworkFetch, (_event, url: string) => fetchArtwork(url))
    ipcMain.handle(IPC.searchSuggest, (_event, query: string) => youtubeMusicSearch.suggest(query))
    ipcMain.handle(IPC.searchRun, (_event, query: string) => youtubeMusicSearch.search(query))
    ipcMain.handle(IPC.playNow, (_event, videoId: string) => youtubeMusic.playNow(videoId))
    ipcMain.handle(IPC.playNext, (_event, videoId: string) => youtubeMusic.playNext(videoId))
    ipcMain.handle(IPC.startRadio, (_event, source: TrackSource) => youtubeMusic.startRadio(source))
    ipcMain.handle(IPC.startRadioFromSong, (_event, videoId: string) => youtubeMusic.startRadioFromSong(videoId))

    if (!globalShortcut.register(SHORTCUT, toggleLauncher)) {
        console.warn(`[music-bar] could not register ${SHORTCUT}; another app may own it`)
    }
})

app.on('will-quit', () => globalShortcut.unregisterAll())

// Background app: closing the launcher must never quit it.
app.on('window-all-closed', () => {})
