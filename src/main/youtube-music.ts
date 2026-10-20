import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { BrowserName, NowPlaying, PlayerControl, Track, TrackSource } from '../shared/ipc'

// Talks to YouTube Music by running JavaScript inside its tab through the
// browser's AppleScript `execute javascript` command. This works on background
// tabs, but each browser needs View → Developer → Allow JavaScript from Apple
// Events turned on once.

const BROWSERS: BrowserName[] = ['Brave Browser', 'Google Chrome', 'Helium']
const YT_MUSIC_URL = 'https://music.youtube.com/'

// Returns '' when the tab has no track loaded, else the track as JSON.
const READ_TRACK_JS = `(() => {
    const m = navigator.mediaSession.metadata;
    if (!m || !m.title) return '';
    const video = document.querySelector('video');
    const art = [...m.artwork].sort((a, b) => parseInt(b.sizes) - parseInt(a.sizes))[0];
    return JSON.stringify({
        title: m.title,
        artist: m.artist,
        album: m.album,
        artworkUrl: art ? art.src : null,
        isPlaying: !!video && !video.paused,
        repeatMode: document.querySelector('ytmusic-player-bar')?.getAttribute('repeat-mode') || 'NONE',
    });
})()`

const CONTROL_SELECTORS: Record<PlayerControl, string> = {
    previous: '.previous-button',
    'play-pause': '#play-pause-button',
    next: '.next-button',
}

const installed = BROWSERS.filter((name) =>
    [join('/Applications', `${name}.app`), join(homedir(), 'Applications', `${name}.app`)].some(existsSync),
)

/** Quotes a string as an AppleScript string literal. */
function asString(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function runAppleScript(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile('osascript', ['-e', script], { timeout: 5000 }, (error, stdout, stderr) => {
            if (error) reject(new Error(stderr.trim() || error.message))
            else resolve(stdout.trim())
        })
    })
}

/** One YT Music tab (with or without a loaded track), or a failed read. */
type TabResult = { source: TrackSource; track: Track | null } | { error: string }

// The tab Music Bar follows: the last one seen playing or controlled. Without
// this, a pause or the gap between songs hands the card to whichever other
// YT Music tab happens to have a paused track loaded.
let followed: TrackSource | null = null
// The followed tab's last track, shown while it briefly has no metadata
// between songs.
let followedTrack: Track | null = null

// Every YT Music tab seen by the last read; searches fall back to these when
// nothing is followed yet.
let knownTabs: TrackSource[] = []

function isSameTab(a: TrackSource, b: TrackSource): boolean {
    return a.browser === b.browser && a.windowId === b.windowId && a.tabId === b.tabId
}

function follow(track: Track): Track {
    followed = track.source
    followedTrack = track
    return track
}

async function readBrowser(browser: BrowserName): Promise<TabResult[]> {
    // `tab` is a class name inside the browser's dictionary, so the separator
    // is bound before entering the tell block.
    const script = `
set sep to character id 9
set out to ""
if application ${asString(browser)} is running then
    tell application ${asString(browser)}
        repeat with w in windows
            repeat with t in tabs of w
                if URL of t starts with ${asString(YT_MUSIC_URL)} then
                    try
                        set r to execute t javascript ${asString(READ_TRACK_JS.replace(/\s*\n\s*/g, ' '))}
                        if r is missing value then set r to ""
                        set out to out & "tab" & sep & (id of w as text) & sep & (id of t as text) & sep & r & linefeed
                    on error message
                        set out to out & "error" & sep & message & linefeed
                    end try
                end if
            end repeat
        end repeat
    end tell
end if
return out`

    let output: string
    try {
        output = await runAppleScript(script)
    } catch (error) {
        return [{ error: error instanceof Error ? error.message : String(error) }]
    }

    return output
        .split('\n')
        .filter(Boolean)
        .map((line): TabResult => {
            const [kind, ...rest] = line.split('\t')
            if (kind === 'error') return { error: rest.join('\t') }
            const [windowId, tabId, json] = rest
            const source: TrackSource = { browser, windowId: Number(windowId), tabId: Number(tabId) }
            return { source, track: json ? { ...JSON.parse(json), source } : null }
        })
}

export async function getNowPlaying(): Promise<NowPlaying> {
    const results = (await Promise.all(installed.map(readBrowser))).flat()
    const tabs = results.flatMap((result) => ('source' in result ? [result] : []))
    knownTabs = tabs.map((tab) => tab.source)
    const tracks = tabs.flatMap((tab) => (tab.track ? [tab.track] : []))
    const current = followed
    const isFollowed = (source: TrackSource) => current !== null && isSameTab(source, current)
    const followedTab = tabs.find((tab) => isFollowed(tab.source))

    // A playing tab always wins, the followed one first if several play.
    const playing =
        tracks.find((track) => track.isPlaying && isFollowed(track.source)) ??
        tracks.find((track) => track.isPlaying)
    if (playing) return { status: 'track', track: follow(playing) }

    // Nothing plays: stay on the followed tab while it is still open.
    if (followedTab) {
        const track = followedTab.track ? follow(followedTab.track) : followedTrack
        if (track) return { status: 'track', track }
    }

    if (tracks[0]) return { status: 'track', track: tracks[0] }

    for (const result of results) {
        if ('error' in result) return { status: 'error', message: result.error }
    }
    return { status: 'none' }
}

/** The tab to search and play in: the followed one, else any YT Music tab. */
export async function defaultTab(): Promise<TrackSource | null> {
    if (!followed && knownTabs.length === 0) await getNowPlaying()
    return followed ?? knownTabs[0] ?? null
}

/** Runs JavaScript in one specific tab and returns its result as text. */
async function executeInTab(source: TrackSource, js: string): Promise<string> {
    // The source can come back from the renderer, so it goes through a strict
    // check before it is spliced into a script.
    if (!BROWSERS.includes(source.browser) || !Number.isInteger(source.windowId) || !Number.isInteger(source.tabId)) {
        throw new Error('Invalid tab')
    }
    return runAppleScript(`
tell application ${asString(source.browser)}
    execute (tab id ${source.tabId} of window id ${source.windowId}) javascript ${asString(js.replace(/\s*\n\s*/g, ' '))}
end tell`)
}

const ASYNC_POLL_MS = 80

/**
 * Runs an async function body in a tab and returns what it resolves to.
 * `execute javascript` cannot await, so the body's promise parks its result
 * on the page's window and later calls collect it. The window object belongs
 * to the browser's isolated script world, which persists between calls but
 * is invisible to the page.
 */
export async function evaluateAsyncInTab(source: TrackSource, body: string, timeoutMs = 8000): Promise<string> {
    const id = randomUUID()
    await executeInTab(
        source,
        `(() => {
            const slots = (window.__musicBar ??= {});
            slots['${id}'] = { done: false };
            (async () => { ${body} })().then(
                (value) => { slots['${id}'] = { done: true, value: String(value) }; },
                (error) => { slots['${id}'] = { done: true, error: String(error) }; },
            );
        })()`,
    )

    const collect = `(() => {
        const slot = window.__musicBar && window.__musicBar['${id}'];
        if (!slot || !slot.done) return '';
        delete window.__musicBar['${id}'];
        return JSON.stringify(slot);
    })()`
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, ASYNC_POLL_MS))
        const output = await executeInTab(source, collect)
        if (!output) continue
        const slot: { value?: string; error?: string } = JSON.parse(output)
        if (slot.error !== undefined) throw new Error(slot.error)
        return slot.value ?? ''
    }
    throw new Error('YouTube Music took too long to respond')
}

// Actions run one at a time so rapid presses reach the page in order.
let actionQueue: Promise<unknown> = Promise.resolve()

/** Runs a user action in one specific tab and starts following that tab. */
async function runInTab(source: TrackSource, js: string): Promise<void> {
    // Whatever the user just acted on is the tab to follow.
    if (!followed || !isSameTab(followed, source)) {
        followed = source
        followedTrack = null
    }
    const run = actionQueue.then(() => executeInTab(source, js))
    actionQueue = run.catch(() => {})
    await run
}

export async function control(source: TrackSource, action: PlayerControl): Promise<void> {
    if (!(action in CONTROL_SELECTORS)) throw new Error('Invalid player control')
    await runInTab(source, `document.querySelector('ytmusic-player-bar ${CONTROL_SELECTORS[action]}')?.click()`)
}

export async function setLoop(source: TrackSource, enabled: boolean): Promise<void> {
    if (typeof enabled !== 'boolean') throw new Error('Invalid loop request')
    // The repeat button only cycles (off → all → one → off), and the bar's
    // repeat-mode attribute updates synchronously on each click, so click
    // until it matches; three clicks cover the whole cycle. The mode from
    // before looping lives on the page so each tab restores its own.
    await runInTab(
        source,
        `(() => {
            const bar = document.querySelector('ytmusic-player-bar');
            const button = bar && bar.querySelector('.repeat');
            if (!button) return;
            const mode = bar.getAttribute('repeat-mode');
            let target = 'ONE';
            if (${enabled}) {
                if (mode !== 'ONE') window.__musicBarModeBeforeLoop = mode;
            } else {
                if (mode !== 'ONE') return;
                target = window.__musicBarModeBeforeLoop === 'ALL' ? 'ALL' : 'NONE';
                delete window.__musicBarModeBeforeLoop;
            }
            for (let i = 0; i < 3 && bar.getAttribute('repeat-mode') !== target; i++) button.click();
        })()`,
    )
}

/** Plays a song right away in the followed tab, replacing the current one. */
export async function playNow(videoId: string): Promise<void> {
    if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Invalid video id')
    const tab = await defaultTab()
    if (!tab) throw new Error('Open YouTube Music in Brave, Chrome or Helium')
    // Asks the page's own router to open the song, the same event its links
    // fire, so it starts without a page reload.
    await runInTab(
        tab,
        `document.querySelector('ytmusic-app').dispatchEvent(new CustomEvent('yt-navigate', {
            bubbles: true,
            composed: true,
            detail: { endpoint: { watchEndpoint: { videoId: '${videoId}' } } },
        }))`,
    )
}
