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
    /** renderer → main (invoke): play or pause a track's tab. */
    nowPlayingSetPlaying: 'now-playing:set-playing',
    /** renderer → main (invoke): turn repeat-one on or off on a track's tab. */
    nowPlayingSetLoop: 'now-playing:set-loop',
    /** renderer → main (invoke): live suggestions and songs while typing. */
    searchSuggest: 'search:suggest',
    /** renderer → main (invoke): the full search, as on /search?q=. */
    searchRun: 'search:run',
    /** renderer → main (invoke): play a song now in the followed tab. */
    playNow: 'player:play-now',
    /** renderer → main (invoke): queue a song right after the current one. */
    playNext: 'player:play-next',
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
    /** Chromium hasn't loaded media in this tab yet; playing wakes it first. */
    isAsleep: boolean
    source: TrackSource
}

export type NowPlaying =
    | { status: 'track'; track: Track }
    | { status: 'none' }
    | { status: 'error'; message: string }

export interface SearchSong {
    videoId: string
    title: string
    artist: string
    kind: 'song' | 'video'
    thumbnailUrl: string | null
}

export type SearchResults =
    | { status: 'ok'; suggestions: string[]; songs: SearchSong[] }
    | { status: 'error'; message: string }

export type PlayerControl = 'previous' | 'next'

export interface MusicBarApi {
    hide(): void
    onShown(listener: () => void): () => void
    onHidden(listener: () => void): () => void
    getNowPlaying(): Promise<NowPlaying>
    control(source: TrackSource, control: PlayerControl): Promise<void>
    /** Plays or pauses; does nothing when the tab is already in that state. */
    setPlaying(source: TrackSource, playing: boolean): Promise<void>
    /** Off restores the repeat mode that was on before looping started. */
    setLoop(source: TrackSource, enabled: boolean): Promise<void>
    suggest(query: string): Promise<SearchResults>
    search(query: string): Promise<SearchResults>
    playNow(song: SearchSong): Promise<void>
    playNext(song: SearchSong): Promise<void>
}
