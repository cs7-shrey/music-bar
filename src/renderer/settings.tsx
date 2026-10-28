import { useEffect, useState } from 'react'
import { Globe, Keyboard, SlidersHorizontal } from 'lucide-react'
import type { BrowserName, InstalledBrowser, LoginItemInfo, SettingsSection } from '../shared/ipc'
import { BROWSER_NAMES } from './now-playing'
import {
    BrowserIcon,
    isPrompting,
    isReady,
    SetupSteps,
    StatusPill,
    Switch,
    useBrowserChecks,
    type BrowserCheck,
} from './setup'
import markUrl from '../../assets/mark.svg'

// The settings window, which the setup window becomes once browsers are
// chosen: a sidebar of sections and the chosen one beside it. Changes save
// as they're made.

// Sidebar sections. Each new kind of setting gets its own.
const SECTIONS: { id: SettingsSection; label: string; icon: typeof Globe }[] = [
    { id: 'general', label: 'General', icon: SlidersHorizontal },
    { id: 'browsers', label: 'Browsers', icon: Globe },
    { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
]

const isSection = (value: unknown): value is SettingsSection => SECTIONS.some((section) => section.id === value)

export default function Settings() {
    // The window opens on #settings/<section> when sent somewhere specific,
    // such as from a browser that needs setup.
    const [section, setSection] = useState<SettingsSection>(() => {
        const fromHash = location.hash.split('/')[1]
        return isSection(fromHash) ? fromHash : 'general'
    })

    useEffect(
        () => window.musicBar.onSettingsSection((next) => isSection(next) && setSection(next)),
        [],
    )

    useEffect(() => {
        // A settings window closes with Esc or ⌘W.
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' || (event.metaKey && event.key.toLowerCase() === 'w')) window.close()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [])

    return (
        <div className="flex h-full bg-base text-white">
            <nav className="flex w-[220px] shrink-0 flex-col border-r border-white/[0.06] bg-black/30 px-3 pb-4">
                {/* Room for the traffic lights, and something to drag the window by. */}
                <div className="h-12 shrink-0 [-webkit-app-region:drag]" />
                <div className="flex items-center gap-2.5 px-2 pb-5">
                    <img src={markUrl} alt="" className="size-8" draggable={false} />
                    <span className="text-[15px] font-extrabold tracking-tight">Music Bar</span>
                </div>
                <ul className="flex flex-col gap-0.5">
                    {SECTIONS.map(({ id, label, icon: Icon }) => (
                        <li key={id}>
                            <button
                                type="button"
                                aria-current={section === id ? 'page' : undefined}
                                onClick={() => setSection(id)}
                                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-white ${
                                    section === id ? 'bg-white/10 text-white' : 'text-subdued hover:bg-white/[0.04] hover:text-white'
                                }`}
                            >
                                <Icon className="size-4" strokeWidth={2.25} />
                                {label}
                            </button>
                        </li>
                    ))}
                </ul>
            </nav>
            <main className="flex min-w-0 flex-1 flex-col">
                <div className="h-12 shrink-0 [-webkit-app-region:drag]" />
                <div className="min-h-0 flex-1 overflow-y-auto px-10 pb-10">
                    {/* Capped, so rows stay readable in a wide window. */}
                    <div className="max-w-[640px]">
                        {section === 'general' && <GeneralSection />}
                        {section === 'browsers' && <BrowsersSection />}
                        {section === 'shortcuts' && <ShortcutsSection />}
                    </div>
                </div>
            </main>
        </div>
    )
}

function SectionHeader({ title, description }: { title: string; description: string }) {
    return (
        <header className="flex flex-col gap-1.5">
            <h1 className="text-[22px] leading-tight font-extrabold tracking-tight">{title}</h1>
            <p className="text-sm font-medium text-subdued">{description}</p>
        </header>
    )
}

function GeneralSection() {
    const [loginItem, setLoginItem] = useState<LoginItemInfo | null>(null)

    useEffect(() => {
        void window.musicBar.getOpenAtLogin().then(setLoginItem)
    }, [])

    const toggleOpenAtLogin = async () => {
        if (!loginItem) return
        await window.musicBar.setOpenAtLogin(!loginItem.enabled)
        setLoginItem(await window.musicBar.getOpenAtLogin())
    }

    return (
        <>
            <SectionHeader title="General" description="How Music Bar starts." />
            <div className="mt-6 flex items-center gap-4 rounded-xl bg-elevated p-4">
                <div className="flex flex-1 flex-col gap-1">
                    <span className="text-[15px] font-bold">Open at login</span>
                    <span className="text-[13px] font-medium text-subdued">
                        {loginItem?.available === false
                            ? 'Only in the built app, not in development.'
                            : 'Starts quietly in the menu bar, so ⌥⇧Space works right after you log in.'}
                    </span>
                </div>
                <Switch
                    label="Open at login"
                    on={loginItem?.enabled ?? false}
                    disabled={!loginItem?.available}
                    onToggle={() => void toggleOpenAtLogin()}
                />
            </div>
        </>
    )
}

function BrowsersSection() {
    const [installed, setInstalled] = useState<InstalledBrowser[] | null>(null)
    const [chosen, setChosen] = useState<BrowserName[]>([])
    const checks = useBrowserChecks(chosen)

    useEffect(() => {
        void window.musicBar.getSetup().then((info) => {
            setInstalled(info.installed)
            const available = info.installed.map((item) => item.browser)
            setChosen(info.chosen?.filter((b) => available.includes(b)) ?? [])
        })
    }, [])

    const toggle = (browser: BrowserName) => {
        const next = chosen.includes(browser) ? chosen.filter((b) => b !== browser) : [...chosen, browser]
        // Kept in the order they're listed, not the order they were turned on.
        const ordered = (installed ?? []).map((item) => item.browser).filter((b) => next.includes(b))
        setChosen(ordered)
        void window.musicBar.setBrowsers(ordered)
    }

    return (
        <>
            <SectionHeader title="Browsers" description="Music Bar only talks to the browsers turned on here." />
            {installed?.length === 0 && (
                <p className="mt-6 text-sm font-medium text-subdued">
                    Music Bar works with Brave, Chrome and Helium. Install one of them to use it.
                </p>
            )}
            <div className="mt-6 flex flex-col gap-2">
                {installed?.map(({ browser, icon }) => {
                    const on = chosen.includes(browser)
                    return (
                        <BrowserRow
                            key={browser}
                            browser={browser}
                            icon={icon}
                            on={on}
                            // Music Bar has nothing to control with none on.
                            locked={on && chosen.length === 1}
                            check={checks[browser] ?? { state: null, since: null }}
                            onToggle={() => toggle(browser)}
                        />
                    )
                })}
            </div>
        </>
    )
}

function BrowserRow({
    browser,
    icon,
    on,
    locked,
    check,
    onToggle,
}: {
    browser: BrowserName
    icon: string | null
    on: boolean
    locked: boolean
    check: BrowserCheck
    onToggle: () => void
}) {
    const name = BROWSER_NAMES[browser]
    // Steps only once there's something to do, so a ready browser doesn't
    // flash them while its first check runs.
    const showSteps = on && ((check.state !== null && !isReady(check.state)) || isPrompting(check))
    return (
        <section className="flex shrink-0 flex-col gap-3 rounded-xl bg-elevated p-4">
            <div className="flex items-center gap-3">
                <BrowserIcon icon={icon} />
                <span className="flex-1 text-[15px] font-bold">{name}</span>
                {on && <StatusPill check={check} />}
                <Switch
                    label={`Use ${name}`}
                    on={on}
                    disabled={locked}
                    title={locked ? 'Keep at least one browser on' : undefined}
                    onToggle={onToggle}
                />
            </div>
            {showSteps && <SetupSteps browser={browser} check={check} />}
        </section>
    )
}

// Every shortcut, as the launcher and main process define them (SHORTCUT in
// index.ts, SHORTCUTS and the key handlers in App.tsx). Not changeable yet.
const SHORTCUT_GROUPS: { title: string; shortcuts: { label: string; keys: string[] }[] }[] = [
    {
        title: 'Anywhere',
        shortcuts: [{ label: 'Open Music Bar', keys: ['⌥', '⇧', 'Space'] }],
    },
    {
        title: 'Player',
        shortcuts: [
            { label: 'Previous', keys: ['⌘', 'H'] },
            { label: 'Next', keys: ['⌘', 'L'] },
            { label: 'Loop', keys: ['⌘', 'O'] },
            { label: 'Start radio', keys: ['⌘', 'R'] },
        ],
    },
    {
        title: 'Search results',
        shortcuts: [
            { label: 'Play', keys: ['↵'] },
            { label: 'Play next', keys: ['⇧', '↵'] },
            { label: 'Start radio from song', keys: ['⌘', '↵'] },
        ],
    },
    {
        title: 'Launcher',
        shortcuts: [
            { label: 'Settings', keys: ['⌘', ','] },
            { label: 'Back, clear or close', keys: ['esc'] },
        ],
    },
]

function ShortcutsSection() {
    return (
        <>
            <SectionHeader title="Shortcuts" description="The keys Music Bar answers to." />
            {SHORTCUT_GROUPS.map(({ title, shortcuts }) => (
                <section key={title} className="mt-7">
                    <h2 className="mb-2 text-xs font-bold tracking-wider text-faint uppercase">{title}</h2>
                    <ul className="flex flex-col divide-y divide-white/[0.06] rounded-xl bg-elevated">
                        {shortcuts.map(({ label, keys }) => (
                            <li key={label} className="flex h-12 items-center justify-between gap-4 px-4">
                                <span className="text-sm font-semibold">{label}</span>
                                <ShortcutPill keys={keys} />
                            </li>
                        ))}
                    </ul>
                </section>
            ))}
        </>
    )
}

/** Looks like the button for recording a shortcut, the way it will be once they can be changed. */
function ShortcutPill({ keys }: { keys: string[] }) {
    return (
        <span className="flex cursor-default items-center gap-1 rounded-lg bg-white/[0.06] px-1.5 py-1 ring-1 ring-white/10 transition select-none ring-inset hover:bg-white/10">
            {keys.map((key) => (
                <kbd
                    key={key}
                    className="flex h-6 min-w-6 items-center justify-center rounded-md bg-white/10 px-1.5 font-sans text-xs font-bold text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.35)]"
                >
                    {key}
                </kbd>
            ))}
        </span>
    )
}
