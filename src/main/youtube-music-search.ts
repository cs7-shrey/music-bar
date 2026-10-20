import type { SearchResults, SearchSong } from '../shared/ipc'
import { defaultTab, evaluateAsyncInTab } from './youtube-music'

// Search goes through YouTube Music's own internal API (the endpoints its
// search box calls), run inside a YT Music tab so requests carry the user's
// session and results match what the page would show. Nothing visible
// changes in the tab.

const MAX_SUGGESTIONS = 3
const MAX_SONGS = 5

/**
 * Async function body that POSTs to an InnerTube endpoint and returns the
 * response text. Scripts run in an isolated world without the page's `ytcfg`,
 * so client config is read from the page's inline scripts, and the request is
 * signed with the SAPISIDHASH header the page itself sends when logged in.
 */
function innerTubeRequest(endpoint: string, payload: Record<string, string>): string {
    return `
        const html = [...document.scripts].map((script) => script.textContent).join(' ');
        const config = (key) => (html.match(new RegExp('"' + key + '":"([^"]+)"')) || [])[1];
        const cookie = (name) => (document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]+)')) || [])[1];
        const headers = { 'Content-Type': 'application/json' };
        const sapisid = cookie('SAPISID') || cookie('__Secure-3PAPISID');
        if (sapisid) {
            const timestamp = Math.floor(Date.now() / 1000);
            const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(timestamp + ' ' + sapisid + ' ' + location.origin));
            const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
            headers['Authorization'] = 'SAPISIDHASH ' + timestamp + '_' + hash;
            headers['X-Origin'] = location.origin;
            headers['X-Goog-AuthUser'] = '0';
        }
        const context = { client: {
            clientName: 'WEB_REMIX',
            clientVersion: config('INNERTUBE_CLIENT_VERSION'),
            hl: config('HL'),
            gl: config('GL'),
            visitorData: config('VISITOR_DATA'),
        } };
        const response = await fetch('/youtubei/v1/${endpoint}?prettyPrint=false', {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify({ context, ...${JSON.stringify(payload)} }),
        });
        if (!response.ok) throw new Error('YouTube Music search failed (' + response.status + ')');
        return await response.text();
    `
}

async function requestInTab(endpoint: string, payload: Record<string, string>): Promise<unknown> {
    const tab = await defaultTab()
    if (!tab) throw new Error('Open YouTube Music in Brave, Chrome or Helium')
    return JSON.parse(await evaluateAsyncInTab(tab, innerTubeRequest(endpoint, payload)))
}

export async function suggest(query: string): Promise<SearchResults> {
    return run(query, async (input) => {
        const response = (await requestInTab('music/get_search_suggestions', { input })) as SuggestionsResponse
        const sections = response.contents?.map((content) => content.searchSuggestionsSectionRenderer) ?? []
        const items = sections.flatMap((section) => section?.contents ?? [])
        const suggestions = items.flatMap((item) => {
            const renderer = item.searchSuggestionRenderer ?? item.historySuggestionRenderer
            const text = renderer?.navigationEndpoint?.searchEndpoint?.query ?? joinRuns(renderer?.suggestion)
            return text ? [text] : []
        })
        const songs = items.flatMap((item) =>
            item.musicResponsiveListItemRenderer ? [item.musicResponsiveListItemRenderer] : [],
        )
        return {
            status: 'ok',
            suggestions: suggestions.slice(0, MAX_SUGGESTIONS),
            songs: toSongs(songs.map(parseListItem)),
        }
    })
}

export async function search(query: string): Promise<SearchResults> {
    return run(query, async (searchQuery) => {
        const response = (await requestInTab('search', { query: searchQuery })) as SearchResponse
        const sections =
            response.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer
                ?.contents ?? []
        // Page order: the big top-result card (only sometimes there), then one
        // section per result. Albums, playlists and profiles carry no videoId
        // and drop out in toSongs.
        const candidates = sections.flatMap((section): (SearchSong | null)[] => {
            if (section.musicCardShelfRenderer) return [parseCard(section.musicCardShelfRenderer)]
            const items = section.itemSectionRenderer?.contents ?? section.musicShelfRenderer?.contents ?? []
            return items.map((item) =>
                item.musicResponsiveListItemRenderer ? parseListItem(item.musicResponsiveListItemRenderer) : null,
            )
        })
        return { status: 'ok', suggestions: [], songs: toSongs(candidates) }
    })
}

async function run(query: string, perform: (query: string) => Promise<SearchResults>): Promise<SearchResults> {
    const trimmed = typeof query === 'string' ? query.trim() : ''
    if (!trimmed) return { status: 'ok', suggestions: [], songs: [] }
    try {
        return await perform(trimmed)
    } catch (error) {
        return { status: 'error', message: error instanceof Error ? error.message : String(error) }
    }
}

/** Drops non-songs and duplicates, keeping the first MAX_SONGS. */
function toSongs(candidates: (SearchSong | null)[]): SearchSong[] {
    const seen = new Set<string>()
    const songs: SearchSong[] = []
    for (const song of candidates) {
        if (!song || seen.has(song.videoId)) continue
        seen.add(song.videoId)
        songs.push(song)
        if (songs.length === MAX_SONGS) break
    }
    return songs
}

function parseListItem(item: ListItemRenderer): SearchSong | null {
    const videoId = item.playlistItemData?.videoId
    const endpoint =
        item.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint
            ?.watchEndpoint ?? item.navigationEndpoint?.watchEndpoint
    const kind = songKind(endpoint)
    if (!videoId || !kind) return null
    const columns = item.flexColumns?.map((column) => column.musicResponsiveListItemFlexColumnRenderer?.text) ?? []
    return {
        videoId,
        title: joinRuns(columns[0]),
        artist: artistFromSubtitle(columns[1]),
        kind,
        thumbnailUrl: largestThumbnail(item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
    }
}

function parseCard(card: CardShelfRenderer): SearchSong | null {
    const endpoint = card.title?.runs?.[0]?.navigationEndpoint?.watchEndpoint
    const kind = songKind(endpoint)
    if (!endpoint?.videoId || !kind) return null
    return {
        videoId: endpoint.videoId,
        title: joinRuns(card.title),
        artist: artistFromSubtitle(card.subtitle),
        kind,
        thumbnailUrl: largestThumbnail(card.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
    }
}

/** Songs are "ATV" (audio track) items; music and user videos count too. */
function songKind(endpoint: WatchEndpoint | undefined): SearchSong['kind'] | null {
    const type = endpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType
    if (!endpoint?.videoId || !type || type === 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE') return null
    return type === 'MUSIC_VIDEO_TYPE_ATV' ? 'song' : 'video'
}

/** Subtitles read "Song • Artist & Artist • 12m plays"; the artist is the second part. */
function artistFromSubtitle(subtitle: Runs | undefined): string {
    // Artists with an empty name leave a stray ", ," behind.
    return (joinRuns(subtitle).split('•')[1] ?? '').replace(/(,\s*)+,/g, ',').trim()
}

function joinRuns(text: Runs | undefined): string {
    return text?.runs?.map((run) => run.text).join('') ?? ''
}

function largestThumbnail(thumbnails: Thumbnail[] | undefined): string | null {
    if (!thumbnails?.length) return null
    return thumbnails.reduce((largest, next) => (next.width > largest.width ? next : largest)).url
}

// The slices of InnerTube's response shapes this file reads.

interface Runs {
    runs?: { text: string; navigationEndpoint?: { watchEndpoint?: WatchEndpoint } }[]
}

interface WatchEndpoint {
    videoId?: string
    watchEndpointMusicSupportedConfigs?: { watchEndpointMusicConfig?: { musicVideoType?: string } }
}

interface Thumbnail {
    url: string
    width: number
}

interface ThumbnailRenderer {
    musicThumbnailRenderer?: { thumbnail?: { thumbnails?: Thumbnail[] } }
}

interface ListItemRenderer {
    flexColumns?: { musicResponsiveListItemFlexColumnRenderer?: { text?: Runs } }[]
    playlistItemData?: { videoId?: string }
    navigationEndpoint?: { watchEndpoint?: WatchEndpoint }
    overlay?: {
        musicItemThumbnailOverlayRenderer?: {
            content?: { musicPlayButtonRenderer?: { playNavigationEndpoint?: { watchEndpoint?: WatchEndpoint } } }
        }
    }
    thumbnail?: ThumbnailRenderer
}

interface CardShelfRenderer {
    title?: Runs
    subtitle?: Runs
    thumbnail?: ThumbnailRenderer
}

interface SuggestionRenderer {
    suggestion?: Runs
    navigationEndpoint?: { searchEndpoint?: { query?: string } }
}

interface SuggestionsResponse {
    contents?: {
        searchSuggestionsSectionRenderer?: {
            contents?: {
                searchSuggestionRenderer?: SuggestionRenderer
                historySuggestionRenderer?: SuggestionRenderer
                musicResponsiveListItemRenderer?: ListItemRenderer
            }[]
        }
    }[]
}

interface SearchResponse {
    contents?: {
        tabbedSearchResultsRenderer?: {
            tabs?: {
                tabRenderer?: {
                    content?: {
                        sectionListRenderer?: {
                            contents?: {
                                musicCardShelfRenderer?: CardShelfRenderer
                                itemSectionRenderer?: { contents?: { musicResponsiveListItemRenderer?: ListItemRenderer }[] }
                                musicShelfRenderer?: { contents?: { musicResponsiveListItemRenderer?: ListItemRenderer }[] }
                            }[]
                        }
                    }
                }
            }[]
        }
    }
}
