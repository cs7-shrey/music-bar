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

// Chromium won't load media in a tab that has never been shown, such as one
// restored at launch: a play request leaves the video unpaused with nothing
// loaded (readyState 0) until the tab is opened once. Having seen media at
// any point means the tab was shown, so the flag keeps an ordinary track
// change (readyState briefly 0) from counting as asleep.
const IS_ASLEEP_JS = `((video) => {
    if (video && video.readyState > 0) window.__musicBarSawMedia = true;
    return !!video && video.readyState === 0 && document.visibilityState === 'hidden' && !window.__musicBarSawMedia;
})(document.querySelector('video'))`

// Returns '' when the tab has no track loaded, else the track as JSON.
// isPlaying needs more than "not paused": a restored background tab can be
// told to play while Chromium holds off loading media until it is opened,
// leaving the video unpaused with no data (readyState 0). readyState 2 means
// data for the current position, which buffering stalls keep.
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
        isPlaying: !!video && !video.paused && !video.ended && video.readyState >= 2,
        repeatMode: document.querySelector('ytmusic-player-bar')?.getAttribute('repeat-mode') || 'NONE',
        isAsleep: ${IS_ASLEEP_JS},
    });
})()`

const CONTROL_SELECTORS: Record<PlayerControl, string> = {
    previous: '.previous-button',
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
        execFile('osascript', ['-e', script], { timeout: 10_000 }, (error, stdout, stderr) => {
            if (error) reject(new Error(stderr.trim() || error.message))
            else resolve(stdout.trim())
        })
    })
}

/**
 * One YT Music tab, or a failed read. `loaded` is false for a tab Brave hasn't
 * loaded (restored at launch without being opened, or discarded to save
 * memory): its scripts never answer, and Brave's tab info doesn't say so.
 */
type TabResult = { source: TrackSource; track: Track | null; loaded: boolean } | { error: string }

// How long one tab gets to answer before it counts as not loaded. Without a
// limit, one unloaded tab hangs the whole read.
const TAB_ANSWER_SECONDS = 1
// A tab that didn't answer is skipped until this long after, so a read
// doesn't spend a second on every inactive tab every time.
const INACTIVE_RETRY_MS = 30_000
const inactiveUntil = new Map<string, number>()
const tabKey = (source: TrackSource) => `${source.browser}:${source.windowId}:${source.tabId}`

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
    const now = Date.now()
    const skipIds = [...inactiveUntil]
        .filter(([key, retryAt]) => key.startsWith(`${browser}:`) && retryAt > now)
        .map(([key]) => asString(key.split(':').at(-1)!))
    // `tab` is a class name inside the browser's dictionary, so the separator
    // is bound before entering the tell block. The `whose` filter finds YT
    // Music tabs in one request instead of asking each tab for its URL.
    const script = `
set sep to character id 9
set out to ""
set skipIds to {${skipIds.join(', ')}}
if application ${asString(browser)} is running then
    tell application ${asString(browser)}
        repeat with w in windows
            repeat with t in (tabs of w whose URL starts with ${asString(YT_MUSIC_URL)})
                if skipIds contains (id of t as text) then
                    set out to out & "skipped" & sep & (id of w as text) & sep & (id of t as text) & linefeed
                else
                    try
                        with timeout of ${TAB_ANSWER_SECONDS} seconds
                            set r to execute t javascript ${asString(READ_TRACK_JS)}
                        end timeout
                        if r is missing value then set r to ""
                        set out to out & "tab" & sep & (id of w as text) & sep & (id of t as text) & sep & r & linefeed
                    on error message number errorNumber
                        if errorNumber is -1712 then
                            set out to out & "unloaded" & sep & (id of w as text) & sep & (id of t as text) & linefeed
                        else
                            set out to out & "error" & sep & message & linefeed
                        end if
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
            if (kind === 'skipped') return { source, track: null, loaded: false }
            if (kind === 'unloaded') {
                inactiveUntil.set(tabKey(source), Date.now() + INACTIVE_RETRY_MS)
                return { source, track: null, loaded: false }
            }
            inactiveUntil.delete(tabKey(source))
            return { source, track: json ? { ...JSON.parse(json), source } : null, loaded: true }
        })
}

export async function getNowPlaying(): Promise<NowPlaying> {
    const results = (await Promise.all(installed.map(readBrowser))).flat()
    const tabs = results.flatMap((result) => ('source' in result ? [result] : []))
    // Loaded tabs first, so search and play now avoid a tab that can't answer.
    knownTabs = [...tabs.filter((tab) => tab.loaded), ...tabs.filter((tab) => !tab.loaded)].map((tab) => tab.source)
    const tracks = tabs.flatMap((tab) => (tab.track ? [tab.track] : []))
    const current = followed
    const isFollowed = (source: TrackSource) => current !== null && isSameTab(source, current)
    const followedTab = tabs.find((tab) => isFollowed(tab.source))
    // Tab ids don't survive a browser restart or a closed tab; a followed
    // tab that's gone would leave search and play now aimed at nothing.
    if (current && !followedTab) {
        followed = null
        followedTrack = null
    }

    // A playing tab always wins, the followed one first if several play.
    const playing =
        tracks.find((track) => track.isPlaying && isFollowed(track.source)) ??
        tracks.find((track) => track.isPlaying)
    if (playing) return { status: 'track', track: follow(playing) }

    // Nothing plays: stay on the followed tab while it is still open.
    if (followedTab && !followedTab.loaded) return { status: 'unloaded', source: followedTab.source }
    if (followedTab) {
        const track = followedTab.track ? follow(followedTab.track) : followedTrack
        if (track) return { status: 'track', track }
    }

    if (tracks[0]) return { status: 'track', track: tracks[0] }

    const unloaded = tabs.find((tab) => !tab.loaded)
    if (unloaded) return { status: 'unloaded', source: unloaded.source }

    for (const result of results) {
        if ('error' in result) return { status: 'error', message: result.error }
    }
    return { status: 'none' }
}

/**
 * Reads only the followed tab: one quick call instead of a full scan, so the
 * launcher shows current state the moment it opens and right after an action.
 * Null when nothing is followed or the tab doesn't answer; the full read
 * covers those cases.
 */
export async function getFollowedNowPlaying(): Promise<NowPlaying | null> {
    const source = followed
    if (!source || (inactiveUntil.get(tabKey(source)) ?? 0) > Date.now()) return null
    try {
        const json = await executeInTab(source, READ_TRACK_JS, TAB_ANSWER_SECONDS)
        if (!json) return null
        return { status: 'track', track: follow({ ...JSON.parse(json), source }) }
    } catch {
        return null
    }
}

/** The tab to search and play in: the followed one, else any YT Music tab. */
export async function defaultTab(): Promise<TrackSource | null> {
    if (!followed && knownTabs.length === 0) await getNowPlaying()
    return followed ?? knownTabs[0] ?? null
}

/**
 * Runs JavaScript in one specific tab and returns its result as text. A tab
 * that doesn't answer in time (often one Brave hasn't loaded) fails with
 * AppleScript's "AppleEvent timed out" error.
 */
async function executeInTab(source: TrackSource, js: string, timeoutSeconds = 3): Promise<string> {
    // The source can come back from the renderer, so it goes through a strict
    // check before it is spliced into a script.
    if (!BROWSERS.includes(source.browser) || !Number.isInteger(source.windowId) || !Number.isInteger(source.tabId)) {
        throw new Error('Invalid tab')
    }
    return runAppleScript(`
with timeout of ${timeoutSeconds} seconds
    tell application ${asString(source.browser)}
        execute (tab id ${source.tabId} of window id ${source.windowId}) javascript ${asString(js)}
    end tell
end timeout`)
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

const WAKE_TIMEOUT_MS = 3000
const LOAD_TAB_TIMEOUT_MS = 10_000
const SHOW_POLL_MS = 100

/**
 * Shows a tab in its window until `isReady` holds, then switches back to the
 * tab that was in front. Brave only loads restored tabs, and Chromium only
 * loads media, once a tab has been shown; after that both keep working from
 * the background.
 */
async function showTabUntil(
    source: TrackSource,
    isReady: () => Promise<boolean>,
    timeoutMs: number,
    failure: string,
): Promise<void> {
    const tell = (body: string) =>
        runAppleScript(`
tell application ${asString(source.browser)}
    set w to window id ${source.windowId}
${body}
end tell`)
    const indexOf = (tabId: string) => `
    set i to 0
    repeat with t in tabs of w
        set i to i + 1
        if (id of t as text) is "${tabId}" then exit repeat
    end repeat`

    const previousTabId = await tell(`
    set previousTabId to id of active tab of w
${indexOf(String(source.tabId))}
    set active tab index of w to i
    return previousTabId as text`)
    try {
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
            if (await isReady()) return
            await new Promise((resolve) => setTimeout(resolve, SHOW_POLL_MS))
        }
        throw new Error(failure)
    } finally {
        // Switch back only if the user hasn't moved to another tab meanwhile.
        // Brave reports tab ids as text, so they're compared as text.
        if (/^\d+$/.test(previousTabId)) {
            await tell(`
    if (id of active tab of w as text) is "${source.tabId}" then
${indexOf(previousTabId)}
        set active tab index of w to i
    end if`)
        }
    }
}

/** Wakes a tab whose media Chromium is holding back (see IS_ASLEEP_JS); measured at about 0.6s. */
async function wakeIfAsleep(source: TrackSource): Promise<void> {
    if ((await executeInTab(source, `String(${IS_ASLEEP_JS})`)) !== 'true') return
    await showTabUntil(
        source,
        async () => Number(await executeInTab(source, `String(document.querySelector('video')?.readyState ?? 0)`)) >= 2,
        WAKE_TIMEOUT_MS,
        "Brave hasn't loaded this YouTube Music tab yet. Open it once to start playback.",
    )
}

/** Gets Brave to load a tab it restored or discarded without loading. */
export async function loadTab(source: TrackSource): Promise<void> {
    await enqueue(() =>
        showTabUntil(
            source,
            async () => {
                try {
                    // The tab answers once its page runs; the app element means YT Music is up.
                    return (await executeInTab(source, `String(!!document.querySelector('ytmusic-app'))`, 1)) === 'true'
                } catch {
                    return false
                }
            },
            LOAD_TAB_TIMEOUT_MS,
            "Brave didn't load the YouTube Music tab. Open it once, then try again.",
        ),
    )
    inactiveUntil.delete(tabKey(source))
}

/** Runs actions one at a time so rapid presses reach the page in order. */
function enqueue(action: () => Promise<void>): Promise<void> {
    const run = actionQueue.then(action)
    actionQueue = run.catch(() => {})
    return run
}

/**
 * Runs a user action in one specific tab and starts following that tab.
 * Actions that start playback pass wake, so a tab Chromium hasn't loaded yet
 * gets woken right after the action asks it to play.
 */
async function runInTab(source: TrackSource, js: string, { wake = false } = {}): Promise<void> {
    // Whatever the user just acted on is the tab to follow.
    if (!followed || !isSameTab(followed, source)) {
        followed = source
        followedTrack = null
    }
    await enqueue(async () => {
        await executeInTab(source, js)
        if (wake) await wakeIfAsleep(source)
    })
}

export async function control(source: TrackSource, action: PlayerControl): Promise<void> {
    if (!(action in CONTROL_SELECTORS)) throw new Error('Invalid player control')
    await runInTab(source, `document.querySelector('ytmusic-player-bar ${CONTROL_SELECTORS[action]}')?.click()`, {
        wake: true,
    })
}

export async function setPlaying(source: TrackSource, playing: boolean): Promise<void> {
    if (typeof playing !== 'boolean') throw new Error('Invalid play request')
    // Sets a state rather than toggling, so a repeated or late request can't
    // flip playback the wrong way.
    await runInTab(
        source,
        `(() => {
            const video = document.querySelector('video');
            if (video && video.paused === ${playing}) document.querySelector('ytmusic-player-bar #play-pause-button')?.click();
        })()`,
        { wake: playing },
    )
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

const VIDEO_ID = /^[\w-]{11}$/

/** The followed tab, for actions on a song from search. */
async function tabForSong(videoId: string): Promise<TrackSource> {
    if (!VIDEO_ID.test(videoId)) throw new Error('Invalid video id')
    const tab = await defaultTab()
    if (!tab) throw new Error('Open YouTube Music in Brave, Chrome or Helium')
    return tab
}

/**
 * Wraps code so it runs in the page's own world, where YouTube Music's
 * components live; `execute javascript` itself runs in an isolated world. The
 * code goes in a <script> carrying the page's CSP nonce, built through a
 * Trusted Types policy because the page requires them for script text.
 * Each script runs at the page's top level, so the code is wrapped in a
 * function: a bare `const` would stay declared and break the next injection.
 */
function inPageWorld(code: string): string {
    return `(() => {
        const policy = (window.__musicBarPolicy ??= trustedTypes.createPolicy('music-bar', { createScript: (text) => text }));
        const script = document.createElement('script');
        script.nonce = document.querySelector('script[nonce]')?.nonce ?? '';
        script.textContent = policy.createScript(${JSON.stringify(`(() => { ${code} })()`)});
        document.documentElement.appendChild(script);
        script.remove();
    })()`
}

/** Plays a song right away in the followed tab, replacing the current one. */
export async function playNow(videoId: string): Promise<void> {
    const tab = await tabForSong(videoId)
    // Asks the page's own router to open the song, the same event its links
    // fire, so it starts without a page reload.
    await runInTab(
        tab,
        `document.querySelector('ytmusic-app').dispatchEvent(new CustomEvent('yt-navigate', {
            bubbles: true,
            composed: true,
            detail: { endpoint: { watchEndpoint: { videoId: '${videoId}' } } },
        }))`,
        { wake: true },
    )
}

/** Queues a song right after the current one, like the menu's "Play next". */
export async function playNext(videoId: string): Promise<void> {
    const tab = await tabForSong(videoId)
    // Queue edits have no event hook: the menu item runs its command through
    // app internals. So this builds the same hidden menu item, with the
    // command the real "Play next" carries, and runs its tap handler. A
    // scripted click() only sometimes registers as a tap, so it calls onTap
    // directly. On an empty queue the command plays the song instead.
    await runInTab(
        tab,
        inPageWorld(`
            const item = document.createElement('ytmusic-menu-service-item-renderer');
            item.data = {
                text: { runs: [{ text: 'Play next' }] },
                icon: { iconType: 'QUEUE_PLAY_NEXT' },
                serviceEndpoint: {
                    queueAddEndpoint: {
                        queueTarget: { videoId: '${videoId}', onEmptyQueue: { watchEndpoint: { videoId: '${videoId}' } } },
                        queueInsertPosition: 'INSERT_AFTER_CURRENT_VIDEO',
                    },
                },
            };
            item.hidden = true;
            document.querySelector('ytmusic-app').appendChild(item);
            item.onTap(new CustomEvent('tap'));
            setTimeout(() => item.remove(), 1000);
        `),
    )
}
