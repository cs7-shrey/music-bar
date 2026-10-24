import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Music2, Pause, Play } from 'lucide-react'
import type {
    BrowserStatus,
    NowPlaying as NowPlayingState,
    PlayerControl,
    RepeatMode,
    SearchSong,
    Track,
} from '../shared/ipc'

const POLL_MS = 2000
// After an action, the acted-on tab is re-read this often until the change
// shows (or the timeout passes), instead of waiting for the next poll.
const SETTLE_POLL_MS = 250
const SETTLE_TIMEOUT_MS = 4000
// The card dims only if the first read after opening takes longer than this,
// so a fast read doesn't flash it dim and back.
const STALE_DIM_DELAY_MS = 300
// Rapid presses of play/pause or loop only flip the UI; the page gets the
// final state once the presses stop. Other debounced actions (see
// debounceAction) wait the same time and run only the last press.
const TOGGLE_DEBOUNCE_MS = 300
// How long a skip button shows as pressed, so ⌘H/⌘L look like a click.
const PRESS_FLASH_MS = 160

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

    // Every open browser and whether it can be used; only full reads carry it.
    const [browsers, setBrowsers] = useState<BrowserStatus[]>([])

    const accept = useCallback((next: NowPlayingState) => {
        awaitingFreshRead.current = false
        setState(next)
        setStale(false)
        if (next.browsers) setBrowsers(next.browsers)
    }, [])

    useEffect(() => {
        // Bumped on every show/hide so a slow in-flight poll from an earlier
        // show cannot start a second loop.
        let generation = 0
        let timer: ReturnType<typeof setTimeout> | undefined
        let dimTimer: ReturnType<typeof setTimeout> | undefined

        const poll = async (current: number) => {
            try {
                const next = await read(window.musicBar.getNowPlaying)
                if (current === generation && next) accept(next)
            } catch (error) {
                // A failed read must not end the loop, or the card freezes until the launcher reopens.
                console.error('[music-bar] now-playing read failed', error)
            }
            if (current === generation) timer = setTimeout(() => void poll(current), POLL_MS)
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
        // A reload while the launcher is open (e.g. a hot update in dev) would
        // otherwise wait for the next show before polling again.
        if (document.visibilityState === 'visible') void start()
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

    const pendingActions = useRef<Partial<Record<string, ReturnType<typeof setTimeout>>>>({})

    /**
     * Runs only the last of rapid calls under one key, once they stop, so
     * repeated presses of a heavy action (one that rebuilds the queue) do it
     * once. For toggles, use debouncedToggle, which also flips the UI at once.
     */
    const debounceAction = (key: string, run: () => void) => {
        clearTimeout(pendingActions.current[key])
        pendingActions.current[key] = setTimeout(() => {
            delete pendingActions.current[key]
            run()
        }, TOGGLE_DEBOUNCE_MS)
    }

    const [pressed, setPressed] = useState<PlayerControl | null>(null)
    const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    const control = (action: PlayerControl) => {
        if (!track) return
        setPressed(action)
        clearTimeout(pressTimer.current)
        pressTimer.current = setTimeout(() => setPressed(null), PRESS_FLASH_MS)
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
    // Looping an ad makes no sense, and the repeat button belongs to the song.
    const toggleLoop = () =>
        !latestTrack.current?.isAd &&
        debouncedToggle(
            'loop',
            (current) => ({ ...current, repeatMode: current.repeatMode === 'ONE' ? 'NONE' : 'ONE' }),
            (target) => window.musicBar.setLoop(target.source, target.repeatMode === 'ONE'),
            (target, next) => (next.repeatMode === 'ONE') === (target.repeatMode === 'ONE'),
        )

    /** Shows a search result on the card right away, then plays it via `run`. */
    const startSong = (song: SearchSong, run: () => Promise<void>) => {
        const before = track
        return act(
            (current) => ({
                ...current,
                title: song.title,
                artist: song.artist,
                album: '',
                artworkUrl: song.thumbnailUrl,
                isPlaying: true,
                isAd: false,
            }),
            run,
            (next) => !before || !sameSong(next, before),
        )
    }

    const playNow = (song: SearchSong) => startSong(song, () => window.musicBar.playNow(song))

    // Both radio actions rebuild the queue, so they share one debounce key:
    // the last radio request in a burst is the one that runs.

    /** A radio (YouTube's "Start mix") from a search result. */
    const startRadioFrom = (song: SearchSong) =>
        debounceAction('radio', () => void startSong(song, () => window.musicBar.startRadioFromSong(song)))

    /** A radio from the current song; it keeps playing, with a new queue after it. */
    const startRadio = () => {
        if (!track || track.isAd) return
        const { source } = track
        debounceAction(
            'radio',
            () =>
                void act(
                    (current) => current,
                    () => window.musicBar.startRadio(source),
                    () => true,
                ),
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

    return {
        state,
        stale,
        browsers,
        control,
        pressed,
        togglePlay,
        toggleLoop,
        playNow,
        startRadio,
        startRadioFrom,
        loadTab,
        loadingTab,
    }
}

export function NowPlaying({
    state,
    stale,
    control,
    togglePlay,
    toggleLoop,
    loadingTab,
    pressed,
    artwork,
}: ReturnType<typeof useNowPlaying> & { artwork: ArtworkState }) {
    if (state?.status !== 'track') {
        const [title, detail] =
            state?.status === 'error'
                ? ["Can't reach YouTube Music", describeError(state.message)]
                : state?.status === 'unloaded'
                  ? loadingTab
                      ? ['Loading YouTube Music…', 'Opening the tab for a moment']
                      : ['Your tab is inactive', 'Brave unloaded it to save memory. Press ↵ to load it.']
                  : ['Nothing playing', 'Open YouTube Music in Brave, Chrome or Helium']
        return (
            <Hero stale={stale} artwork={NO_ARTWORK} eyebrow="YouTube Music">
                <h1 className="truncate text-[26px] leading-tight font-extrabold tracking-tight">{title}</h1>
                <p className="line-clamp-2 text-sm font-medium text-subdued">{detail}</p>
            </Hero>
        )
    }

    const { track } = state
    const looping = track.repeatMode === 'ONE'
    const repeatLabel = { NONE: 'Repeat off', ALL: 'Repeating all', ONE: 'Looping this song' }[track.repeatMode]
    return (
        <Hero
            stale={stale}
            artwork={artwork}
            eyebrow={track.isAd ? (track.isPlaying ? 'Ad playing' : 'Ad paused') : track.isPlaying ? 'Now playing' : 'Paused'}
            controls={
                <div className="flex items-center gap-1.5">
                    <IconButton
                        label={
                            track.isAd
                                ? 'Not available during ads'
                                : `${repeatLabel} · ${looping ? 'stop looping' : 'loop this song'} (⌘O)`
                        }
                        onClick={toggleLoop}
                        active={track.repeatMode !== 'NONE'}
                        disabled={track.isAd}
                    >
                        <RepeatIcon mode={track.repeatMode} />
                    </IconButton>
                    <IconButton label="Previous (⌘H)" onClick={() => control('previous')} pressed={pressed === 'previous'} active>
                        <SkipIcon direction="previous" />
                    </IconButton>
                    <button
                        type="button"
                        aria-label={track.isPlaying ? 'Pause' : 'Play'}
                        title={track.isPlaying ? 'Pause' : 'Play'}
                        tabIndex={-1}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={togglePlay}
                        className="glass flex size-12 items-center justify-center rounded-full text-white transition hover:scale-105 active:scale-95"
                    >
                        {track.isPlaying ? (
                            <Pause className="size-5" fill="currentColor" strokeWidth={0} />
                        ) : (
                            <Play className="ml-0.5 size-5" fill="currentColor" strokeWidth={0} />
                        )}
                    </button>
                    <IconButton label="Next (⌘L)" onClick={() => control('next')} pressed={pressed === 'next'} active>
                        <SkipIcon direction="next" />
                    </IconButton>
                </div>
            }
            // Ads have no usable position in the player bar, so their row is a placeholder.
            footer={track.isAd ? <AdProgress /> : <Progress track={track} />}
        >
            <h1 className="truncate text-[26px] leading-tight font-extrabold tracking-tight">{track.title}</h1>
            <p className="truncate text-sm font-semibold text-subdued">{track.artist}</p>
            {track.isAsleep && !track.isPlaying && (
                <p className="truncate text-xs font-medium text-subdued">
                    <span className="mr-1.5 inline-block size-1.5 rounded-full bg-accent align-middle" />
                    Brave hasn't loaded this tab yet · Play opens it for a moment
                </p>
            )}
        </Hero>
    )
}

/** The now-playing block: artwork, a small label, title lines, controls and progress. */
function Hero({
    artwork,
    eyebrow,
    stale,
    controls,
    footer,
    children,
}: {
    artwork: ArtworkState
    eyebrow: string
    /** Dims the block while it shows state from before the launcher opened. */
    stale: boolean
    controls?: ReactNode
    footer?: ReactNode
    children: ReactNode
}) {
    return (
        <section className={`flex flex-col gap-3 px-5 pt-4 pb-4 transition-opacity duration-150 ${stale ? 'opacity-50' : ''}`}>
            <div className="flex items-end gap-4">
                <Artwork artwork={artwork} />
                <div className="flex min-w-0 flex-1 flex-col gap-1 pb-1">
                    <span className="text-xs font-bold text-white/80">{eyebrow}</span>
                    {children}
                </div>
                {controls && <div className="shrink-0 pb-1">{controls}</div>}
            </div>
            {footer}
        </section>
    )
}

function Artwork({ artwork }: { artwork: ArtworkState }) {
    const frame = 'size-[92px] shrink-0 rounded-md shadow-[0_8px_28px_rgba(0,0,0,0.55)]'
    if (artwork.src) {
        return <img src={artwork.src} alt="" className={`${frame} object-cover`} />
    }
    // A plain tile while the art loads; the note only when there's none to show.
    if (artwork.status === 'loading') return <div className={`${frame} bg-highlight`} />
    return (
        <div className={`${frame} flex items-center justify-center bg-gradient-to-br from-accent to-[#7a0019]`}>
            <Music2 className="size-9 text-white" strokeWidth={2.25} />
        </div>
    )
}

function IconButton({
    label,
    onClick,
    active,
    pressed,
    disabled,
    children,
}: {
    label: string
    onClick: () => void
    active?: boolean
    /** Shows the button as pressed, for a keyboard shortcut that triggers it. */
    pressed?: boolean
    disabled?: boolean
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
            // Active is white rather than red: the header takes the artwork's
            // color, and red on a red cover disappears.
            disabled={disabled}
            className={`flex size-9 items-center justify-center rounded-full transition duration-100 ${disabled ? 'cursor-default text-subdued opacity-40' : `hover:bg-white/10 active:scale-90 ${pressed ? 'scale-90 bg-white/10 text-white' : active ? 'text-white' : 'text-subdued hover:text-white'}`}`}
        >
            {children}
        </button>
    )
}

/** YouTube's skip icons: Material Design's skip_previous / skip_next, solid with sharp corners. */
function SkipIcon({ direction }: { direction: PlayerControl }) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-6" aria-hidden="true">
            <path d={direction === 'previous' ? 'M6 6h2v12H6zm3.5 6 8.5 6V6z' : 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z'} />
        </svg>
    )
}

/**
 * YouTube Music's repeat icon for each mode: plain when off, a dot in the
 * middle for the whole queue, a 1 for the current song. Paths are lucide's
 * Repeat and Repeat1; lucide has no dotted variant.
 */
function RepeatIcon({ mode }: { mode: RepeatMode }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-[19px]"
            aria-hidden="true"
        >
            <path d="m17 2 4 4-4 4" />
            <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
            <path d="m7 22-4-4 4-4" />
            <path d="M21 13v1a4 4 0 0 1-4 4H3" />
            {mode === 'ALL' && <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />}
            {mode === 'ONE' && <path d="M11 10h1v4" />}
        </svg>
    )
}

/** The progress row during an ad: an empty bar and zeroed times. */
function AdProgress() {
    return (
        <div className="flex items-center gap-2.5 text-[11px] font-medium text-subdued tabular-nums">
            <span className="w-9 text-right">0:00</span>
            <div className="h-1 flex-1 rounded-full bg-white/20" />
            <span className="w-9">0:00</span>
        </div>
    )
}

// A read within this many seconds of where the bar already is counts as
// rounding: YouTube Music keeps the position in whole seconds, so snapping to
// every read would jerk the bar back by up to a second.
const PROGRESS_DRIFT_TOLERANCE_S = 1.5

/**
 * Song progress, drawn every frame. Each read re-anchors a local clock only
 * when it disagrees by more than rounding (a seek, a new song, a pause);
 * otherwise the bar keeps gliding from where it is.
 */
function Progress({ track }: { track: Track }) {
    const fill = useRef<HTMLDivElement>(null)
    const elapsedLabel = useRef<HTMLSpanElement>(null)
    // The position at a moment in time; the bar extrapolates from it while playing.
    const anchor = useRef<{ position: number; at: number; song: string } | null>(null)

    const song = `${track.title}\u0000${track.artist}`
    const now = Date.now()
    const reported = track.position + (track.isPlaying ? Math.max(0, (now - track.readAt) / 1000) : 0)
    const current = anchor.current
    const predicted = current ? current.position + (now - current.at) / 1000 : 0
    if (
        !current ||
        current.song !== song ||
        !track.isPlaying ||
        Math.abs(reported - predicted) > PROGRESS_DRIFT_TOLERANCE_S
    ) {
        anchor.current = { position: reported, at: now, song }
    }

    const duration = track.duration
    const playing = track.isPlaying

    useEffect(() => {
        let frame = 0
        let shownSecond = -1
        const draw = () => {
            const base = anchor.current
            if (!base) return
            const raw = base.position + (playing ? (Date.now() - base.at) / 1000 : 0)
            const position = duration ? Math.min(raw, duration) : raw
            if (fill.current) fill.current.style.width = `${duration ? (position / duration) * 100 : 0}%`
            const second = Math.floor(position)
            if (second !== shownSecond && elapsedLabel.current) {
                shownSecond = second
                elapsedLabel.current.textContent = formatTime(position)
            }
            if (playing) frame = requestAnimationFrame(draw)
        }
        draw()
        return () => cancelAnimationFrame(frame)
    }, [track, playing, duration])

    return (
        <div className="flex items-center gap-2.5 text-[11px] font-medium text-subdued tabular-nums">
            <span ref={elapsedLabel} className="w-9 text-right" />
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/20">
                <div ref={fill} className="h-full rounded-full bg-white" />
            </div>
            <span className="w-9">{duration ? formatTime(duration) : '–:––'}</span>
        </div>
    )
}

function formatTime(seconds: number): string {
    const whole = Math.floor(seconds)
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

// Deep red for the header when there's no artwork, or its color can't be read.
const FALLBACK_COLOR = 'rgb(110, 14, 30)'

export interface ArtworkState {
    /** The image to show once it has loaded; null while loading or failed. */
    src: string | null
    status: 'none' | 'loading' | 'loaded' | 'failed'
    /** Header color: the artwork's dominant color, kept from the previous song until the new art loads. */
    color: string
}

const NO_ARTWORK: ArtworkState = { src: null, status: 'none', color: FALLBACK_COLOR }

/**
 * Loads the artwork once for both the image and the header color. The main
 * process downloads it (see artwork.ts for why, and for the retries), so the
 * image arrives as a data: URL whose pixels can be read for the color.
 */
export function useArtwork(url: string | null): ArtworkState {
    const [loaded, setLoaded] = useState<{ url: string; src: string; color: string } | null>(null)
    const [failedUrl, setFailedUrl] = useState<string | null>(null)

    useEffect(() => {
        if (!url) return
        let cancelled = false
        void (async () => {
            try {
                // Main downloads it (with retries) and hands back a data: URL.
                const src = await window.musicBar.fetchArtwork(url)
                const image = new Image()
                image.src = src
                await image.decode()
                if (!cancelled) setLoaded({ url, src, color: dominantColor(image) })
            } catch (error) {
                console.warn(`[music-bar] artwork failed: ${url}`, error)
                if (!cancelled) setFailedUrl(url)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [url])

    if (!url) return NO_ARTWORK
    if (loaded?.url === url) return { src: loaded.src, status: 'loaded', color: loaded.color }
    // Failed: the fallback, not the previous song's color, which no longer matches.
    if (failedUrl === url) return { src: null, status: 'failed', color: FALLBACK_COLOR }
    return { src: null, status: 'loading', color: loaded?.color ?? FALLBACK_COLOR }
}

/**
 * The image's dominant color, darkened enough for white text on top.
 * Saturated pixels count for more, so a colorful cover on a grey background
 * still reads as its color.
 */
function dominantColor(image: HTMLImageElement): string {
    try {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 24
        const context = canvas.getContext('2d', { willReadFrequently: true })!
        context.drawImage(image, 0, 0, 24, 24)
        const pixels = context.getImageData(0, 0, 24, 24).data
        let r = 0
        let g = 0
        let b = 0
        let total = 0
        for (let i = 0; i < pixels.length; i += 4) {
            const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2])
            const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2])
            const weight = 0.1 + (max === 0 ? 0 : (max - min) / max) * (max / 255)
            r += pixels[i] * weight
            g += pixels[i + 1] * weight
            b += pixels[i + 2] * weight
            total += weight
        }
        // Scale so the brightest channel lands around 150: rich, but dark.
        const scale = 150 / Math.max(r / total, g / total, b / total, 1)
        const channel = (value: number) => Math.round(Math.min(255, (value / total) * scale))
        return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`
    } catch {
        return FALLBACK_COLOR
    }
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
