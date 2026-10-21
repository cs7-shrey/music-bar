import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type MusicBarApi } from '../shared/ipc'

function subscribe(channel: string, listener: () => void): () => void {
    const handler = () => listener()
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
}

const api: MusicBarApi = {
    hide: () => ipcRenderer.send(IPC.launcherHide),
    onShown: (listener) => subscribe(IPC.launcherShown, listener),
    onHidden: (listener) => subscribe(IPC.launcherHidden, listener),
    getNowPlaying: () => ipcRenderer.invoke(IPC.nowPlayingGet),
    control: (source, control) => ipcRenderer.invoke(IPC.nowPlayingControl, source, control),
    setPlaying: (source, playing) => ipcRenderer.invoke(IPC.nowPlayingSetPlaying, source, playing),
    loadTab: (source) => ipcRenderer.invoke(IPC.nowPlayingLoadTab, source),
    setLoop: (source, enabled) => ipcRenderer.invoke(IPC.nowPlayingSetLoop, source, enabled),
    suggest: (query) => ipcRenderer.invoke(IPC.searchSuggest, query),
    search: (query) => ipcRenderer.invoke(IPC.searchRun, query),
    playNow: (song) => ipcRenderer.invoke(IPC.playNow, song.videoId),
    playNext: (song) => ipcRenderer.invoke(IPC.playNext, song.videoId),
}

contextBridge.exposeInMainWorld('musicBar', api)
