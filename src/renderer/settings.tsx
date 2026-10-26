import { useEffect, useState } from 'react'
import { Globe } from 'lucide-react'
import type { BrowserName, InstalledBrowser } from '../shared/ipc'
import { BROWSER_NAMES } from './now-playing'
import {
    BrowserIcon,
    isPrompting,
    isReady,
    SetupSteps,
    StatusPill,
    useBrowserChecks,
    type BrowserCheck,
} from './setup'
import markUrl from '../../assets/mark.svg'

// The settings window, which the setup window becomes once browsers are
// chosen: a sidebar of sections and the chosen one beside it. Changes save
// as they're made.

// Sidebar sections. Each new kind of setting gets its own.
const SECTIONS = [{ id: 'browsers', label: 'Browsers', icon: Globe }] as const

type SectionId = (typeof SECTIONS)[number]['id']

export default function Settings() {
    const [section, setSection] = useState<SectionId>('browsers')

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
                    <div className="max-w-[640px]">{section === 'browsers' && <BrowsersSection />}</div>
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

function Switch({
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
