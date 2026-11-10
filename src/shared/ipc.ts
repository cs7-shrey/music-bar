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
    /** renderer → main (invoke): play a song now, in the followed tab or in Spotify. */
    playNow: 'player:play-now',
    /** renderer → main (invoke): queue a song right after the current one. */
    playNext: 'player:play-next',
    /** renderer → main (invoke): start a radio (YouTube's "Start mix") from a tab's current song. */
    startRadio: 'player:start-radio',
    /** renderer → main (invoke): bring a tab and its browser to the front. */
    showTab: 'player:show-tab',
    /** renderer → main (invoke): start a radio from a search result. */
    startRadioFromSong: 'player:start-radio-from-song',
    /**
     * renderer → main: open setup (or settings, once browsers are chosen), or
     * bring it forward; optionally on a settings section.
     */
    setupShow: 'setup:show',
    /** main → renderer: the settings window should switch to a section. */
    settingsSection: 'settings:section',
    /** renderer → main (invoke): whether Music Bar opens at login, and whether it can. */
    loginItemGet: 'login-item:get',
    /** renderer → main (invoke): turn opening at login on or off. */
    loginItemSet: 'login-item:set',
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
    /** renderer → main (invoke): Linux; the folder to load the browser extension from. */
    setupGetExtensionFolder: 'setup:get-extension-folder',
    /** renderer → main (invoke): Linux; show that folder in the file manager. */
    setupShowExtensionFolder: 'setup:show-extension-folder',
    /** renderer → main (invoke): Linux; open a browser's extensions page. */
    setupOpenExtensionsPage: 'setup:open-extensions-page',
    /**
     * renderer → main: setup's checks are done. Setup stays on its last
     * screen until the user opens Music Bar with the shortcut.
     */
    setupFinish: 'setup:finish',
    /** renderer → main (invoke): Spotify's state and account connection. */
    spotifyGet: 'spotify:get',
    /** renderer → main (invoke): turn Spotify on or off. */
    spotifySetEnabled: 'spotify:set-enabled',
    /** renderer → main (invoke): launch the Spotify app. */
    spotifyOpen: 'spotify:open',
    /** renderer → main (invoke): sign in to Spotify with a Client ID; resolves once signed in. */
    spotifyConnect: 'spotify:connect',
    /** renderer → main (invoke): forget the Spotify account. */
    spotifyDisconnect: 'spotify:disconnect',
    /** renderer → main (invoke): open Spotify's developer dashboard, to make an app. */
    spotifyOpenDashboard: 'spotify:open-dashboard',
    /** renderer → main (invoke): the downloaded update's version, or null. */
    updateGet: 'update:get',
    /** renderer → main: restart to install the downloaded update. */
    updateInstall: 'update:install',
    /** main → renderer: an update finished downloading while the app runs. */
    updateReady: 'update:ready',
} as const

/** Helium on macOS only, Chromium on Linux only. */
export type BrowserName = 'Brave Browser' | 'Google Chrome' | 'Helium' | 'Chromium'

export type SettingsSection = 'general' | 'browsers' | 'spotify' | 'shortcuts'

export interface LoginItemInfo {
    enabled: boolean
    /** False in development, where the app can't open itself at login. */
    available: boolean
}

/** Where music plays: YouTube Music in a browser tab, or the Spotify app. */
export type Service = 'youtube-music' | 'spotify'

/** Identifies the browser tab a YouTube Music track is playing in. */
export interface TabSource {
    service?: undefined
    browser: BrowserName
    windowId: number
    tabId: number
}

/** A track playing in the Spotify desktop app. */
export interface SpotifySource {
    service: 'spotify'
}

/** Where a track is playing. */
export type TrackSource = TabSource | SpotifySource

export const isSpotify = (source: TrackSource): source is SpotifySource => source.service === 'spotify'

export const serviceOf = (source: TrackSource): Service => (isSpotify(source) ? 'spotify' : 'youtube-music')

/** YouTube Music's `repeat-mode` attribute: off, whole queue, current song. */
export type RepeatMode = 'NONE' | 'ALL' | 'ONE'

export interface Track {
    title: string
    artist: string
    album: string
    artworkUrl: string | null
    isPlaying: boolean
    /**
     * Playing or paused isn't known yet: the song is still loading, or the
     * tab was too busy to answer and this is its last read.
     */
    isLoading: boolean
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

/** A track in a YouTube Music tab. */
export type TabTrack = Track & { source: TabSource }

/**
 * Whether Music Bar can use an open browser:
 * - connected: has a YouTube Music tab it can read and control
 * - no-tab: open, but no YouTube Music tab
 * - needs-setup: scripts can't run in its tabs: on macOS, "Allow JavaScript
 *   from Apple Events" is off (error 12); on Linux, "Allow User Scripts" is
 *   off for the Music Bar extension
 * - needs-permission: macOS hasn't allowed Music Bar to control it (error -1743)
 * - needs-extension: Linux only; the Music Bar extension isn't installed or connected
 * - error: anything else; see message
 */
export type BrowserState = 'connected' | 'no-tab' | 'needs-setup' | 'needs-permission' | 'needs-extension' | 'error'

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
    /** Setup is done and waits for the first ⌘⇧Space. */
    awaitingShortcut: boolean
    /** The Spotify app is installed, so setup offers it. */
    spotifyInstalled: boolean
    /** Spotify is turned on. */
    spotify: boolean
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
    | { status: 'unloaded'; source: TabSource }
    | { status: 'error'; message: string }
) & {
    /** Every open supported browser and whether Music Bar can use it. Full reads only. */
    browsers?: BrowserStatus[]
    /** The Spotify app, when it's turned on in settings. Full reads only. */
    spotify?: SpotifyState
}

/**
 * The Spotify desktop app:
 * - ready: running, and Music Bar can read and control it
 * - not-running: not open
 * - needs-permission: macOS hasn't allowed Music Bar to control it
 * - not-installed: not on this computer
 * - error: anything else
 */
export type SpotifyState = 'ready' | 'not-running' | 'needs-permission' | 'not-installed' | 'error'

/** What Settings → Spotify shows. */
export interface SpotifyInfo {
    enabled: boolean
    state: SpotifyState
    /** Spotify's account connection (Web API), for search and the queue. */
    account: {
        clientId: string | null
        /** The Spotify user's display name, once connected. */
        connectedAs: string | null
        /** The address to add as a Redirect URI in the Spotify app's settings. */
        redirectUri: string
    }
    /** Looping one song: not on macOS, where Spotify's AppleScript can't. */
    canLoop: boolean
}

export interface SearchSong {
    service: Service
    /** YouTube's video id, or Spotify's track id. */
    id: string
    title: string
    artist: string
    kind: 'song' | 'video'
    thumbnailUrl: string | null
}

export type SearchResults =
    | { status: 'ok'; service: Service; suggestions: string[]; songs: SearchSong[] }
    | { status: 'error'; message: string }

export type PlayerControl = 'previous' | 'next'

export interface MusicBarApi {
    /** Which platform this is; Linux uses Ctrl for ⌘, and a browser extension for AppleScript. */
    platform: 'darwin' | 'linux'
    /** Wayland, where the launcher's key is bound in the compositor (to `music-bar --toggle`). */
    wayland: boolean
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
    loadTab(source: TabSource): Promise<void>
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
    showSetup(section?: SettingsSection): void
    onSettingsSection(listener: (section: SettingsSection) => void): () => void
    getOpenAtLogin(): Promise<LoginItemInfo>
    setOpenAtLogin(enabled: boolean): Promise<void>
    getSetup(): Promise<SetupInfo>
    setBrowsers(browsers: BrowserName[]): Promise<void>
    checkBrowser(browser: BrowserName): Promise<BrowserSetupState>
    openBrowser(browser: BrowserName): Promise<void>
    openAutomationSettings(): Promise<void>
    getExtensionFolder(): Promise<string>
    showExtensionFolder(): Promise<void>
    openExtensionsPage(browser: BrowserName): Promise<void>
    finishSetup(): void
    getSpotify(): Promise<SpotifyInfo>
    setSpotifyEnabled(enabled: boolean): Promise<void>
    openSpotify(): Promise<void>
    /** Saves the Client ID and opens Spotify's sign-in page; resolves once signed in. */
    connectSpotify(clientId: string): Promise<void>
    disconnectSpotify(): Promise<void>
    openSpotifyDashboard(): Promise<void>
    /** The version downloaded and waiting for a restart, or null. */
    getUpdate(): Promise<string | null>
    installUpdate(): void
    onUpdateReady(listener: () => void): () => void
}
