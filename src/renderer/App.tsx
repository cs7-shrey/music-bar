import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Command } from 'cmdk'
import { ExternalLink, Globe, MousePointerClick, Pause, Play, Radio, Repeat1, Search } from 'lucide-react'
import type { BrowserName, BrowserState, BrowserStatus, PlayerControl, SearchSong } from '../shared/ipc'
import { BROWSER_NAMES, NowPlaying, useArtwork, useNowPlaying, WAITING } from './now-playing'
import { ListNote, SearchRow, SongRow, searchValue, songValue, useFullSearch, useSuggestions } from './search'
import markUrl from '../../assets/mark.svg'

const PLAY_PAUSE_COMMAND = 'Play or Pause'
const LOOP_COMMAND = 'Loop Current Song'
const RADIO_COMMAND = 'Start Radio'

const NOTICE_MS = 2500

const BROWSER_STATES: Record<BrowserState, { label: string; problem: string | null }> = {
    connected: { label: 'Connected', problem: null },
    'no-tab': { label: 'No tab', problem: null },
    'needs-setup': { label: 'Needs setup', problem: 'needs setup' },
    'needs-permission': { label: 'Needs permission', problem: 'needs permission' },
    error: { label: 'Error', problem: "can't be reached" },
}

/** What to tell the user about a browser, including how to fix it. */
function describeBrowser({ state, message }: BrowserStatus): string {
    switch (state) {
        case 'connected':
            return 'YouTube Music is connected'
        case 'no-tab':
            return 'No YouTube Music tab open'
        case 'needs-setup':
            return 'Turn on View → Developer → Allow JavaScript from Apple Events'
        case 'needs-permission':
            return 'Allow Music Bar in System Settings → Privacy & Security → Automation'
        case 'error':
            return message ?? 'Something went wrong'
    }
}

// ⌘R is free: the app menu has no Reload item (see index.ts).
const SHORTCUTS: Record<string, 'loop' | 'radio' | PlayerControl> = { o: 'loop', r: 'radio', h: 'previous', l: 'next' }

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
    // Song-only commands (loop, radio) are unavailable while an ad plays.
    const isAd = track?.isAd ?? false
    const artwork = useArtwork(track?.artworkUrl ?? null)

    const trimmed = query.trim()
    // The tab searches run in was unloaded by its browser: its scripts time
    // out, so search offers to load it first.
    const tabUnloaded = nowPlaying.state?.status === 'unloaded'
    // Bumped to run the same full search again once the tab has loaded.
    const [searchAttempt, setSearchAttempt] = useState(0)
    // No suggestions without a usable YouTube Music tab to ask; the rows offer to open or load one.
    const live = useSuggestions(submitted === null && !nowPlaying.needsTab && !tabUnloaded ? query : '')
    const full = useFullSearch(submitted ?? '', searchAttempt)

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

    // Debounced inside nowPlaying.startRadio, so the row, ⌘R and repeats of
    // either start one radio.
    const startRadio = () => {
        // Waits for the state to catch up; nowPlaying runs it then.
        if (nowPlaying.syncing) return nowPlaying.startRadio()
        if (!track || isAd) return
        nowPlaying.startRadio()
        setNotice(`Starting a radio from “${track.title}”`)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
        // ⌘↵ on a song starts a radio from it, then returns to the card.
        if (event.key === 'Enter' && event.metaKey && selectedSong) {
            event.preventDefault()
            nowPlaying.startRadioFrom(selectedSong)
            reset()
            return
        }
        // ⇧↵ on a song queues it instead of playing it; the results stay up
        // so several songs can be queued in a row.
        if (event.key === 'Enter' && event.shiftKey && selectedSong) {
            event.preventDefault()
            void queueNext(selectedSong)
            return
        }
        // Player shortcuts work from anywhere, even mid-search: ⌘O loop,
        // ⌘R radio, ⌘H previous, ⌘L next.
        const shortcut = event.metaKey && !event.shiftKey && !event.altKey && SHORTCUTS[event.key.toLowerCase()]
        if (shortcut) {
            event.preventDefault()
            // A held key repeats about every 30ms; each of those would be one
            // more skip, queued behind the last.
            if (event.repeat) return
            if (shortcut === 'loop') nowPlaying.toggleLoop('list')
            else if (shortcut === 'radio') startRadio()
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

    // With no YouTube Music tab anywhere, the first row opens one instead of
    // playing: one row per browser that's ready (last used first), the first
    // keeping the Play row's value so ↵ right after opening picks it.
    const openRows = nowPlaying.openable.map((browser, index) => (
        <CommandRow
            key={browser}
            value={index === 0 ? PLAY_PAUSE_COMMAND : `open:${browser}`}
            icon={<ExternalLink strokeWidth={2.25} />}
            title="Open YouTube Music"
            subtitle={
                nowPlaying.openingIn === browser
                    ? `Opening in ${BROWSER_NAMES[browser]}…`
                    : `In ${BROWSER_NAMES[browser]}, in the background`
            }
            muted={nowPlaying.openingIn !== null}
            onSelect={() => void nowPlaying.openYouTubeMusic(browser)}
        />
    ))

    const playRow =
        nowPlaying.state?.status === 'unloaded' ? (
            // Same row and value, so ↵ right after opening loads the tab.
            <CommandRow
                value={PLAY_PAUSE_COMMAND}
                icon={<Play fill="currentColor" strokeWidth={0} />}
                title="Load YouTube Music"
                subtitle="Opens the inactive tab for a moment"
                muted={nowPlaying.loadingTab}
                onSelect={() => void nowPlaying.loadTab()}
            />
        ) : nowPlaying.needsTab && openRows.length > 0 ? (
            openRows
        ) : track?.playBlocked ? (
            // The browser won't start sound until the page gets a real click;
            // same value, so ↵ goes straight to the fix.
            <CommandRow
                value={PLAY_PAUSE_COMMAND}
                icon={<MousePointerClick strokeWidth={2.25} />}
                title="Show Tab"
                subtitle={`Click play there once: ${BROWSER_NAMES[track.source.browser]} won't start sound until you do`}
                onSelect={nowPlaying.showTab}
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
                muted={!track && !nowPlaying.syncing}
                waiting={nowPlaying.queued.get('play') === 'list'}
                onSelect={() => nowPlaying.togglePlay('list')}
            />
        )

    // Commands and browser status live on the empty screen only; once you
    // type, the list is search results and nothing else.
    const commands = (
        <Command.Group heading="Playback">
            {playRow}
            <CommandRow
                // Stable value so the selection does not jump when the title flips.
                value={LOOP_COMMAND}
                icon={<Repeat1 strokeWidth={2.25} />}
                title={isLooping ? 'Stop Looping' : 'Loop Current Song'}
                subtitle={
                    isAd
                        ? 'Not available during ads'
                        : track
                          ? `${isLooping ? 'Looping' : 'Repeat'} “${track.title}”`
                          : 'Nothing is playing'
                }
                shortcut="⌘O"
                // Dimmed rather than skipped: a missing row would push the
                // selection onto a placeholder while the track loads.
                muted={(!track && !nowPlaying.syncing) || isAd}
                waiting={nowPlaying.queued.get('loop') === 'list'}
                onSelect={() => nowPlaying.toggleLoop('list')}
            />
            <CommandRow
                value={RADIO_COMMAND}
                icon={<Radio strokeWidth={2.25} />}
                title="Start Radio"
                subtitle={
                    isAd ? 'Not available during ads' : track ? `A mix based on “${track.title}”` : 'Nothing is playing'
                }
                shortcut="⌘R"
                muted={(!track && !nowPlaying.syncing) || isAd}
                waiting={nowPlaying.queued.has('radio')}
                onSelect={startRadio}
            />
        </Command.Group>
    )

    // Searching needs a YouTube Music tab; without one, the search rows offer
    // to open it and run the search once it's up.
    const openAndSearch = async (browser: BrowserName, searchQuery: string) => {
        await nowPlaying.openYouTubeMusic(browser)
        submit(searchQuery)
    }

    // The same for an unloaded tab: load it, then search.
    const loadAndSearch = async (searchQuery: string) => {
        await nowPlaying.loadTab()
        submit(searchQuery)
        setSearchAttempt((attempt) => attempt + 1)
    }
    const loadAndSearchRow = (searchQuery: string) =>
        nowPlaying.state?.status === 'unloaded' && (
            <Command.Group heading="Search">
                <CommandRow
                    // The search row's value, so ↵ picks it.
                    value={searchValue(searchQuery)}
                    icon={<Play fill="currentColor" strokeWidth={0} />}
                    title={`Load YouTube Music in ${BROWSER_NAMES[nowPlaying.state.source.browser]}`}
                    subtitle={nowPlaying.loadingTab ? 'Loading…' : `The tab is inactive. Then search “${searchQuery}”`}
                    muted={nowPlaying.loadingTab}
                    onSelect={() => void loadAndSearch(searchQuery)}
                />
            </Command.Group>
        )

    // Open browsers that can't be used. When there are any, the empty screen
    // lists every open browser's status and the footer flags the first one.
    const problems = nowPlaying.browsers.filter((browser) => BROWSER_STATES[browser.state].problem)
    const browserRows = problems.length > 0 && (
        <Command.Group heading="Browsers">
            {nowPlaying.browsers.map((status) => (
                <CommandRow
                    key={status.browser}
                    value={`browser:${status.browser}`}
                    icon={<Globe strokeWidth={2.25} />}
                    title={BROWSER_NAMES[status.browser]}
                    subtitle={describeBrowser(status)}
                    badge={BROWSER_STATES[status.state].label}
                    onSelect={() => window.musicBar.showSetup('browsers')}
                />
            ))}
        </Command.Group>
    )
    const footerProblem = problems[0]

    const liveResults = live.results?.status === 'ok' ? live.results : null
    const suggestions = (liveResults?.suggestions ?? []).filter((text) => text.toLowerCase() !== trimmed.toLowerCase())

    return (
        <Command
            label="Music Bar"
            loop
            // Results come from YouTube Music, so the list shows them as-is
            // instead of letting cmdk fuzzy-filter them against the input.
            shouldFilter={false}
            // As in Raycast, the mouse doesn't move the selection; ↵ acts on
            // what the arrow keys (or a click) chose. Hover gets its own,
            // fainter highlight.
            disablePointerSelection
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

            <Command.List className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-2">
                {!trimmed && commands}
                {!trimmed && browserRows}

                {trimmed && submitted === null && (
                    <>
                        {tabUnloaded ? (
                            loadAndSearchRow(trimmed)
                        ) : nowPlaying.needsTab ? (
                            nowPlaying.openable.length > 0 ? (
                                <Command.Group heading="Search">
                                    {nowPlaying.openable.map((browser, index) => (
                                        <CommandRow
                                            key={browser}
                                            // The first takes the search row's value, so ↵ picks it.
                                            value={index === 0 ? searchValue(trimmed) : `open-search:${browser}`}
                                            icon={<ExternalLink strokeWidth={2.25} />}
                                            title={`Open YouTube Music in ${BROWSER_NAMES[browser]}`}
                                            subtitle={
                                                nowPlaying.openingIn === browser ? 'Opening…' : `and search “${trimmed}”`
                                            }
                                            muted={nowPlaying.openingIn !== null}
                                            onSelect={() => void openAndSearch(browser, trimmed)}
                                        />
                                    ))}
                                </Command.Group>
                            ) : (
                                <ListNote>
                                    {nowPlaying.browsers.length === 0
                                        ? 'Open your browser to search'
                                        : 'Set up a browser to search: View → Developer → Allow JavaScript from Apple Events'}
                                </ListNote>
                            )
                        ) : (
                            <Command.Group heading="Search">
                                <SearchRow query={trimmed} label={`Search “${trimmed}”`} onSelect={() => submit(trimmed)} />
                                {suggestions.map((text) => (
                                    <SearchRow key={text} query={text} label={text} onSelect={() => submit(text)} />
                                ))}
                            </Command.Group>
                        )}
                        {live.results?.status === 'error' && <ListNote>{live.results.message}</ListNote>}
                        {liveResults && liveResults.songs.length > 0 && (
                            <Command.Group heading="Songs">
                                {liveResults.songs.map((song) => (
                                    <SongRow key={song.videoId} song={song} onSelect={() => play(song)} />
                                ))}
                            </Command.Group>
                        )}
                    </>
                )}

                {submitted !== null && full.results?.status !== 'ok' && tabUnloaded && loadAndSearchRow(submitted)}
                {submitted !== null && !(full.results?.status !== 'ok' && tabUnloaded) && (
                    <Command.Group heading={`Songs for “${submitted}”`}>
                        {(full.results === null || (full.loading && full.results.status === 'error')) && (
                            <ListNote>Searching…</ListNote>
                        )}
                        {full.results?.status === 'error' && !full.loading && <ListNote>{full.results.message}</ListNote>}
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
                    <img src={markUrl} alt="" className="size-5 shrink-0" draggable={false} />
                    {notice ? (
                        <span className="truncate text-white">{notice}</span>
                    ) : track?.playBlocked ? (
                        <span className="truncate text-white">
                            <span className="mr-1.5 inline-block size-1.5 rounded-full bg-amber-400 align-middle" />
                            {BROWSER_NAMES[track.source.browser]} needs one click in the tab to play
                        </span>
                    ) : footerProblem ? (
                        <span className="truncate text-white">
                            <span className="mr-1.5 inline-block size-1.5 rounded-full bg-amber-400 align-middle" />
                            {BROWSER_NAMES[footerProblem.browser]} {BROWSER_STATES[footerProblem.state].problem}
                            {problems.length > 1 && ` · +${problems.length - 1} more`}
                        </span>
                    ) : (
                        <span className="truncate">Music Bar</span>
                    )}
                </span>
                <span className="flex shrink-0 items-center gap-4">
                    {selectedSong ? (
                        <>
                            <Hint keys="↵" label="Play" />
                            <Hint keys="⇧↵" label="Play next" />
                            <Hint keys="⌘↵" label="Radio" />
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
    waiting,
    onSelect,
}: {
    value: string
    icon: ReactNode
    title: string
    subtitle: string
    badge?: string
    shortcut?: string
    muted?: boolean
    /** Pressed while the launcher's state was catching up; runs once it has. */
    waiting?: boolean
    onSelect?: () => void
}) {
    return (
        <Command.Item
            value={value}
            onSelect={onSelect}
            className={`group flex h-12 items-center gap-3 rounded-md px-2 data-[selected=false]:hover:bg-white/[0.04] data-[selected=true]:bg-white/[0.08] ${muted ? 'opacity-50' : ''}`}
        >
            <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-full bg-highlight text-white transition [&>svg]:size-[18px] ${waiting ? WAITING : ''}`}
            >
                {icon}
            </span>
            {/* The title keeps its width; a long subtitle truncates instead. */}
            <span className="shrink-0 whitespace-nowrap text-[15px] font-semibold">{title}</span>
            <span className="min-w-0 truncate text-[13px] font-medium text-subdued">
                {waiting ? 'Catching up with YouTube Music…' : subtitle}
            </span>
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
