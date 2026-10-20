import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Music2, Pause, Play, Repeat1, SkipBack, SkipForward } from 'lucide-react'
import type { NowPlaying as NowPlayingState, PlayerControl, Track, TrackSource } from '../shared/ipc'

const POLL_MS = 2000
// YouTube Music needs a moment to swap mediaSession metadata after a control.
const SETTLE_MS = 400

/** Polls the current YouTube Music track while the launcher is visible. */
export function useNowPlaying() {
    const [state, setState] = useState<NowPlayingState | null>(null)
    // Bumped on every user action. A read that started before the latest
    // action carries stale state and would undo the optimistic update.
    const actionSeq = useRef(0)
    const actionsInFlight = useRef(0)

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

    /** Applies an optimistic update, runs the action, then re-reads the real state. */
    const act = async (optimistic: (track: Track) => Track, run: (source: TrackSource) => Promise<void>) => {
        if (state?.status !== 'track') return
        actionSeq.current++
        actionsInFlight.current++
        setState({ ...state, track: optimistic(state.track) })
        try {
            await run(state.track.source)
        } finally {
            actionsInFlight.current--
        }
        setTimeout(async () => {
            const next = await read()
            if (next) setState(next)
        }, SETTLE_MS)
    }

    const control = (action: PlayerControl) =>
        act(
            (track) => (action === 'play-pause' ? { ...track, isPlaying: !track.isPlaying } : track),
            (source) => window.musicBar.control(source, action),
        )

    // Turning the loop off restores the previous mode, which only the page
    // knows; 'NONE' is a placeholder until the re-read lands.
    const setLoop = (enabled: boolean) =>
        act(
            (track) => ({ ...track, repeatMode: enabled ? 'ONE' : 'NONE' }),
            (source) => window.musicBar.setLoop(source, enabled),
        )

    return { state, control, setLoop }
}

export function NowPlaying({ state, control, setLoop }: ReturnType<typeof useNowPlaying>) {
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
                    label={track.repeatMode === 'ONE' ? 'Stop looping' : 'Loop this song'}
                    onClick={() => void setLoop(track.repeatMode !== 'ONE')}
                    active={track.repeatMode === 'ONE'}
                >
                    <Repeat1 className="size-[18px]" />
                </ControlButton>
                <ControlButton label="Previous" onClick={() => void control('previous')}>
                    <SkipBack className="size-[18px]" fill="currentColor" />
                </ControlButton>
                <ControlButton label={track.isPlaying ? 'Pause' : 'Play'} onClick={() => void control('play-pause')} large>
                    {track.isPlaying ? (
                        <Pause className="size-6" fill="currentColor" strokeWidth={0} />
                    ) : (
                        <Play className="size-6" fill="currentColor" strokeWidth={0} />
                    )}
                </ControlButton>
                <ControlButton label="Next" onClick={() => void control('next')}>
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
