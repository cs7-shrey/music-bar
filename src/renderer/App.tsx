import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Command } from 'cmdk'
import { ListMusic, Music2, Play, Radio, Repeat1, Search } from 'lucide-react'
import { NowPlaying, useNowPlaying } from './now-playing'

interface PlaybackCommand {
    id: string
    title: string
    subtitle: string
    icon: ReactNode
}

const LOOP_COMMAND = 'Loop Current Song'

// Placeholders until each command is wired to YouTube Music.
const SOON_COMMANDS: PlaybackCommand[] = [
    { id: 'play-next', title: 'Play Next', subtitle: 'Queue a song right after the current one', icon: <ListMusic /> },
    { id: 'start-radio', title: 'Start Radio', subtitle: 'Start a radio from another song', icon: <Radio /> },
    { id: 'play-now', title: 'Play Now', subtitle: 'Replace the current song', icon: <Play /> },
]

export default function App() {
    const [query, setQuery] = useState('')
    const [selected, setSelected] = useState(LOOP_COMMAND)
    const inputRef = useRef<HTMLInputElement>(null)
    const nowPlaying = useNowPlaying()
    const track = nowPlaying.state?.status === 'track' ? nowPlaying.state.track : null
    const isLooping = track?.repeatMode === 'ONE'

    useEffect(
        () =>
            window.musicBar.onShown(() => {
                setQuery('')
                setSelected(LOOP_COMMAND)
                inputRef.current?.focus()
            }),
        [],
    )

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        if (query) setQuery('')
        else window.musicBar.hide()
    }

    return (
        <Command
            label="Music Bar"
            loop
            value={selected}
            onValueChange={setSelected}
            onKeyDown={handleKeyDown}
            className="flex h-full flex-col bg-[#161618]/85 text-neutral-100"
        >
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-black/10 px-4 dark:border-white/10">
                <Search className="size-[18px] text-neutral-500 dark:text-neutral-400" />
                <Command.Input
                    ref={inputRef}
                    autoFocus
                    value={query}
                    onValueChange={setQuery}
                    placeholder="Search YouTube Music or run a command…"
                    className="h-full flex-1 bg-transparent text-[17px] outline-none placeholder:text-neutral-500 dark:placeholder:text-neutral-400"
                />
            </div>

            <NowPlaying {...nowPlaying} />

            <Command.List className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                <Command.Empty className="py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
                    No results
                </Command.Empty>
                <Command.Group heading="Playback">
                    <CommandRow
                        // Stable value so the selection does not jump when the title flips.
                        value={LOOP_COMMAND}
                        keywords={['repeat', 'stop looping']}
                        icon={<Repeat1 />}
                        title={isLooping ? 'Stop Looping' : 'Loop Current Song'}
                        subtitle={track ? `${isLooping ? 'Looping' : 'Repeat'} “${track.title}”` : 'Nothing is playing'}
                        badge={isLooping ? 'On' : undefined}
                        // Dimmed rather than cmdk-disabled: a disabled first row would
                        // push the selection onto a placeholder while the track loads.
                        muted={!track}
                        onSelect={() => track && void nowPlaying.setLoop(!isLooping)}
                    />
                    {SOON_COMMANDS.map((command) => (
                        <CommandRow
                            key={command.id}
                            value={command.title}
                            keywords={[command.subtitle]}
                            icon={command.icon}
                            title={command.title}
                            subtitle={command.subtitle}
                            badge="Soon"
                        />
                    ))}
                </Command.Group>
            </Command.List>

            <footer className="flex h-10 shrink-0 items-center justify-between border-t border-black/10 bg-black/[0.03] px-4 text-xs text-neutral-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-400">
                <span className="flex items-center gap-1.5">
                    <Music2 className="size-3.5" />
                    Music Bar
                </span>
                <span className="flex items-center gap-3">
                    <Hint keys="↵" label="Select" />
                    <Hint keys="esc" label="Close" />
                </span>
            </footer>
        </Command>
    )
}

function CommandRow({
    value,
    keywords,
    icon,
    title,
    subtitle,
    badge,
    muted,
    onSelect,
}: {
    value: string
    keywords: string[]
    icon: ReactNode
    title: string
    subtitle: string
    badge?: string
    muted?: boolean
    onSelect?: () => void
}) {
    return (
        <Command.Item
            value={value}
            keywords={keywords}
            onSelect={onSelect}
            className={`flex h-11 items-center gap-3 rounded-lg px-2 text-sm data-[selected=true]:bg-white/10 ${muted ? 'opacity-50' : ''}`}
        >
            <span className="flex size-7 items-center justify-center rounded-md bg-red-500/90 text-white [&>svg]:size-4">
                {icon}
            </span>
            <span className="font-medium">{title}</span>
            <span className="truncate text-neutral-400">{subtitle}</span>
            {badge && (
                <span className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-neutral-400 ring-1 ring-white/15">
                    {badge}
                </span>
            )}
        </Command.Item>
    )
}

function Hint({ keys, label }: { keys: string; label: string }) {
    return (
        <span className="flex items-center gap-1.5">
            {label}
            <kbd className="rounded bg-black/[0.06] px-1.5 py-0.5 font-sans text-[11px] dark:bg-white/10">{keys}</kbd>
        </span>
    )
}
