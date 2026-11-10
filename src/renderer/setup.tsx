import { useEffect, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import type { BrowserName, BrowserSetupState, InstalledBrowser } from '../shared/ipc'
import { BROWSER_NAMES } from './now-playing'
import markUrl from '../../assets/mark.svg'
import { isMac, isWayland, keyCaps, keys, SUPPORTED_BROWSERS, TOGGLE_COMMAND, TRAY } from './platform'

// The setup window: pick the browsers Music Bar may use, then walk each one
// through opening it, allowing Automation, and turning on JavaScript from
// Apple Events, with live checks (on Linux: opening it, adding the Music Bar
// extension, and allowing it user scripts). Last, it asks for ⌘⇧Space, and
// stays on that screen until Music Bar is opened with it (main closes the
// window). On Wayland, that's a key the user binds to `music-bar --toggle`.

// Pause between rounds of checks.
const CHECK_INTERVAL_MS = 1500
// A check this slow is waiting on macOS's permission prompt.
const PROMPT_WAIT_MS = 1200

export interface BrowserCheck {
    state: BrowserSetupState | 'failed' | null
    /** When the check in flight started; null when none is. */
    since: number | null
}

export const isReady = (state: BrowserCheck['state']) => state === 'connected' || state === 'no-tab'
// Not yet allowed (or not known to be), so a check may raise macOS's
// permission prompt. Once allowed, a slow check is just slow.
const mayPrompt = (state: BrowserCheck['state']) =>
    state === null || state === 'not-running' || state === 'needs-permission'
// A slow check of a browser that hasn't been allowed yet is sitting on
// macOS's permission prompt.
export const isPrompting = (check: BrowserCheck) =>
    check.since !== null && Date.now() - check.since > PROMPT_WAIT_MS && mayPrompt(check.state)

export default function Setup() {
    const [installed, setInstalled] = useState<InstalledBrowser[] | null>(null)
    const [chosen, setChosen] = useState<BrowserName[]>([])
    const [step, setStep] = useState<'choose' | 'connect' | 'ready'>('choose')
    // On unless turned off here; null where the app can't open at login (development).
    const [openAtLogin, setOpenAtLogin] = useState<boolean | null>(null)
    // Checks run only on the connect step; choosing a browser asks nothing yet.
    const checks = useBrowserChecks(step === 'connect' ? chosen : [])
    // Music Bar works once one browser is ready; the rest can wait.
    const anyReady = chosen.some((browser) => isReady(checks[browser]?.state ?? null))

    useEffect(() => {
        void window.musicBar.getSetup().then((info) => {
            setInstalled(info.installed)
            const available = info.installed.map((item) => item.browser)
            // A single browser needs no choosing.
            setChosen(info.chosen?.filter((b) => available.includes(b)) ?? (available.length === 1 ? available : []))
            if (info.awaitingShortcut) setStep('ready')
        })
        void window.musicBar.getOpenAtLogin().then((info) => setOpenAtLogin(info.available ? true : null))
    }, [])

    const toggle = (browser: BrowserName) =>
        setChosen((current) => (current.includes(browser) ? current.filter((b) => b !== browser) : [...current, browser]))

    const next = async () => {
        // Kept in the order they're listed, not the order they were clicked.
        const ordered = (installed ?? []).map((item) => item.browser).filter((b) => chosen.includes(b))
        await window.musicBar.setBrowsers(ordered)
        if (openAtLogin !== null) await window.musicBar.setOpenAtLogin(openAtLogin)
        setChosen(ordered)
        setStep('connect')
    }

    const finish = () => {
        window.musicBar.finishSetup()
        setStep('ready')
    }

    return (
        <div className="flex h-full flex-col bg-base text-white">
            {/* Room for the traffic lights, and something to drag the window by.
                Other platforms have a title bar of their own. */}
            <div className={`${isMac ? 'h-11' : 'h-7'} shrink-0 [-webkit-app-region:drag]`} />
            <div className="flex min-h-0 flex-1 flex-col px-9 pb-8">
                <header className="flex flex-col items-start gap-4">
                    <img src={markUrl} alt="" className="size-14" draggable={false} />
                    <div className="flex flex-col gap-1.5">
                        <h1 className="text-[26px] leading-tight font-extrabold tracking-tight">
                            {step === 'choose'
                                ? 'Welcome to Music Bar'
                                : step === 'connect'
                                  ? 'Connect your browsers'
                                  : 'You’re all set'}
                        </h1>
                        <p className="text-sm font-medium text-subdued">
                            {step === 'choose' ? (
                                <>
                                    Control YouTube Music from anywhere with <LauncherKeys />. Choose the browsers you play
                                    it in.
                                </>
                            ) : step === 'connect' ? (
                                'Music Bar controls YouTube Music through your browser. Each one needs a one-time setup.'
                            ) : (
                                isWayland ? (
                                    'Bind a key to Music Bar in your desktop’s keyboard settings, then press it.'
                                ) : (
                                    <>
                                        Press <Keys>{keys('⌘⇧Space')}</Keys> to open Music Bar. It works from any app.
                                    </>
                                )
                            )}
                        </p>
                    </div>
                </header>

                {step === 'choose' ? (
                    <>
                        <ChooseBrowsers installed={installed} chosen={chosen} onToggle={toggle} />
                        {openAtLogin !== null && !!installed?.length && (
                            <div className="mt-4 flex shrink-0 items-center gap-4 rounded-xl bg-elevated px-4 py-3">
                                <div className="flex flex-1 flex-col gap-0.5">
                                    <span className="text-sm font-bold">Open at login</span>
                                    <span className="text-xs font-medium text-subdued">
                                        Starts quietly in the {TRAY}, so <LauncherKeys /> always works.
                                    </span>
                                </div>
                                <Switch
                                    label="Open at login"
                                    on={openAtLogin}
                                    onToggle={() => setOpenAtLogin(!openAtLogin)}
                                />
                            </div>
                        )}
                    </>
                ) : step === 'connect' ? (
                    <ConnectBrowsers browsers={chosen} icons={installed ?? []} checks={checks} />
                ) : (
                    <ShortcutKeys />
                )}

                <footer className="mt-6 flex shrink-0 items-center justify-between gap-4">
                    {step === 'choose' ? (
                        <>
                            <span className="text-xs font-medium text-faint">You can change this later from the {TRAY}.</span>
                            <PrimaryButton disabled={chosen.length === 0} onClick={() => void next()}>
                                Continue
                            </PrimaryButton>
                        </>
                    ) : step === 'ready' ? (
                        <>
                            <button
                                type="button"
                                onClick={() => setStep('connect')}
                                className="rounded-full px-3 py-2 text-sm font-bold text-subdued transition hover:text-white focus-visible:outline-2 focus-visible:outline-white"
                            >
                                Back
                            </button>
                            <span className="text-xs font-medium text-faint">Try it now.</span>
                        </>
                    ) : (
                        <>
                            <button
                                type="button"
                                onClick={() => setStep('choose')}
                                className="rounded-full px-3 py-2 text-sm font-bold text-subdued transition hover:text-white focus-visible:outline-2 focus-visible:outline-white"
                            >
                                Back
                            </button>
                            <span className="flex items-center gap-4">
                                {!anyReady && (
                                    <button
                                        type="button"
                                        onClick={finish}
                                        className="rounded-full px-3 py-2 text-sm font-bold text-subdued transition hover:text-white focus-visible:outline-2 focus-visible:outline-white"
                                    >
                                        Skip for now
                                    </button>
                                )}
                                <PrimaryButton disabled={!anyReady} onClick={finish}>
                                    Done
                                </PrimaryButton>
                            </span>
                        </>
                    )}
                </footer>
            </div>
        </div>
    )
}

function ChooseBrowsers({
    installed,
    chosen,
    onToggle,
}: {
    installed: InstalledBrowser[] | null
    chosen: BrowserName[]
    onToggle: (browser: BrowserName) => void
}) {
    if (installed === null) return <div className="flex-1" />
    if (installed.length === 0) {
        return (
            <p className="mt-8 flex-1 text-sm font-medium text-subdued">
                Music Bar works with {SUPPORTED_BROWSERS}. Install one of them, then open Music Bar again.
            </p>
        )
    }
    return (
        <div className="mt-8 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {installed.map(({ browser, icon }) => {
                const on = chosen.includes(browser)
                return (
                    <button
                        key={browser}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onToggle(browser)}
                        className={`flex h-16 shrink-0 items-center gap-4 rounded-xl px-4 text-left transition focus-visible:outline-2 focus-visible:outline-white ${
                            on ? 'bg-highlight ring-1 ring-white/15' : 'bg-elevated hover:bg-highlight'
                        }`}
                    >
                        <BrowserIcon icon={icon} />
                        <span className="flex-1 text-[15px] font-bold">{BROWSER_NAMES[browser]}</span>
                        <span
                            className={`flex size-6 items-center justify-center rounded-full transition ${
                                on ? 'bg-accent text-white' : 'ring-2 ring-white/25 ring-inset'
                            }`}
                        >
                            {on && <Check className="size-3.5" strokeWidth={3.5} />}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}

/**
 * Checks the chosen browsers one after another, round after round. One at a
 * time, so macOS's permission prompts come one by one too: a check sits on
 * its browser's prompt until the user answers it.
 */
export function useBrowserChecks(browsers: BrowserName[]): Record<string, BrowserCheck> {
    const [checks, setChecks] = useState<Record<string, BrowserCheck>>({})
    const key = browsers.join('|')

    useEffect(() => {
        let stopped = false
        const set = (browser: BrowserName, check: Partial<BrowserCheck>) =>
            setChecks((current) => ({
                ...current,
                [browser]: { ...(current[browser] ?? { state: null, since: null }), ...check },
            }))
        // Each browser's last result, for telling whether a check could have prompted.
        const last: Partial<Record<BrowserName, BrowserCheck['state']>> = {}
        const run = async () => {
            while (!stopped) {
                for (const browser of browsers) {
                    if (stopped) return
                    const started = Date.now()
                    set(browser, { since: started })
                    let state: BrowserCheck['state']
                    try {
                        state = await window.musicBar.checkBrowser(browser)
                    } catch {
                        state = 'failed'
                    }
                    set(browser, { state, since: null })
                    // The check sat on macOS's permission prompt, and macOS
                    // doesn't hand focus back once it's answered.
                    if (Date.now() - started > PROMPT_WAIT_MS && mayPrompt(last[browser] ?? null)) {
                        window.musicBar.showSetup()
                    }
                    last[browser] = state
                }
                await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS))
            }
        }
        void run()
        return () => {
            stopped = true
        }
        // Keyed on the names, not the array, so a re-render doesn't restart the loop.
    }, [key])

    // Keeps "macOS is asking" current while a check waits on a prompt.
    useTick(Object.values(checks).some((check) => check.since !== null))
    return checks
}

/** Re-renders now and then while something waits on the clock. */
function useTick(active: boolean): void {
    const [, setTick] = useState(0)
    useEffect(() => {
        if (!active) return
        const timer = setInterval(() => setTick((tick) => tick + 1), 400)
        return () => clearInterval(timer)
    }, [active])
}

function ConnectBrowsers({
    browsers,
    icons,
    checks,
}: {
    browsers: BrowserName[]
    icons: InstalledBrowser[]
    checks: Record<string, BrowserCheck>
}) {
    return (
        <div className="mt-8 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            {browsers.map((browser) => (
                <BrowserCard
                    key={browser}
                    browser={browser}
                    icon={icons.find((item) => item.browser === browser)?.icon ?? null}
                    check={checks[browser] ?? { state: null, since: null }}
                />
            ))}
        </div>
    )
}

/** The launcher's shortcut in running text; on Wayland, whatever key the user binds. */
function LauncherKeys() {
    return isWayland ? <>a key you choose</> : <Keys>{keys('⌘⇧Space')}</Keys>
}

/** ⌘⇧Space as big key caps, for the last screen; on Wayland, the command to bind a key to. */
function ShortcutKeys() {
    if (isWayland) return <BindCommand />
    return (
        <div className="flex flex-1 items-center justify-center gap-3" aria-label={isMac ? 'Command Shift Space' : 'Control Shift Space'}>
            {keyCaps(['⌘', '⇧', 'Space']).map((key) => (
                <kbd
                    key={key}
                    className={`flex h-20 items-center justify-center rounded-2xl bg-elevated font-sans text-3xl font-bold text-white shadow-[inset_0_-4px_0_rgba(0,0,0,0.4)] ring-1 ring-white/10 ring-inset ${
                        key === 'Space' ? 'w-48' : isMac ? 'w-20' : 'w-28'
                    }`}
                >
                    {key}
                </kbd>
            ))}
        </div>
    )
}

/**
 * Wayland's last screen: the command a key should run, to copy into the
 * desktop's keyboard settings (GNOME, KDE) or compositor config (Hyprland,
 * Sway). The README has examples.
 */
function BindCommand() {
    return (
        <div className="flex flex-1 flex-col justify-center gap-4">
            <p className="text-sm font-medium text-subdued">
                Wayland doesn’t let apps take a key for themselves. Make a shortcut that runs this command; Ctrl+Shift+Space
                works well:
            </p>
            <div className="flex items-center gap-3 rounded-xl bg-elevated px-4 py-3">
                <code className="flex-1 font-mono text-[15px] font-semibold text-white">{TOGGLE_COMMAND}</code>
                <CopyButton text={TOGGLE_COMMAND} />
            </div>
            <p className="text-xs font-medium text-faint">
                Hyprland and Sway can also float the launcher: its window is titled “Music Bar Launcher”.
            </p>
        </div>
    )
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
    const [copied, setCopied] = useState(false)
    useEffect(() => {
        if (!copied) return
        const timer = setTimeout(() => setCopied(false), 1500)
        return () => clearTimeout(timer)
    }, [copied])
    return (
        <SmallButton onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}>
            {copied ? 'Copied' : label}
        </SmallButton>
    )
}

type StepStatus = 'done' | 'current' | 'waiting'

function BrowserCard({ browser, icon, check }: { browser: BrowserName; icon: string | null; check: BrowserCheck }) {
    return (
        <section className="flex shrink-0 flex-col gap-3 rounded-xl bg-elevated p-4">
            <div className="flex items-center gap-3">
                <BrowserIcon icon={icon} />
                <span className="flex-1 text-[15px] font-bold">{BROWSER_NAMES[browser]}</span>
                <StatusPill check={check} />
            </div>
            <SetupSteps browser={browser} check={check} />
        </section>
    )
}

export function StatusPill({ check }: { check: BrowserCheck }) {
    const ready = isReady(check.state)
    return (
        <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                ready ? 'bg-white/10 text-white' : 'bg-white/[0.06] text-subdued'
            }`}
        >
            {ready ? 'Ready' : check.state === null ? 'Checking…' : 'Needs setup'}
        </span>
    )
}

/** The three setup steps for one browser, ticked off as its checks pass. */
export function SetupSteps({ browser, check }: { browser: BrowserName; check: BrowserCheck }) {
    return isMac ? <MacSetupSteps browser={browser} check={check} /> : <LinuxSetupSteps browser={browser} check={check} />
}

/**
 * Linux: open the browser, add the Music Bar extension (loaded unpacked
 * from the folder Music Bar keeps it in), and allow it user scripts, which
 * is how it runs Music Bar's scripts in YouTube Music tabs.
 */
function LinuxSetupSteps({ browser, check }: { browser: BrowserName; check: BrowserCheck }) {
    const name = BROWSER_NAMES[browser]
    const { state } = check
    const [folder, setFolder] = useState<string | null>(null)
    useEffect(() => {
        void window.musicBar.getExtensionFolder().then(setFolder)
    }, [])

    const opened: StepStatus = state === null ? 'waiting' : state === 'not-running' ? 'current' : 'done'
    const added: StepStatus = opened !== 'done' ? 'waiting' : state === 'needs-extension' ? 'current' : 'done'
    const allowed: StepStatus = added !== 'done' ? 'waiting' : isReady(state) ? 'done' : 'current'

    return (
        <ol className="flex flex-col gap-2.5 pl-1">
            <Step status={opened} title={`Open ${name}`}>
                <SmallButton onClick={() => void window.musicBar.openBrowser(browser)}>Open {name}</SmallButton>
            </Step>
            <Step status={added} title="Add the Music Bar extension">
                <p>
                    On {name}’s extensions page, turn on <Keys>Developer mode</Keys>, click <Keys>Load unpacked</Keys> and
                    choose this folder. In the file picker, <Keys>Ctrl+L</Keys> lets you paste it.
                </p>
                {folder && <code className="font-mono text-xs break-all text-white">{folder}</code>}
                <span className="flex flex-wrap gap-2">
                    <SmallButton onClick={() => void window.musicBar.openExtensionsPage(browser)}>
                        Open Extensions Page
                    </SmallButton>
                    {folder && <CopyButton text={folder} label="Copy Folder Path" />}
                    <SmallButton onClick={() => void window.musicBar.showExtensionFolder()}>Show Folder</SmallButton>
                </span>
            </Step>
            <Step status={allowed} title="Allow User Scripts">
                {state === 'failed' || state === 'error' ? (
                    <p>Music Bar couldn't reach {name}. Quit and reopen it, then check again.</p>
                ) : (
                    <p>
                        On the extensions page, click <Keys>Details</Keys> on Music Bar and turn on{' '}
                        <Keys>Allow User Scripts</Keys>. That lets it run Music Bar’s scripts in YouTube Music tabs, and
                        nowhere else.
                    </p>
                )}
            </Step>
        </ol>
    )
}

/** macOS: open the browser, allow Automation, allow JavaScript from Apple Events. */
function MacSetupSteps({ browser, check }: { browser: BrowserName; check: BrowserCheck }) {
    const name = BROWSER_NAMES[browser]
    const { state } = check
    const promptShowing = isPrompting(check)

    const opened: StepStatus = promptShowing
        ? 'done'
        : state === null
          ? 'waiting'
          : state === 'not-running'
            ? 'current'
            : 'done'
    const allowed: StepStatus =
        opened !== 'done' ? 'waiting' : state === 'needs-permission' || promptShowing ? 'current' : 'done'
    const scripting: StepStatus = allowed !== 'done' ? 'waiting' : isReady(state) ? 'done' : 'current'

    return (
        <ol className="flex flex-col gap-2.5 pl-1">
            <Step status={opened} title={`Open ${name}`}>
                <SmallButton onClick={() => void window.musicBar.openBrowser(browser)}>Open {name}</SmallButton>
            </Step>
            <Step status={allowed} title={`Allow Music Bar to control ${name}`}>
                {promptShowing ? (
                    <p>macOS is asking. Click Allow (or OK) in its prompt.</p>
                ) : (
                    <>
                        <p>It was turned down. Turn on {name} under Music Bar in Privacy & Security → Automation.</p>
                        <SmallButton onClick={() => void window.musicBar.openAutomationSettings()}>
                            Open System Settings
                        </SmallButton>
                    </>
                )}
            </Step>
            <Step status={scripting} title="Allow JavaScript from Apple Events">
                {state === 'failed' || state === 'error' ? (
                    <p>Music Bar couldn't reach {name}. Quit and reopen it, then check again.</p>
                ) : (
                    <p>
                        In {name}’s menu bar, choose <Keys>View → Developer → Allow JavaScript from Apple Events</Keys>.
                    </p>
                )}
            </Step>
        </ol>
    )
}

function Step({ status, title, children }: { status: StepStatus; title: string; children: ReactNode }) {
    return (
        <li className="flex gap-3">
            <span
                className={`mt-px flex size-5 shrink-0 items-center justify-center rounded-full ${
                    status === 'done'
                        ? 'bg-accent text-white'
                        : status === 'current'
                          ? 'ring-2 ring-white ring-inset'
                          : 'ring-2 ring-white/15 ring-inset'
                }`}
            >
                {status === 'done' && <Check className="size-3" strokeWidth={3.5} />}
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
                <span className={`text-sm font-semibold ${status === 'waiting' ? 'text-faint' : 'text-white'}`}>{title}</span>
                {/* A column of sentences and buttons; keep each sentence in a
                    <p>, or its pieces stack as separate lines. */}
                {status === 'current' && (
                    <div className="flex flex-col items-start gap-2 text-[13px] leading-snug font-medium text-subdued">
                        {children}
                    </div>
                )}
            </div>
        </li>
    )
}

export function BrowserIcon({ icon }: { icon: string | null }) {
    return icon ? (
        <img src={icon} alt="" className="size-9 shrink-0" draggable={false} />
    ) : (
        <span className="size-9 shrink-0 rounded-lg bg-highlight" />
    )
}

export function PrimaryButton({ disabled, onClick, children }: { disabled?: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className="rounded-full bg-accent px-7 py-3 text-sm font-bold text-white transition hover:scale-[1.03] hover:bg-accent-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-40"
        >
            {children}
        </button>
    )
}

function SmallButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
        >
            {children}
        </button>
    )
}

export function Switch({
    label,
    on,
    disabled,
    title,
    onToggle,
}: {
    label: string
    on: boolean
    disabled?: boolean
    title?: string
    onToggle: () => void
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={label}
            title={title}
            disabled={disabled}
            onClick={onToggle}
            className={`relative h-6 w-10 shrink-0 rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50 ${
                on ? 'bg-accent' : 'bg-white/15 hover:bg-white/20'
            }`}
        >
            <span
                className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                    on ? 'translate-x-4' : ''
                }`}
            />
        </button>
    )
}

export function Keys({ children }: { children: ReactNode }) {
    return <span className="font-semibold whitespace-nowrap text-white">{children}</span>
}
