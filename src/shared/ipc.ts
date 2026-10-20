export const IPC = {
    /** main → renderer: the launcher was just shown; reset and focus the input. */
    launcherShown: 'launcher:shown',
    /** main → renderer: the launcher was hidden; stop any polling. */
    launcherHidden: 'launcher:hidden',
    /** renderer → main: dismiss the launcher and return focus to the previous app. */
    launcherHide: 'launcher:hide',
    /** renderer → main (invoke): read the current YouTube Music track. */
    nowPlayingGet: 'now-playing:get',
    /** renderer → main (invoke): press a player-bar control on a track's tab. */
    nowPlayingControl: 'now-playing:control',
    /** renderer → main (invoke): turn repeat-one on or off on a track's tab. */
    nowPlayingSetLoop: 'now-playing:set-loop',
} as const

export type BrowserName = 'Brave Browser' | 'Google Chrome' | 'Helium'

/** Identifies the browser tab a track is playing in. */
export interface TrackSource {
    browser: BrowserName
    windowId: number
    tabId: number
}

/** YouTube Music's `repeat-mode` attribute: off, whole queue, current song. */
export type RepeatMode = 'NONE' | 'ALL' | 'ONE'

export interface Track {
    title: string
    artist: string
    album: string
    artworkUrl: string | null
    isPlaying: boolean
    repeatMode: RepeatMode
    source: TrackSource
}

export type NowPlaying =
    | { status: 'track'; track: Track }
    | { status: 'none' }
    | { status: 'error'; message: string }

export type PlayerControl = 'previous' | 'play-pause' | 'next'

export interface MusicBarApi {
    hide(): void
    onShown(listener: () => void): () => void
    onHidden(listener: () => void): () => void
    getNowPlaying(): Promise<NowPlaying>
    control(source: TrackSource, control: PlayerControl): Promise<void>
    /** Off restores the repeat mode that was on before looping started. */
    setLoop(source: TrackSource, enabled: boolean): Promise<void>
}
