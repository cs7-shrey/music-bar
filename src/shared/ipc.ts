export const IPC = {
    /** main → renderer: the launcher was just shown; reset and focus the input. */
    launcherShown: 'launcher:shown',
    /** main → renderer: the launcher was hidden; stop any polling. */
    launcherHidden: 'launcher:hidden',
    /** renderer → main: dismiss the launcher and return focus to the previous app. */
    launcherHide: 'launcher:hide',
    /** renderer → main (invoke): read the current YouTube Music track. */
    nowPlayingGet: 'now-playing:get',
    /** renderer → main (invoke): quick read of only the followed tab, or null. */
    nowPlayingGetFollowed: 'now-playing:get-followed',
    /** renderer → main (invoke): press a player-bar control on a track's tab. */
    nowPlayingControl: 'now-playing:control',
    /** renderer → main (invoke): play or pause a track's tab. */
    nowPlayingSetPlaying: 'now-playing:set-playing',
    /** renderer → main (invoke): get Brave to load a tab it restored without loading. */
    nowPlayingLoadTab: 'now-playing:load-tab',
    /** renderer → main (invoke): turn repeat-one on or off on a track's tab. */
    nowPlayingSetLoop: 'now-playing:set-loop',
    /** renderer → main (invoke): open YouTube Music in a browser, in the background. */
    openYouTubeMusic: 'browser:open-youtube-music',
    /** renderer → main (invoke): download a song's artwork as a data: URL. */
    artworkFetch: 'artwork:fetch',
    /** renderer → main (invoke): live suggestions and songs while typing. */
    searchSuggest: 'search:suggest',
    /** renderer → main (invoke): the full search, as on /search?q=. */
    searchRun: 'search:run',
    /** renderer → main (invoke): play a song now in the followed tab. */
    playNow: 'player:play-now',
    /** renderer → main (invoke): queue a song right after the current one. */
    playNext: 'player:play-next',
    /** renderer → main (invoke): start a radio (YouTube's "Start mix") from a tab's current song. */
    startRadio: 'player:start-radio',
    /** renderer → main (invoke): bring a tab and its browser to the front. */
    showTab: 'player:show-tab',
    /** renderer → main (invoke): start a radio from a search result. */
    startRadioFromSong: 'player:start-radio-from-song',
    /** renderer → main: open setup (or settings, once browsers are chosen), or bring it forward. */
    setupShow: 'setup:show',
    /** renderer → main (invoke): installed browsers and the ones chosen in setup. */
    setupGet: 'setup:get',
    /** renderer → main (invoke): save which browsers Music Bar may use. */
    setupSetBrowsers: 'setup:set-browsers',
    /** renderer → main (invoke): where one browser stands; may trigger macOS's permission prompt. */
    setupCheck: 'setup:check',
    /** renderer → main (invoke): launch a browser. */
    setupOpenBrowser: 'setup:open-browser',
    /** renderer → main (invoke): open System Settings → Privacy & Security → Automation. */
    setupOpenAutomationSettings: 'setup:open-automation-settings',
    /** renderer → main: close the setup window and show the launcher. */
    setupFinish: 'setup:finish',
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
    /** Seconds into the song when it was read. */
    position: number
    /** Song length in seconds; null until the media has loaded. */
    duration: number | null
    /** When position was read (ms since epoch), so the UI can advance it between reads. */
    readAt: number
    /** An ad is playing; title and artist are the ad's, and position isn't tracked. */
    isAd: boolean
    /**
     * The browser won't let this page start sound until the user clicks or
     * types in it (Chromium's autoplay rule); play requests do nothing until then.
     */
    playBlocked: boolean
    source: TrackSource
}

/**
 * Whether Music Bar can use an open browser:
 * - connected: has a YouTube Music tab it can read and control
 * - no-tab: open, but no YouTube Music tab
 * - needs-setup: "Allow JavaScript from Apple Events" is off (error 12)
 * - needs-permission: macOS hasn't allowed Music Bar to control it (error -1743)
 * - error: anything else; see message
 */
export type BrowserState = 'connected' | 'no-tab' | 'needs-setup' | 'needs-permission' | 'error'

/** A browser's state during setup: as above, or not open, so it can't be checked yet. */
export type BrowserSetupState = BrowserState | 'not-running'

export interface InstalledBrowser {
    browser: BrowserName
    /** The browser's app icon as a data: URL. */
    icon: string | null
}

export interface SetupInfo {
    installed: InstalledBrowser[]
    /** Browsers chosen in setup; null before setup. */
    chosen: BrowserName[] | null
}

export interface BrowserStatus {
    browser: BrowserName
    state: BrowserState
    message?: string
}

export type NowPlaying = (
    | { status: 'track'; track: Track }
    | { status: 'none' }
    /** A YT Music tab Brave hasn't loaded yet (restored at launch, or discarded to save memory). */
    | { status: 'unloaded'; source: TrackSource }
    | { status: 'error'; message: string }
) & {
    /** Every open supported browser and whether Music Bar can use it. Full reads only. */
    browsers?: BrowserStatus[]
}

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
    getFollowedNowPlaying(): Promise<NowPlaying | null>
    control(source: TrackSource, control: PlayerControl): Promise<void>
    /** Plays or pauses; does nothing when the tab is already in that state. */
    setPlaying(source: TrackSource, playing: boolean): Promise<void>
    /** Off restores the repeat mode that was on before looping started. */
    setLoop(source: TrackSource, enabled: boolean): Promise<void>
    loadTab(source: TrackSource): Promise<void>
    fetchArtwork(url: string): Promise<string>
    /** Opens YouTube Music in a background tab; resolves once it's running. */
    openYouTubeMusic(browser: BrowserName): Promise<void>
    suggest(query: string): Promise<SearchResults>
    search(query: string): Promise<SearchResults>
    playNow(song: SearchSong): Promise<void>
    playNext(song: SearchSong): Promise<void>
    startRadio(source: TrackSource): Promise<void>
    startRadioFromSong(song: SearchSong): Promise<void>
    showTab(source: TrackSource): Promise<void>
    showSetup(): void
    getSetup(): Promise<SetupInfo>
    setBrowsers(browsers: BrowserName[]): Promise<void>
    checkBrowser(browser: BrowserName): Promise<BrowserSetupState>
    openBrowser(browser: BrowserName): Promise<void>
    openAutomationSettings(): Promise<void>
    finishSetup(): void
}
