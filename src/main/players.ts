import {
    isSpotify,
    serviceOf,
    type NowPlaying,
    type PlayerControl,
    type SearchResults,
    type Service,
    type SpotifyInfo,
    type TabSource,
    type TrackSource,
} from '../shared/ipc'
import * as youtubeMusic from './youtube-music'
import * as youtubeMusicSearch from './youtube-music-search'
import * as spotify from './spotify'
import * as spotifyAccount from './spotify-account'
import { getSettings, updateSettings } from './settings'
import { describe, logger } from './log'

// Everything the launcher plays from, in one place: YouTube Music tabs
// (youtube-music.ts) and the Spotify app (spotify.ts). The card shows one
// track at a time, so this picks it: what's playing, else what was last
// played or acted on (the followed service), as youtube-music.ts does among
// tabs. Actions go to the track's own service; search and songs from it go
// to the followed one.

const log = logger('players')

// The service of the last track seen playing or acted on.
let followed: Service | null = null

const spotifyOn = () => getSettings().spotify

function follow(service: Service): void {
    if (followed !== service) log.info(`following ${service}`)
    followed = service
}

export async function getNowPlaying(): Promise<NowPlaying> {
    const [youTube, spotifyRead] = await Promise.all([
        youtubeMusic.getNowPlaying(),
        spotifyOn() ? spotify.read().catch((error) => ({ state: 'error' as const, message: describe(error) })) : null,
    ])
    const spotifyTrack = spotifyRead?.state === 'ready' ? spotifyRead.track : null
    const youTubeTrack = youTube.status === 'track' ? youTube.track : null
    const fromSpotify: NowPlaying = { status: 'track', track: spotifyTrack! }
    const extras = { browsers: youTube.browsers, ...(spotifyRead && { spotify: spotifyRead.state }) }

    let chosen: NowPlaying
    if (spotifyTrack?.isPlaying && (!youTubeTrack?.isPlaying || followed === 'spotify')) {
        follow('spotify')
        chosen = fromSpotify
    } else if (youTubeTrack?.isPlaying) {
        follow('youtube-music')
        chosen = youTube
    } else if (followed === 'spotify' && spotifyTrack) {
        chosen = fromSpotify
    } else if (followed === 'youtube-music' && youTube.status !== 'none') {
        chosen = youTube
    } else if (youTubeTrack || !spotifyTrack) {
        chosen = youTube
    } else {
        chosen = fromSpotify
    }
    return { ...chosen, ...extras }
}

/** The quick read when the launcher opens: only what's followed. */
export async function getFollowedNowPlaying(): Promise<NowPlaying | null> {
    if (followed === 'spotify' && spotifyOn()) {
        const result = await spotify.read().catch(() => null)
        return result?.state === 'ready' && result.track ? { status: 'track', track: result.track } : null
    }
    return youtubeMusic.getFollowedNowPlaying()
}

/** Where search and songs from it go: the followed service, else the only one set up. */
function searchService(): Service {
    if (followed) return followed
    return spotifyOn() && (getSettings().browsers ?? []).length === 0 ? 'spotify' : 'youtube-music'
}

/** Runs an action on a track's own service, which it then follows. */
function on<T>(source: TrackSource, actions: { spotify: () => Promise<T>; youTube: (source: TabSource) => Promise<T> }): Promise<T> {
    if (!source || typeof source !== 'object') throw new Error('Invalid source')
    follow(serviceOf(source))
    return isSpotify(source) ? actions.spotify() : actions.youTube(source)
}

const NO_SPOTIFY_RADIO = 'Spotify radio isn’t available from Music Bar'

export const control = (source: TrackSource, action: PlayerControl) =>
    on(source, { spotify: () => spotify.control(action), youTube: (tab) => youtubeMusic.control(tab, action) })

export const setPlaying = (source: TrackSource, playing: boolean) =>
    on(source, { spotify: () => spotify.setPlaying(playing), youTube: (tab) => youtubeMusic.setPlaying(tab, playing) })

export const setLoop = (source: TrackSource, enabled: boolean) =>
    on(source, { spotify: () => spotify.setLoop(enabled), youTube: (tab) => youtubeMusic.setLoop(tab, enabled) })

export const showTab = (source: TrackSource) =>
    on(source, { spotify: () => spotify.show(), youTube: (tab) => youtubeMusic.showTab(tab) })

export const startRadio = (source: TrackSource) =>
    on(source, {
        spotify: () => Promise.reject(new Error(NO_SPOTIFY_RADIO)),
        youTube: (tab) => youtubeMusic.startRadio(tab),
    })

function forService<T>(service: Service, actions: { spotify: () => Promise<T>; youTube: () => Promise<T> }): Promise<T> {
    if (service !== 'spotify' && service !== 'youtube-music') throw new Error('Invalid service')
    follow(service)
    return service === 'spotify' ? actions.spotify() : actions.youTube()
}

export const playNow = (service: Service, id: string) =>
    forService(service, { spotify: () => spotify.playTrack(id), youTube: () => youtubeMusic.playNow(id) })

export const playNext = (service: Service, id: string) =>
    forService(service, {
        spotify: () => {
            if (!spotify.SPOTIFY_TRACK_ID.test(id)) throw new Error('Invalid Spotify track id')
            return spotifyAccount.addToQueue(id)
        },
        youTube: () => youtubeMusic.playNext(id),
    })

export const startRadioFromSong = (service: Service, id: string) =>
    forService(service, {
        spotify: () => Promise.reject(new Error(NO_SPOTIFY_RADIO)),
        youTube: () => youtubeMusic.startRadioFromSong(id),
    })

async function searchSpotify(query: string): Promise<SearchResults> {
    const trimmed = typeof query === 'string' ? query.trim() : ''
    if (!trimmed) return { status: 'ok', service: 'spotify', suggestions: [], songs: [] }
    try {
        return { status: 'ok', service: 'spotify', suggestions: [], songs: await spotifyAccount.searchTracks(trimmed) }
    } catch (error) {
        // The query stays out of the log.
        log.warn(`spotify search failed: ${describe(error)}`)
        return { status: 'error', message: describe(error) }
    }
}

// Spotify has no suggestions to offer while typing, so both are a search.
export const suggest = (query: string) =>
    searchService() === 'spotify' ? searchSpotify(query) : youtubeMusicSearch.suggest(query)

export const search = (query: string) =>
    searchService() === 'spotify' ? searchSpotify(query) : youtubeMusicSearch.search(query)

export async function spotifyInfo(): Promise<SpotifyInfo> {
    const account = getSettings().spotifyAccount
    // Read only once it's on: on macOS the first read asks for permission,
    // and nobody should get a prompt they didn't ask for.
    const state = !spotify.isInstalled()
        ? 'not-installed'
        : spotifyOn()
          ? (await spotify.read().catch(() => ({ state: 'error' as const }))).state
          : 'not-running'
    return {
        enabled: spotifyOn(),
        state,
        account: {
            clientId: account?.clientId ?? null,
            connectedAs: account ? (account.displayName ?? 'your account') : null,
            redirectUri: spotifyAccount.REDIRECT_URI,
        },
        canLoop: spotify.canLoop(),
    }
}

export function setSpotifyEnabled(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new Error('Invalid setting')
    updateSettings({ spotify: enabled })
    if (!enabled && followed === 'spotify') followed = null
}

export const spotifyInstalled = () => spotify.isInstalled()
export const openSpotify = () => spotify.launch()
export const connectSpotify = (clientId: string) => spotifyAccount.connect(clientId)
export const disconnectSpotify = () => spotifyAccount.disconnect()
