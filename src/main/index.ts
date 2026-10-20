import { app, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, Tray } from 'electron'
import { IPC, type PlayerControl, type TrackSource } from '../shared/ipc'
import { createLauncherWindow, hideLauncher, showLauncher, toggleLauncher } from './launcher-window'
import * as youtubeMusic from './youtube-music'
import * as youtubeMusicSearch from './youtube-music-search'

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
    ipcMain.handle(IPC.nowPlayingControl, (_event, source: TrackSource, control: PlayerControl) =>
        youtubeMusic.control(source, control),
    )
    ipcMain.handle(IPC.nowPlayingSetPlaying, (_event, source: TrackSource, playing: boolean) =>
        youtubeMusic.setPlaying(source, playing),
    )
    ipcMain.handle(IPC.nowPlayingSetLoop, (_event, source: TrackSource, enabled: boolean) =>
        youtubeMusic.setLoop(source, enabled),
    )
    ipcMain.handle(IPC.searchSuggest, (_event, query: string) => youtubeMusicSearch.suggest(query))
    ipcMain.handle(IPC.searchRun, (_event, query: string) => youtubeMusicSearch.search(query))
    ipcMain.handle(IPC.playNow, (_event, videoId: string) => youtubeMusic.playNow(videoId))
    ipcMain.handle(IPC.playNext, (_event, videoId: string) => youtubeMusic.playNext(videoId))

    if (!globalShortcut.register(SHORTCUT, toggleLauncher)) {
        console.warn(`[music-bar] could not register ${SHORTCUT}; another app may own it`)
    }
})

app.on('will-quit', () => globalShortcut.unregisterAll())

// Background app: closing the launcher must never quit it.
app.on('window-all-closed', () => {})
