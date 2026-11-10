import { useEffect, useState, type ReactNode } from 'react'
import type { SpotifyInfo, SpotifyState } from '../shared/ipc'
import { errorMessage } from './now-playing'
import { CopyButton, Keys, PrimaryButton, SmallButton, Switch } from './setup'

// Spotify in settings and setup: the app (read and controlled through MPRIS
// on Linux, AppleScript on macOS) and, optionally, the user's Spotify
// account for search and the queue (spotify-account.ts).

const POLL_MS = 2000

/** Spotify's state, kept current while shown. */
export function useSpotify(): [SpotifyInfo | null, () => Promise<void>] {
    const [info, setInfo] = useState<SpotifyInfo | null>(null)
    const refresh = async () => setInfo(await window.musicBar.getSpotify())
    useEffect(() => {
        let stopped = false
        const poll = async () => {
            if (stopped) return
            await refresh().catch(() => {})
            if (!stopped) setTimeout(() => void poll(), POLL_MS)
        }
        void poll()
        return () => {
            stopped = true
        }
    }, [])
    return [info, refresh]
}

/** Spotify's mark: the three bars on its green circle. */
export function SpotifyIcon() {
    return (
        <svg viewBox="0 0 24 24" className="size-9 shrink-0" aria-hidden="true">
            <circle cx="12" cy="12" r="12" fill="#1ed760" />
            <g fill="none" stroke="#000" strokeLinecap="round">
                <path d="M6.2 9.2c3.9-1.2 8.3-.8 11.6 1.1" strokeWidth="1.9" />
                <path d="M6.8 12.5c3.2-.9 6.6-.6 9.4.9" strokeWidth="1.6" />
                <path d="M7.4 15.5c2.5-.6 5-.4 7.2.7" strokeWidth="1.3" />
            </g>
        </svg>
    )
}

const STATE_LABELS: Record<SpotifyState, string> = {
    ready: 'Ready',
    'not-running': 'Not open',
    'needs-permission': 'Needs permission',
    'not-installed': 'Not installed',
    error: 'Error',
}

export function SpotifyStatusPill({ state }: { state: SpotifyState }) {
    return (
        <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                state === 'ready' ? 'bg-white/10 text-white' : 'bg-white/[0.06] text-subdued'
            }`}
        >
            {STATE_LABELS[state]}
        </span>
    )
}

/** What to do about the app's state, if anything. */
export function SpotifyAppHint({ state }: { state: SpotifyState }) {
    if (state === 'ready') return null
    return (
        <div className="flex flex-col items-start gap-2 pl-12 text-[13px] leading-snug font-medium text-subdued">
            {state === 'not-running' && (
                <>
                    <p>Open Spotify; Music Bar follows it from then on.</p>
                    <SmallButton onClick={() => void window.musicBar.openSpotify()}>Open Spotify</SmallButton>
                </>
            )}
            {state === 'needs-permission' && (
                <>
                    <p>Turn on Spotify under Music Bar in Privacy & Security → Automation.</p>
                    <SmallButton onClick={() => void window.musicBar.openAutomationSettings()}>Open System Settings</SmallButton>
                </>
            )}
            {state === 'not-installed' && <p>Install the Spotify app to use it with Music Bar.</p>}
            {state === 'error' && <p>Music Bar couldn't reach Spotify. Quit and reopen it.</p>}
        </div>
    )
}

export function SpotifySection() {
    const [info, refresh] = useSpotify()
    if (!info) return null
    const toggle = async () => {
        await window.musicBar.setSpotifyEnabled(!info.enabled)
        await refresh()
    }
    return (
        <>
            <header className="flex flex-col gap-1.5">
                <h1 className="text-[22px] leading-tight font-extrabold tracking-tight">Spotify</h1>
                <p className="text-sm font-medium text-subdued">
                    Control the Spotify app as well. Music Bar shows whichever is playing.
                </p>
            </header>
            <section className="mt-6 flex flex-col gap-3 rounded-xl bg-elevated p-4">
                <div className="flex items-center gap-3">
                    <SpotifyIcon />
                    <span className="flex-1 text-[15px] font-bold">Spotify app</span>
                    {info.enabled && <SpotifyStatusPill state={info.state} />}
                    <Switch
                        label="Use Spotify"
                        on={info.enabled}
                        disabled={!info.enabled && info.state === 'not-installed'}
                        onToggle={() => void toggle()}
                    />
                </div>
                {info.enabled && <SpotifyAppHint state={info.state} />}
                {info.enabled && !info.canLoop && (
                    <p className="pl-12 text-[13px] font-medium text-subdued">
                        On macOS, Spotify can't loop one song from Music Bar.
                    </p>
                )}
            </section>
            {info.enabled && <SpotifyAccount info={info} refresh={refresh} />}
        </>
    )
}

/**
 * Search and the queue need the user's own app in Spotify's developer
 * dashboard: Music Bar has no servers of its own. Making one takes a minute.
 */
function SpotifyAccount({ info, refresh }: { info: SpotifyInfo; refresh: () => Promise<void> }) {
    const [clientId, setClientId] = useState(info.account.clientId ?? '')
    const [connecting, setConnecting] = useState(false)
    const [problem, setProblem] = useState<string | null>(null)

    const connect = async () => {
        setConnecting(true)
        setProblem(null)
        try {
            await window.musicBar.connectSpotify(clientId)
        } catch (error) {
            setProblem(errorMessage(error))
        } finally {
            setConnecting(false)
            await refresh()
        }
    }

    const disconnect = async () => {
        await window.musicBar.disconnectSpotify()
        await refresh()
    }

    return (
        <section className="mt-3 flex flex-col gap-3 rounded-xl bg-elevated p-4">
            <div className="flex items-center gap-3">
                <div className="flex flex-1 flex-col gap-1">
                    <span className="text-[15px] font-bold">Search and queue</span>
                    <span className="text-[13px] font-medium text-subdued">
                        {info.account.connectedAs
                            ? `Connected as ${info.account.connectedAs}.`
                            : 'Connect your Spotify account to search Spotify and queue songs from Music Bar.'}
                    </span>
                </div>
                {info.account.connectedAs && <SmallButton onClick={() => void disconnect()}>Disconnect</SmallButton>}
            </div>
            {!info.account.connectedAs && (
                <ol className="flex flex-col gap-3 text-[13px] leading-snug font-medium text-subdued">
                    <StepItem number={1}>
                        <p>
                            In Spotify’s developer dashboard, create an app. Any name works; tick <Keys>Web API</Keys>,
                            and add this Redirect URI:
                        </p>
                        <span className="flex items-center gap-2">
                            <code className="font-mono text-xs text-white">{info.account.redirectUri}</code>
                            <CopyButton text={info.account.redirectUri} />
                        </span>
                        <SmallButton onClick={() => void window.musicBar.openSpotifyDashboard()}>Open Dashboard</SmallButton>
                    </StepItem>
                    <StepItem number={2}>
                        <p>Copy the app’s Client ID here, then sign in to Spotify in your browser.</p>
                        <span className="flex w-full items-center gap-2">
                            <input
                                value={clientId}
                                onChange={(event) => setClientId(event.target.value)}
                                placeholder="Client ID"
                                spellCheck={false}
                                className="h-9 min-w-0 flex-1 rounded-lg bg-black/30 px-3 font-mono text-xs text-white ring-1 ring-white/10 outline-none focus:ring-white/30"
                            />
                            <PrimaryButton disabled={connecting || clientId.trim().length === 0} onClick={() => void connect()}>
                                {connecting ? 'Waiting for Spotify…' : 'Connect'}
                            </PrimaryButton>
                        </span>
                        {problem && <p className="text-white">{problem}</p>}
                    </StepItem>
                </ol>
            )}
            <p className="text-xs font-medium text-faint">
                Playing a song needs no account. Adding to the queue needs Spotify Premium.
            </p>
        </section>
    )
}

function StepItem({ number, children }: { number: number; children: ReactNode }) {
    return (
        <li className="flex gap-3">
            <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ring-2 ring-white/25 ring-inset">
                {number}
            </span>
            <div className="flex min-w-0 flex-1 flex-col items-start gap-2">{children}</div>
        </li>
    )
}
