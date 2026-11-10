import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type MusicBarApi, type SettingsSection } from '../shared/ipc'

function subscribe(channel: string, listener: () => void): () => void {
    const handler = () => listener()
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
}

const api: MusicBarApi = {
    // Only macOS and Linux are built.
    platform: process.platform === 'darwin' ? 'darwin' : 'linux',
    // From main (src/main/session.ts), which knows the platform Electron chose.
    wayland: process.argv.includes('--music-bar-wayland'),
    hide: () => ipcRenderer.send(IPC.launcherHide),
    onShown: (listener) => subscribe(IPC.launcherShown, listener),
    onHidden: (listener) => subscribe(IPC.launcherHidden, listener),
    getNowPlaying: () => ipcRenderer.invoke(IPC.nowPlayingGet),
    getFollowedNowPlaying: () => ipcRenderer.invoke(IPC.nowPlayingGetFollowed),
    control: (source, control) => ipcRenderer.invoke(IPC.nowPlayingControl, source, control),
    setPlaying: (source, playing) => ipcRenderer.invoke(IPC.nowPlayingSetPlaying, source, playing),
    loadTab: (source) => ipcRenderer.invoke(IPC.nowPlayingLoadTab, source),
    setLoop: (source, enabled) => ipcRenderer.invoke(IPC.nowPlayingSetLoop, source, enabled),
    openYouTubeMusic: (browser) => ipcRenderer.invoke(IPC.openYouTubeMusic, browser),
    fetchArtwork: (url) => ipcRenderer.invoke(IPC.artworkFetch, url),
    suggest: (query) => ipcRenderer.invoke(IPC.searchSuggest, query),
    search: (query) => ipcRenderer.invoke(IPC.searchRun, query),
    playNow: (song) => ipcRenderer.invoke(IPC.playNow, song.service, song.id),
    playNext: (song) => ipcRenderer.invoke(IPC.playNext, song.service, song.id),
    startRadio: (source) => ipcRenderer.invoke(IPC.startRadio, source),
    startRadioFromSong: (song) => ipcRenderer.invoke(IPC.startRadioFromSong, song.service, song.id),
    showTab: (source) => ipcRenderer.invoke(IPC.showTab, source),
    showSetup: (section) => ipcRenderer.send(IPC.setupShow, section),
    onSettingsSection: (listener) => {
        const handler = (_event: unknown, section: SettingsSection) => listener(section)
        ipcRenderer.on(IPC.settingsSection, handler)
        return () => ipcRenderer.removeListener(IPC.settingsSection, handler)
    },
    getOpenAtLogin: () => ipcRenderer.invoke(IPC.loginItemGet),
    setOpenAtLogin: (enabled) => ipcRenderer.invoke(IPC.loginItemSet, enabled),
    getSetup: () => ipcRenderer.invoke(IPC.setupGet),
    setBrowsers: (browsers) => ipcRenderer.invoke(IPC.setupSetBrowsers, browsers),
    checkBrowser: (browser) => ipcRenderer.invoke(IPC.setupCheck, browser),
    openBrowser: (browser) => ipcRenderer.invoke(IPC.setupOpenBrowser, browser),
    openAutomationSettings: () => ipcRenderer.invoke(IPC.setupOpenAutomationSettings),
    getExtensionFolder: () => ipcRenderer.invoke(IPC.setupGetExtensionFolder),
    showExtensionFolder: () => ipcRenderer.invoke(IPC.setupShowExtensionFolder),
    openExtensionsPage: (browser) => ipcRenderer.invoke(IPC.setupOpenExtensionsPage, browser),
    finishSetup: () => ipcRenderer.send(IPC.setupFinish),
    getSpotify: () => ipcRenderer.invoke(IPC.spotifyGet),
    setSpotifyEnabled: (enabled) => ipcRenderer.invoke(IPC.spotifySetEnabled, enabled),
    openSpotify: () => ipcRenderer.invoke(IPC.spotifyOpen),
    connectSpotify: (clientId) => ipcRenderer.invoke(IPC.spotifyConnect, clientId),
    disconnectSpotify: () => ipcRenderer.invoke(IPC.spotifyDisconnect),
    openSpotifyDashboard: () => ipcRenderer.invoke(IPC.spotifyOpenDashboard),
    getUpdate: () => ipcRenderer.invoke(IPC.updateGet),
    installUpdate: () => ipcRenderer.send(IPC.updateInstall),
    onUpdateReady: (listener) => subscribe(IPC.updateReady, listener),
}

contextBridge.exposeInMainWorld('musicBar', api)
