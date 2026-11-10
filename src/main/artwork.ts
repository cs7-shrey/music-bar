import { session } from 'electron'
import { logger } from './log'

// Artwork is downloaded here rather than by the launcher's <img>: connections
// to Google's image host sometimes stall, and a browser keeps reusing a
// stalled connection, so every retry hung with it. A dedicated session lets a
// retry drop its connections without touching the launcher's own (which in
// dev include the live-reload socket).

// YouTube Music's image hosts, and Spotify's.
const ALLOWED_HOSTS = /(^|\.)(googleusercontent\.com|ytimg\.com|ggpht\.com|scdn\.co|spotifycdn\.com)$/
const ATTEMPT_TIMEOUT_MS = 8000
const RETRY_DELAYS_MS = [500, 2000, 5000]
const CACHE_SIZE = 30

const log = logger('artwork')

// Recent downloads (and ones in flight) by URL, as data: URLs.
const cache = new Map<string, Promise<string>>()

const artworkSession = () => session.fromPartition('artwork')

/** Downloads an artwork image and returns it as a data: URL. */
export function fetchArtwork(url: string): Promise<string> {
    const cached = cache.get(url)
    if (cached) return cached
    const download = downloadWithRetries(url)
    cache.set(url, download)
    download.catch(() => cache.delete(url))
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
    return download
}

async function downloadWithRetries(url: string): Promise<string> {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.test(parsed.hostname)) {
        throw new Error(`Not an artwork host: ${parsed.hostname}`)
    }
    let lastError: unknown
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]))
            await artworkSession().closeAllConnections()
        }
        try {
            const response = await artworkSession().fetch(url, { signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const type = response.headers.get('content-type') ?? 'image/jpeg'
            const body = Buffer.from(await response.arrayBuffer())
            return `data:${type};base64,${body.toString('base64')}`
        } catch (error) {
            lastError = error
            const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
            log.warn(`attempt ${attempt + 1} failed (${reason}): ${url}`)
        }
    }
    throw lastError
}
