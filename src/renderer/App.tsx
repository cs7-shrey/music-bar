import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Command } from 'cmdk'
import { Music2, Pause, Play, Radio, Repeat1, Search } from 'lucide-react'
import type { SearchSong } from '../shared/ipc'
import { NowPlaying, useNowPlaying } from './now-playing'
import { ListNote, SearchRow, SongRow, searchValue, songValue, useFullSearch, useSuggestions } from './search'

interface PlaybackCommand {
    id: string
    title: string
    subtitle: string
    icon: ReactNode
}

const PLAY_PAUSE_COMMAND = 'Play or Pause'
const LOOP_COMMAND = 'Loop Current Song'

// Placeholders until each command is wired to YouTube Music.
const SOON_COMMANDS: PlaybackCommand[] = [
    { id: 'start-radio', title: 'Start Radio', subtitle: 'Start a radio from another song', icon: <Radio /> },
    { id: 'play-now', title: 'Play Now', subtitle: 'Replace the current song', icon: <Play /> },
]

const NOTICE_MS = 2500

const matches = (query: string, ...texts: string[]) =>
    texts.some((text) => text.toLowerCase().includes(query.toLowerCase()))

export default function App() {
    const [query, setQuery] = useState('')
    // The query whose full search is on screen; null while typing.
    const [submitted, setSubmitted] = useState<string | null>(null)
    const [selected, setSelected] = useState(PLAY_PAUSE_COMMAND)
    // Brief confirmation shown in the footer, e.g. after queueing a song.
    const [notice, setNotice] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const nowPlaying = useNowPlaying()
    const track = nowPlaying.state?.status === 'track' ? nowPlaying.state.track : null
    const isLooping = track?.repeatMode === 'ONE'

    const trimmed = query.trim()
    const live = useSuggestions(submitted === null ? query : '')
    const full = useFullSearch(submitted ?? '')

    const reset = () => {
        setQuery('')
        setSubmitted(null)
        setSelected(PLAY_PAUSE_COMMAND)
    }

    useEffect(
        () =>
            window.musicBar.onShown(() => {
                reset()
                inputRef.current?.focus()
            }),
        [],
    )

    // Land on the first song once a full search comes back.
    const firstResult = full.results?.status === 'ok' ? full.results.songs[0] : undefined
    useEffect(() => {
        if (firstResult) setSelected(songValue(firstResult))
    }, [firstResult])

    const changeQuery = (next: string) => {
        setQuery(next)
        setSubmitted(null)
        setSelected(next.trim() ? searchValue(next.trim()) : PLAY_PAUSE_COMMAND)
    }

    const submit = (searchQuery: string) => {
        setQuery(searchQuery)
        setSubmitted(searchQuery)
    }

    const liveSongs = live.results?.status === 'ok' ? live.results.songs : []
    const fullSongs = full.results?.status === 'ok' ? full.results.songs : []
    const songsOnScreen = submitted === null ? liveSongs : fullSongs
    const selectedSong = songsOnScreen.find((song) => songValue(song) === selected)

    useEffect(() => {
        if (!notice) return
        const timer = setTimeout(() => setNotice(null), NOTICE_MS)
        return () => clearTimeout(timer)
    }, [notice])

    const queueNext = async (song: SearchSong) => {
        try {
            await window.musicBar.playNext(song)
            setNotice(`“${song.title}” will play next`)
        } catch {
            setNotice(`Couldn't queue “${song.title}”`)
        }
    }

    const play = (song: SearchSong) => {
        void nowPlaying.playNow(song)
        // Back to the now-playing card, which picks up the new song.
        reset()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
        // ⇧↵ on a song queues it instead of playing it; the results stay up
        // so several songs can be queued in a row.
        if (event.key === 'Enter' && event.shiftKey && selectedSong) {
            event.preventDefault()
            void queueNext(selectedSong)
            return
        }
        // ⌘O toggles the loop from anywhere, even mid-search.
        if (event.metaKey && event.key.toLowerCase() === 'o') {
            event.preventDefault()
            nowPlaying.toggleLoop()
            return
        }
        if (event.key !== 'Escape') return
        event.preventDefault()
        if (submitted !== null) {
            setSubmitted(null)
            setSelected(searchValue(trimmed))
        } else if (query) reset()
        else window.musicBar.hide()
    }

    const showPlayPause = !trimmed || matches(trimmed, 'play', 'pause', 'resume')
    const showLoop = !trimmed || matches(trimmed, LOOP_COMMAND, 'repeat', 'stop looping')
    const soonCommands = SOON_COMMANDS.filter(
        (command) => !trimmed || matches(trimmed, command.title, command.subtitle),
    )
    const commands = (showPlayPause || showLoop || soonCommands.length > 0) && (
        <Command.Group heading="Playback">
            {showPlayPause && (
                <CommandRow
                    // Stable value so the selection does not jump when the title flips.
                    value={PLAY_PAUSE_COMMAND}
                    icon={track?.isPlaying ? <Pause /> : <Play />}
                    title={track?.isPlaying ? 'Pause' : 'Play'}
                    subtitle={track ? `“${track.title}”` : 'Nothing is playing'}
                    muted={!track}
                    onSelect={nowPlaying.togglePlay}
                />
            )}
            {showLoop && (
                <CommandRow
                    // Stable value so the selection does not jump when the title flips.
                    value={LOOP_COMMAND}
                    icon={<Repeat1 />}
                    title={isLooping ? 'Stop Looping' : 'Loop Current Song'}
                    subtitle={track ? `${isLooping ? 'Looping' : 'Repeat'} “${track.title}”` : 'Nothing is playing'}
                    badge={isLooping ? 'On' : undefined}
                    shortcut="⌘O"
                    // Dimmed rather than skipped: a missing row would push the
                    // selection onto a placeholder while the track loads.
                    muted={!track}
                    onSelect={nowPlaying.toggleLoop}
                />
            )}
            {soonCommands.map((command) => (
                <CommandRow
                    key={command.id}
                    value={command.title}
                    icon={command.icon}
                    title={command.title}
                    subtitle={command.subtitle}
                    badge="Soon"
                />
            ))}
        </Command.Group>
    )

    const liveResults = live.results?.status === 'ok' ? live.results : null
    const suggestions = (liveResults?.suggestions ?? []).filter((text) => text.toLowerCase() !== trimmed.toLowerCase())

    return (
        <Command
            label="Music Bar"
            loop
            // Results come from YouTube Music, so the list shows them as-is
            // instead of letting cmdk fuzzy-filter them against the input.
            shouldFilter={false}
            value={selected}
            onValueChange={setSelected}
            onKeyDown={handleKeyDown}
            className="flex h-full flex-col bg-[#161618]/85 text-neutral-100"
        >
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 px-4">
                <Search className="size-[18px] text-neutral-400" />
                <Command.Input
                    ref={inputRef}
                    autoFocus
                    value={query}
                    onValueChange={changeQuery}
                    placeholder="Search YouTube Music or run a command…"
                    className="h-full flex-1 bg-transparent text-[17px] outline-none placeholder:text-neutral-400"
                />
                {(live.loading || full.loading) && (
                    <span className="size-4 animate-spin rounded-full border-2 border-white/15 border-t-white/60" />
                )}
            </div>

            {!trimmed && <NowPlaying {...nowPlaying} />}

            <Command.List className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2">
                {!trimmed && commands}

                {trimmed && submitted === null && (
                    <>
                        <Command.Group heading="Search">
                            <SearchRow query={trimmed} label={`Search “${trimmed}”`} onSelect={() => submit(trimmed)} />
                            {suggestions.map((text) => (
                                <SearchRow key={text} query={text} label={text} onSelect={() => submit(text)} />
                            ))}
                        </Command.Group>
                        {live.results?.status === 'error' && <ListNote>{live.results.message}</ListNote>}
                        {liveResults && liveResults.songs.length > 0 && (
                            <Command.Group heading="Songs">
                                {liveResults.songs.map((song) => (
                                    <SongRow key={song.videoId} song={song} onSelect={() => play(song)} />
                                ))}
                            </Command.Group>
                        )}
                        {commands}
                    </>
                )}

                {submitted !== null && (
                    <Command.Group heading={`Songs for “${submitted}”`}>
                        {full.results === null && <ListNote>Searching…</ListNote>}
                        {full.results?.status === 'error' && <ListNote>{full.results.message}</ListNote>}
                        {full.results?.status === 'ok' && full.results.songs.length === 0 && (
                            <ListNote>No songs found</ListNote>
                        )}
                        {full.results?.status === 'ok' &&
                            full.results.songs.map((song) => (
                                <SongRow key={song.videoId} song={song} onSelect={() => play(song)} />
                            ))}
                    </Command.Group>
                )}
            </Command.List>

            <footer className="flex h-10 shrink-0 items-center justify-between border-t border-white/10 bg-white/[0.03] px-4 text-xs text-neutral-400">
                <span className="flex min-w-0 items-center gap-1.5">
                    <Music2 className="size-3.5 shrink-0" />
                    <span className={`truncate ${notice ? 'text-neutral-200' : ''}`}>{notice ?? 'Music Bar'}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                    {selectedSong ? (
                        <>
                            <Hint keys="↵" label="Play Now" />
                            <Hint keys="⇧↵" label="Play Next" />
                        </>
                    ) : (
                        <Hint keys="↵" label={selected.startsWith('search:') ? 'Search' : 'Select'} />
                    )}
                    <Hint keys="esc" label={submitted !== null ? 'Back' : query ? 'Clear' : 'Close'} />
                </span>
            </footer>
        </Command>
    )
}

function CommandRow({
    value,
    icon,
    title,
    subtitle,
    badge,
    shortcut,
    muted,
    onSelect,
}: {
    value: string
    icon: ReactNode
    title: string
    subtitle: string
    badge?: string
    shortcut?: string
    muted?: boolean
    onSelect?: () => void
}) {
    return (
        <Command.Item
            value={value}
            onSelect={onSelect}
            className={`flex h-11 items-center gap-3 rounded-lg px-2 text-sm data-[selected=true]:bg-white/10 ${muted ? 'opacity-50' : ''}`}
        >
            <span className="flex size-7 items-center justify-center rounded-md bg-red-500/90 text-white [&>svg]:size-4">
                {icon}
            </span>
            <span className="font-medium">{title}</span>
            <span className="truncate text-neutral-400">{subtitle}</span>
            <span className="ml-auto flex shrink-0 items-center gap-2">
                {badge && (
                    <span className="rounded px-1.5 py-0.5 text-[11px] text-neutral-400 ring-1 ring-white/15">
                        {badge}
                    </span>
                )}
                {shortcut && (
                    <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-sans text-[11px] text-neutral-300">
                        {shortcut}
                    </kbd>
                )}
            </span>
        </Command.Item>
    )
}

function Hint({ keys, label }: { keys: string; label: string }) {
    return (
        <span className="flex items-center gap-1.5">
            {label}
            <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-sans text-[11px]">{keys}</kbd>
        </span>
    )
}
