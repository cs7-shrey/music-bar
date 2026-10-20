import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Music2, Pause, Play, Repeat1, SkipBack, SkipForward } from 'lucide-react'
import type { NowPlaying as NowPlayingState, PlayerControl, SearchSong, Track } from '../shared/ipc'

const POLL_MS = 2000
// YouTube Music needs a moment to swap mediaSession metadata after a control.
const SETTLE_MS = 400
// Loading a new song takes longer than pressing a player button.
const PLAY_SETTLE_MS = 1200
// Rapid presses of play/pause or loop only flip the UI; the page gets the
// final state once the presses stop.
const TOGGLE_DEBOUNCE_MS = 300

type Toggle = 'play' | 'loop'

/** Polls the current YouTube Music track while the launcher is visible. */
export function useNowPlaying() {
    const [state, setState] = useState<NowPlayingState | null>(null)
    // Bumped on every user action. A read that started before the latest
    // action carries stale state and would undo the optimistic update.
    const actionSeq = useRef(0)
    const actionsInFlight = useRef(0)
    const toggleTimers = useRef<Partial<Record<Toggle, ReturnType<typeof setTimeout>>>>({})
    // The track as last rendered, including optimistic flips; debounced
    // toggles read their final target from it.
    const latestTrack = useRef<Track | null>(null)

    const read = useCallback(async () => {
        const seq = actionSeq.current
        const next = await window.musicBar.getNowPlaying()
        const isFresh = seq === actionSeq.current && actionsInFlight.current === 0
        return isFresh ? next : null
    }, [])

    useEffect(() => {
        // Bumped on every show/hide so a slow in-flight poll from an earlier
        // show cannot start a second loop.
        let generation = 0
        let timer: ReturnType<typeof setTimeout> | undefined

        const poll = async (current: number) => {
            const next = await read()
            if (current !== generation) return
            if (next) setState(next)
            timer = setTimeout(() => void poll(current), POLL_MS)
        }
        const stop = () => {
            generation++
            clearTimeout(timer)
        }
        const start = () => {
            stop()
            void poll(generation)
        }

        const offShown = window.musicBar.onShown(start)
        const offHidden = window.musicBar.onHidden(stop)
        return () => {
            stop()
            offShown()
            offHidden()
        }
    }, [read])

    const applyOptimistic = (optimistic: (track: Track) => Track) => {
        actionSeq.current++
        setState((current) =>
            current?.status === 'track' ? { ...current, track: optimistic(current.track) } : current,
        )
    }

    /** Runs an action, then re-reads the real state once the page settles. */
    const runAction = async (run: () => Promise<void>, settleMs: number) => {
        try {
            await run()
        } catch (error) {
            console.error('[music-bar] action failed', error)
        } finally {
            actionsInFlight.current--
        }
        setTimeout(async () => {
            const next = await read()
            if (next) setState(next)
        }, settleMs)
    }

    /** Applies an optimistic update and runs the action right away. */
    const act = async (optimistic: (track: Track) => Track, run: () => Promise<void>, settleMs = SETTLE_MS) => {
        applyOptimistic(optimistic)
        actionsInFlight.current++
        await runAction(run, settleMs)
    }

    /**
     * Flips the UI now and sends the final state once presses stop, so
     * pause-then-resume in quick succession sends nothing the page notices.
     * The pending toggle counts as in flight, which keeps polls from
     * overwriting the optimistic state meanwhile.
     */
    const debouncedToggle = (key: Toggle, flip: (track: Track) => Track, send: (track: Track) => Promise<void>) => {
        if (!latestTrack.current) return
        applyOptimistic(flip)
        const pending = toggleTimers.current[key]
        if (pending) clearTimeout(pending)
        else actionsInFlight.current++
        toggleTimers.current[key] = setTimeout(() => {
            delete toggleTimers.current[key]
            const target = latestTrack.current
            void runAction(() => (target ? send(target) : Promise.resolve()), SETTLE_MS)
        }, TOGGLE_DEBOUNCE_MS)
    }

    const track = state?.status === 'track' ? state.track : null
    latestTrack.current = track

    const control = (action: PlayerControl) => {
        if (!track) return
        void act(
            (current) => current,
            () => window.musicBar.control(track.source, action),
        )
    }

    const togglePlay = () =>
        debouncedToggle(
            'play',
            (current) => ({ ...current, isPlaying: !current.isPlaying }),
            (target) => window.musicBar.setPlaying(target.source, target.isPlaying),
        )

    // Turning the loop off restores the previous mode, which only the page
    // knows; 'NONE' is a placeholder until the re-read lands.
    const toggleLoop = () =>
        debouncedToggle(
            'loop',
            (current) => ({ ...current, repeatMode: current.repeatMode === 'ONE' ? 'NONE' : 'ONE' }),
            (target) => window.musicBar.setLoop(target.source, target.repeatMode === 'ONE'),
        )

    const playNow = (song: SearchSong) =>
        act(
            (current) => ({
                ...current,
                title: song.title,
                artist: song.artist,
                album: '',
                artworkUrl: song.thumbnailUrl,
                isPlaying: true,
            }),
            () => window.musicBar.playNow(song),
            PLAY_SETTLE_MS,
        )

    return { state, control, togglePlay, toggleLoop, playNow }
}

export function NowPlaying({ state, control, togglePlay, toggleLoop }: ReturnType<typeof useNowPlaying>) {
    if (state?.status !== 'track') {
        return (
            <Card artwork={null}>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold">
                        {state?.status === 'error' ? "Can't reach YouTube Music" : 'Nothing playing'}
                    </div>
                    <div className="line-clamp-2 text-[13px] text-neutral-400">
                        {state?.status === 'error'
                            ? describeError(state.message)
                            : 'Open YouTube Music in Brave, Chrome or Helium'}
                    </div>
                </div>
            </Card>
        )
    }

    const { track } = state
    return (
        <Card artwork={track.artworkUrl}>
            <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{track.title}</div>
                <div className="truncate text-[13px] text-neutral-400">{track.artist}</div>
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

function Card({ artwork: artworkUrl, children }: { artwork: string | null; children: ReactNode }) {
    // A failed load falls back to the placeholder instead of a broken image.
    // Keyed by URL, so the next song gets a fresh attempt.
    const [failedUrl, setFailedUrl] = useState<string | null>(null)
    const artwork = artworkUrl !== failedUrl ? artworkUrl : null
    const onError = () => setFailedUrl(artworkUrl)

    return (
        <div className="relative mx-2 mt-2 shrink-0 overflow-hidden rounded-xl bg-white/[0.04]">
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
    if (/Not authorized to send Apple events/i.test(message)) {
        return 'Allow Music Bar to control your browser in System Settings → Privacy & Security → Automation.'
    }
    return message
}
