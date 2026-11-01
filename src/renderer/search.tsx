import { useEffect, useState } from 'react'
import { Command } from 'cmdk'
import { Music2, Play, Search } from 'lucide-react'
import type { SearchResults, SearchSong } from '../shared/ipc'

// Waits for a pause in typing before asking YouTube Music; each request runs
// a script in the browser and takes about a second.
const SUGGEST_DEBOUNCE_MS = 200

const suggest = (query: string) => window.musicBar.suggest(query)
const search = (query: string) => window.musicBar.search(query)

/** Live suggestions and songs for what is being typed. */
export const useSuggestions = (query: string) => useSearchRequest(query, suggest, SUGGEST_DEBOUNCE_MS)

/**
 * The full search for a submitted query. A new `attempt` runs the same query
 * again, e.g. once the tab it failed in has loaded.
 */
export const useFullSearch = (query: string, attempt = 0) => useSearchRequest(query, search, 0, attempt)

function useSearchRequest(
    query: string,
    request: (query: string) => Promise<SearchResults>,
    debounceMs: number,
    attempt = 0,
) {
    const [settled, setSettled] = useState<{ key: string; results: SearchResults } | null>(null)
    const trimmed = query.trim()
    const key = `${attempt}:${trimmed}`

    useEffect(() => {
        if (!trimmed) return
        let cancelled = false
        const timer = setTimeout(async () => {
            const results = await request(trimmed)
            if (!cancelled) setSettled({ key, results })
        }, debounceMs)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [trimmed, key, request, debounceMs])

    // The previous query's results stay up while the next ones load, so the
    // list does not blink empty on every keystroke.
    return {
        results: trimmed ? (settled?.results ?? null) : null,
        loading: trimmed !== '' && settled?.key !== key,
    }
}

export const songValue = (song: SearchSong) => `song:${song.videoId}`
export const searchValue = (query: string) => `search:${query}`

export function SearchRow({ query, label, onSelect }: { query: string; label: string; onSelect: () => void }) {
    return (
        <Command.Item
            value={searchValue(query)}
            onSelect={onSelect}
            className="flex h-12 items-center gap-3 rounded-md px-2 data-[selected=false]:hover:bg-white/[0.04] data-[selected=true]:bg-white/[0.08]"
        >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-highlight text-subdued">
                <Search className="size-[18px]" strokeWidth={2.25} />
            </span>
            <span className="truncate text-[15px] font-semibold">{label}</span>
        </Command.Item>
    )
}

export function SongRow({ song, onSelect }: { song: SearchSong; onSelect: () => void }) {
    const [thumbnailFailed, setThumbnailFailed] = useState(false)
    return (
        <Command.Item
            value={songValue(song)}
            onSelect={onSelect}
            className="group flex h-14 items-center gap-3 rounded-md px-2 data-[selected=false]:hover:bg-white/[0.04] data-[selected=true]:bg-white/[0.08]"
        >
            <span className="relative size-10 shrink-0 overflow-hidden rounded">
                {song.thumbnailUrl && !thumbnailFailed ? (
                    <img
                        src={song.thumbnailUrl}
                        alt=""
                        onError={() => setThumbnailFailed(true)}
                        className="size-full object-cover"
                    />
                ) : (
                    <span className="flex size-full items-center justify-center bg-highlight">
                        <Music2 className="size-4 text-subdued" />
                    </span>
                )}
                {/* A play glyph over the art on the selected row, like Spotify's hover state. */}
                <span className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition-opacity group-data-[selected=true]:opacity-100">
                    <Play className="size-4 text-white" fill="currentColor" strokeWidth={0} />
                </span>
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{song.title}</span>
                <span className="flex items-center gap-1.5 truncate text-[13px] font-medium text-subdued">
                    {song.kind === 'video' && (
                        <span className="shrink-0 rounded-sm bg-white/20 px-1 text-[9px] leading-4 font-extrabold tracking-wide text-white/85">
                            VIDEO
                        </span>
                    )}
                    <span className="truncate">{song.artist}</span>
                </span>
            </span>
        </Command.Item>
    )
}

/** A non-selectable status line inside the list. */
export function ListNote({ children }: { children: string }) {
    return <div className="px-2 py-3 text-sm font-medium text-subdued">{children}</div>
}
