import { useEffect, useState } from 'react'
import { Command } from 'cmdk'
import { Music2, Search } from 'lucide-react'
import type { SearchResults, SearchSong } from '../shared/ipc'

// Waits for a pause in typing before asking YouTube Music; each request runs
// a script in the browser and takes about a second.
const SUGGEST_DEBOUNCE_MS = 200

const suggest = (query: string) => window.musicBar.suggest(query)
const search = (query: string) => window.musicBar.search(query)

/** Live suggestions and songs for what is being typed. */
export const useSuggestions = (query: string) => useSearchRequest(query, suggest, SUGGEST_DEBOUNCE_MS)

/** The full search for a submitted query. */
export const useFullSearch = (query: string) => useSearchRequest(query, search, 0)

function useSearchRequest(query: string, request: (query: string) => Promise<SearchResults>, debounceMs: number) {
    const [settled, setSettled] = useState<{ query: string; results: SearchResults } | null>(null)
    const trimmed = query.trim()

    useEffect(() => {
        if (!trimmed) return
        let cancelled = false
        const timer = setTimeout(async () => {
            const results = await request(trimmed)
            if (!cancelled) setSettled({ query: trimmed, results })
        }, debounceMs)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [trimmed, request, debounceMs])

    // The previous query's results stay up while the next ones load, so the
    // list does not blink empty on every keystroke.
    return {
        results: trimmed ? (settled?.results ?? null) : null,
        loading: trimmed !== '' && settled?.query !== trimmed,
    }
}

export const songValue = (song: SearchSong) => `song:${song.videoId}`
export const searchValue = (query: string) => `search:${query}`

export function SearchRow({ query, label, onSelect }: { query: string; label: string; onSelect: () => void }) {
    return (
        <Command.Item
            value={searchValue(query)}
            onSelect={onSelect}
            className="flex h-10 items-center gap-3 rounded-lg px-2 text-sm data-[selected=true]:bg-white/10"
        >
            <span className="flex size-7 items-center justify-center text-neutral-400">
                <Search className="size-4" />
            </span>
            <span className="truncate">{label}</span>
        </Command.Item>
    )
}

export function SongRow({ song, onSelect }: { song: SearchSong; onSelect: () => void }) {
    const [thumbnailFailed, setThumbnailFailed] = useState(false)
    return (
        <Command.Item
            value={songValue(song)}
            onSelect={onSelect}
            className="flex h-12 items-center gap-3 rounded-lg px-2 text-sm data-[selected=true]:bg-white/10"
        >
            {song.thumbnailUrl && !thumbnailFailed ? (
                <img
                    src={song.thumbnailUrl}
                    alt=""
                    onError={() => setThumbnailFailed(true)}
                    className="size-9 shrink-0 rounded-md object-cover"
                />
            ) : (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-white/10">
                    <Music2 className="size-4 text-neutral-400" />
                </span>
            )}
            <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{song.title}</span>
                <span className="block truncate text-xs text-neutral-400">{song.artist}</span>
            </span>
            <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-neutral-400 ring-1 ring-white/15">
                {song.kind === 'song' ? 'Song' : 'Video'}
            </span>
        </Command.Item>
    )
}

/** A non-selectable status line inside the list. */
export function ListNote({ children }: { children: string }) {
    return <div className="px-2 py-3 text-sm text-neutral-400">{children}</div>
}
