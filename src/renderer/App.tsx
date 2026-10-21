import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Command } from 'cmdk'
import { Music2, Pause, Play, Radio, Repeat1, Search } from 'lucide-react'
import type { PlayerControl, SearchSong } from '../shared/ipc'
import { NowPlaying, useArtwork, useNowPlaying } from './now-playing'
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
]

const NOTICE_MS = 2500

const SHORTCUTS: Record<string, 'loop' | PlayerControl> = { o: 'loop', h: 'previous', l: 'next' }

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
    const artwork = useArtwork(track?.artworkUrl ?? null)

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
        // Player shortcuts work from anywhere, even mid-search: ⌘O loop,
        // ⌘H previous, ⌘L next.
        const shortcut = event.metaKey && !event.shiftKey && !event.altKey && SHORTCUTS[event.key.toLowerCase()]
        if (shortcut) {
            event.preventDefault()
            if (shortcut === 'loop') nowPlaying.toggleLoop()
            else nowPlaying.control(shortcut)
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
            {showPlayPause &&
                (nowPlaying.state?.status === 'unloaded' ? (
                    // Same row and value, so ↵ right after opening loads the tab.
                    <CommandRow
                        value={PLAY_PAUSE_COMMAND}
                        icon={<Play fill="currentColor" strokeWidth={0} />}
                        title="Load YouTube Music"
                        subtitle="Opens the inactive tab for a moment"
                        muted={nowPlaying.loadingTab}
                        onSelect={() => void nowPlaying.loadTab()}
                    />
                ) : (
                    <CommandRow
                        // Stable value so the selection does not jump when the title flips.
                        value={PLAY_PAUSE_COMMAND}
                        icon={
                            track?.isPlaying ? (
                                <Pause fill="currentColor" strokeWidth={0} />
                            ) : (
                                <Play fill="currentColor" strokeWidth={0} />
                            )
                        }
                        title={track?.isPlaying ? 'Pause' : 'Play'}
                        subtitle={
                            !track
                                ? 'Nothing is playing'
                                : track.isAsleep && !track.isPlaying
                                  ? `“${track.title}” · opens the tab for a moment to load it`
                                  : `“${track.title}”`
                        }
                        muted={!track}
                        onSelect={nowPlaying.togglePlay}
                    />
                ))}
            {showLoop && (
                <CommandRow
                    // Stable value so the selection does not jump when the title flips.
                    value={LOOP_COMMAND}
                    icon={<Repeat1 strokeWidth={2.25} />}
                    title={isLooping ? 'Stop Looping' : 'Loop Current Song'}
                    subtitle={track ? `${isLooping ? 'Looping' : 'Repeat'} “${track.title}”` : 'Nothing is playing'}
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
            className="flex h-full flex-col overflow-hidden rounded-[18px] bg-base text-white ring-1 ring-white/[0.07] ring-inset"
        >
            {/* The header takes its color from the artwork and fades into the page, as Spotify's now-playing view does. */}
            <header
                className="relative shrink-0 transition-[background-color] duration-700"
                style={{ backgroundColor: artwork.color }}
            >
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/0 via-base/55 to-base" />
                <div className="relative">
                    <div className="px-3 pt-3">
                        <div className="flex h-11 items-center gap-3 rounded-full bg-black/35 px-4 ring-1 ring-white/10 transition focus-within:bg-black/45 focus-within:ring-white/25">
                            <Search className="size-5 shrink-0 text-subdued" strokeWidth={2.25} />
                            <Command.Input
                                ref={inputRef}
                                autoFocus
                                value={query}
                                onValueChange={changeQuery}
                                placeholder="What do you want to play?"
                                className="h-full min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-white outline-none placeholder:font-medium placeholder:text-subdued"
                            />
                            {(live.loading || full.loading) && (
                                <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                            )}
                        </div>
                    </div>
                    {trimmed ? <div className="h-2" /> : <NowPlaying {...nowPlaying} artwork={artwork} />}
                </div>
            </header>

            <Command.List className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
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

            <footer className="flex h-10 shrink-0 items-center justify-between border-t border-white/[0.06] px-5 text-xs font-semibold text-subdued">
                <span className="flex min-w-0 items-center gap-2">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent">
                        <Music2 className="size-3 text-white" strokeWidth={2.5} />
                    </span>
                    <span className={`truncate ${notice ? 'text-white' : ''}`}>{notice ?? 'Music Bar'}</span>
                </span>
                <span className="flex shrink-0 items-center gap-4">
                    {selectedSong ? (
                        <>
                            <Hint keys="↵" label="Play" />
                            <Hint keys="⇧↵" label="Play next" />
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
            className={`group flex h-12 items-center gap-3 rounded-md px-2 data-[selected=true]:bg-white/[0.08] ${muted ? 'opacity-50' : ''}`}
        >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-highlight text-white [&>svg]:size-[18px]">
                {icon}
            </span>
            {/* The title keeps its width; a long subtitle truncates instead. */}
            <span className="shrink-0 whitespace-nowrap text-[15px] font-semibold">{title}</span>
            <span className="min-w-0 truncate text-[13px] font-medium text-subdued">{subtitle}</span>
            <span className="ml-auto flex shrink-0 items-center gap-3">
                {badge && (
                    <span className="rounded-full bg-white/[0.07] px-2.5 py-0.5 text-[11px] font-bold text-subdued">
                        {badge}
                    </span>
                )}
                {shortcut && (
                    <span className="text-xs font-semibold text-faint group-data-[selected=true]:text-subdued">
                        {shortcut}
                    </span>
                )}
            </span>
        </Command.Item>
    )
}

function Hint({ keys, label }: { keys: string; label: string }) {
    return (
        <span>
            <span className="mr-1 text-white">{keys}</span>
            {label}
        </span>
    )
}
