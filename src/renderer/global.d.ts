import type { MusicBarApi } from '../shared/ipc'

declare global {
    interface Window {
        musicBar: MusicBarApi
    }
}
