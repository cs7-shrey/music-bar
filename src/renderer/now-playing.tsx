import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Music2, Pause, Play, Repeat1, SkipBack, SkipForward } from 'lucide-react'
import type { NowPlaying as NowPlayingState, PlayerControl, SearchSong, Track } from '../shared/ipc'

const POLL_MS = 2000
// After an action, the acted-on tab is re-read this often until the change
// shows (or the timeout passes), instead of waiting for the next poll.
const SETTLE_POLL_MS = 250
const SETTLE_TIMEOUT_MS = 4000
// The card dims only if the first read after opening takes longer than this,
// so a fast read doesn't flash it dim and back.
const STALE_DIM_DELAY_MS = 300
// Rapid presses of play/pause or loop only flip the UI; the page gets the
// final state once the presses stop.
const TOGGLE_DEBOUNCE_MS = 300

type Toggle = 'play' | 'loop'

const sameSong = (a: Track, b: Track) => a.title === b.title && a.artist === b.artist

/** Polls the current YouTube Music track while the launcher is visible. */
export function useNowPlaying() {
    const [state, setState] = useState<NowPlayingState | null>(null)
    // Dims the card when, shortly after opening, it still shows the state from
    // when the launcher last closed, which may be out of date.
    const [stale, setStale] = useState(false)
    const awaitingFreshRead = useRef(true)
    // Bumped on every user action. A read that started before the latest
    // action carries stale state and would undo the optimistic update.
    const actionSeq = useRef(0)
    const actionsInFlight = useRef(0)
    const toggleTimers = useRef<Partial<Record<Toggle, ReturnType<typeof setTimeout>>>>({})
    // The track as last rendered, including optimistic flips; debounced
    // toggles read their final target from it.
    const latestTrack = useRef<Track | null>(null)

    /** Runs a read and returns its result, or null when an action made it stale. */
    const read = useCallback(async (fetch: () => Promise<NowPlayingState | null>) => {
        const seq = actionSeq.current
        const next = await fetch()
        const isFresh = seq === actionSeq.current && actionsInFlight.current === 0
        return isFresh ? next : null
    }, [])

    const accept = useCallback((next: NowPlayingState) => {
        awaitingFreshRead.current = false
        setState(next)
        setStale(false)
    }, [])

    useEffect(() => {
        // Bumped on every show/hide so a slow in-flight poll from an earlier
        // show cannot start a second loop.
        let generation = 0
        let timer: ReturnType<typeof setTimeout> | undefined
        let dimTimer: ReturnType<typeof setTimeout> | undefined

        const poll = async (current: number) => {
            const next = await read(window.musicBar.getNowPlaying)
            if (current !== generation) return
            if (next) accept(next)
            timer = setTimeout(() => void poll(current), POLL_MS)
        }
        const stop = () => {
            generation++
            clearTimeout(timer)
            clearTimeout(dimTimer)
            awaitingFreshRead.current = true
            setStale(false)
        }
        const start = async () => {
            stop()
            const current = generation
            dimTimer = setTimeout(() => {
                if (awaitingFreshRead.current) setStale(true)
            }, STALE_DIM_DELAY_MS)
            // The followed tab alone answers in about a tenth of a second; the
            // full scan follows to catch other tabs and inactive ones.
            const quick = await read(window.musicBar.getFollowedNowPlaying)
            if (current !== generation) return
            if (quick) accept(quick)
            void poll(current)
        }

        const offShown = window.musicBar.onShown(() => void start())
        const offHidden = window.musicBar.onHidden(stop)
        return () => {
            stop()
            offShown()
            offHidden()
        }
    }, [read, accept])

    const applyOptimistic = (optimistic: (track: Track) => Track) => {
        actionSeq.current++
        setState((current) =>
            current?.status === 'track' ? { ...current, track: optimistic(current.track) } : current,
        )
    }

    /**
     * Re-reads the followed tab (the one just acted on) every 250ms until
     * `isDone` sees the change, then hands back to the regular poll. Gives up
     * on a newer action, or after the timeout with one full read.
     */
    const settle = async (isDone: (track: Track) => boolean) => {
        const seq = actionSeq.current
        const deadline = Date.now() + SETTLE_TIMEOUT_MS
        while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS))
            if (seq !== actionSeq.current) return
            const next = await read(window.musicBar.getFollowedNowPlaying)
            if (next?.status === 'track' && isDone(next.track)) return accept(next)
        }
        const next = await read(window.musicBar.getNowPlaying)
        if (next) accept(next)
    }

    /** Runs an action, then re-reads quickly until the page shows the change. */
    const runAction = async (run: () => Promise<void>, isDone: (track: Track) => boolean) => {
        try {
            await run()
        } catch (error) {
            console.error('[music-bar] action failed', error)
        } finally {
            actionsInFlight.current--
        }
        await settle(isDone)
    }

    /** Applies an optimistic update and runs the action right away. */
    const act = async (
        optimistic: (track: Track) => Track,
        run: () => Promise<void>,
        isDone: (track: Track) => boolean,
    ) => {
        applyOptimistic(optimistic)
        actionsInFlight.current++
        await runAction(run, isDone)
    }

    /**
     * Flips the UI now and sends the final state once presses stop, so
     * pause-then-resume in quick succession sends nothing the page notices.
     * The pending toggle counts as in flight, which keeps polls from
     * overwriting the optimistic state meanwhile.
     */
    const debouncedToggle = (
        key: Toggle,
        flip: (track: Track) => Track,
        send: (target: Track) => Promise<void>,
        isDone: (target: Track, track: Track) => boolean,
    ) => {
        if (!latestTrack.current) return
        applyOptimistic(flip)
        const pending = toggleTimers.current[key]
        if (pending) clearTimeout(pending)
        else actionsInFlight.current++
        toggleTimers.current[key] = setTimeout(() => {
            delete toggleTimers.current[key]
            const target = latestTrack.current
            if (!target) {
                actionsInFlight.current--
                return
            }
            void runAction(
                () => send(target),
                (track) => isDone(target, track),
            )
        }, TOGGLE_DEBOUNCE_MS)
    }

    const track = state?.status === 'track' ? state.track : null
    latestTrack.current = track

    const control = (action: PlayerControl) => {
        if (!track) return
        const before = track
        void act(
            (current) => current,
            () => window.musicBar.control(before.source, action),
            (next) => !sameSong(next, before),
        )
    }

    const togglePlay = () =>
        debouncedToggle(
            'play',
            (current) => ({ ...current, isPlaying: !current.isPlaying }),
            (target) => window.musicBar.setPlaying(target.source, target.isPlaying),
            (target, next) => next.isPlaying === target.isPlaying,
        )

    // Turning the loop off restores the previous mode, which only the page
    // knows; 'NONE' is a placeholder until the re-read lands.
    const toggleLoop = () =>
        debouncedToggle(
            'loop',
            (current) => ({ ...current, repeatMode: current.repeatMode === 'ONE' ? 'NONE' : 'ONE' }),
            (target) => window.musicBar.setLoop(target.source, target.repeatMode === 'ONE'),
            (target, next) => (next.repeatMode === 'ONE') === (target.repeatMode === 'ONE'),
        )

    const playNow = (song: SearchSong) => {
        const before = track
        return act(
            (current) => ({
                ...current,
                title: song.title,
                artist: song.artist,
                album: '',
                artworkUrl: song.thumbnailUrl,
                isPlaying: true,
            }),
            () => window.musicBar.playNow(song),
            (next) => !before || !sameSong(next, before),
        )
    }

    const [loadingTab, setLoadingTab] = useState(false)

    /** Gets Brave to load an inactive YT Music tab; the next read shows its song. */
    const loadTab = async () => {
        if (state?.status !== 'unloaded' || loadingTab) return
        const { source } = state
        setLoadingTab(true)
        actionSeq.current++
        actionsInFlight.current++
        await runAction(
            () => window.musicBar.loadTab(source),
            () => true,
        )
        setLoadingTab(false)
    }

    return { state, stale, control, togglePlay, toggleLoop, playNow, loadTab, loadingTab }
}

export function NowPlaying({
    state,
    stale,
    control,
    togglePlay,
    toggleLoop,
    loadingTab,
}: ReturnType<typeof useNowPlaying>) {
    if (state?.status !== 'track') {
        const [title, detail] =
            state?.status === 'error'
                ? ["Can't reach YouTube Music", describeError(state.message)]
                : state?.status === 'unloaded'
                  ? loadingTab
                      ? ['Loading YouTube Music…', 'Opening the tab for a moment']
                      : ['YouTube Music tab is inactive', 'Brave unloaded it to save memory. Press ↵ to load it.']
                  : ['Nothing playing', 'Open YouTube Music in Brave, Chrome or Helium']
        return (
            <Card artwork={null} stale={stale}>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold">{title}</div>
                    <div className="line-clamp-2 text-[13px] text-neutral-400">{detail}</div>
                </div>
            </Card>
        )
    }

    const { track } = state
    return (
        <Card artwork={track.artworkUrl} stale={stale}>
            <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{track.title}</div>
                <div className="truncate text-[13px] text-neutral-400">{track.artist}</div>
                {track.isAsleep && !track.isPlaying && (
                    <div className="truncate text-xs text-amber-300/90">
                        Brave hasn't loaded this tab yet · Play opens it for a moment
                    </div>
                )}
            </div>
            <div className="flex items-center gap-1">
                <ControlButton
                    label={track.repeatMode === 'ONE' ? 'Stop looping (⌘O)' : 'Loop this song (⌘O)'}
                    onClick={toggleLoop}
                    active={track.repeatMode === 'ONE'}
                >
                    <Repeat1 className="size-[18px]" />
                </ControlButton>
                <ControlButton label="Previous (⌘H)" onClick={() => void control('previous')}>
                    <SkipBack className="size-[18px]" fill="currentColor" />
                </ControlButton>
                <ControlButton label={track.isPlaying ? 'Pause' : 'Play'} onClick={togglePlay} large>
                    {track.isPlaying ? (
                        <Pause className="size-6" fill="currentColor" strokeWidth={0} />
                    ) : (
                        <Play className="size-6" fill="currentColor" strokeWidth={0} />
                    )}
                </ControlButton>
                <ControlButton label="Next (⌘L)" onClick={() => void control('next')}>
                    <SkipForward className="size-[18px]" fill="currentColor" />
                </ControlButton>
            </div>
        </Card>
    )
}

function Card({
    artwork: artworkUrl,
    stale,
    children,
}: {
    artwork: string | null
    /** Dims the card while it shows state from before the launcher opened. */
    stale: boolean
    children: ReactNode
}) {
    // A failed load falls back to the placeholder instead of a broken image.
    // Keyed by URL, so the next song gets a fresh attempt.
    const [failedUrl, setFailedUrl] = useState<string | null>(null)
    const artwork = artworkUrl !== failedUrl ? artworkUrl : null
    const onError = () => setFailedUrl(artworkUrl)

    return (
        <div
            className={`relative mx-2 mt-2 shrink-0 overflow-hidden rounded-xl bg-white/[0.04] transition-opacity duration-150 ${stale ? 'opacity-50' : ''}`}
        >
            {artwork && (
                <img
                    src={artwork}
                    alt=""
                    onError={onError}
                    className="pointer-events-none absolute inset-0 size-full scale-150 object-cover opacity-30 blur-2xl"
                />
            )}
            <div className="relative flex items-center gap-4 p-3">
                {artwork ? (
                    <img src={artwork} alt="" onError={onError} className="size-16 shrink-0 rounded-lg object-cover shadow-lg shadow-black/40" />
                ) : (
                    <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-red-500 to-rose-700 shadow-lg shadow-black/40">
                        <Music2 className="size-6 text-white" />
                    </div>
                )}
                {children}
            </div>
        </div>
    )
}

function ControlButton({
    label,
    onClick,
    large,
    active,
    children,
}: {
    label: string
    onClick: () => void
    large?: boolean
    active?: boolean
    children: ReactNode
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            tabIndex={-1}
            // Keep focus in the search input.
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClick}
            className={`flex items-center justify-center rounded-full transition hover:bg-white/10 active:scale-95 ${large ? 'size-11' : 'size-9'} ${active ? 'text-red-400 hover:text-red-300' : 'text-neutral-200 hover:text-white'}`}
        >
            {children}
        </button>
    )
}

function describeError(message: string): string {
    if (/JavaScript through AppleScript is turned off/i.test(message)) {
        return 'Turn on View → Developer → Allow JavaScript from Apple Events in your browser.'
    }
    if (/AppleEvent timed out/i.test(message)) {
        return "The browser didn't answer in time. Try again in a moment."
    }
    if (/Not authorized to send Apple events/i.test(message)) {
        return 'Allow Music Bar to control your browser in System Settings → Privacy & Security → Automation.'
    }
    return message
}
