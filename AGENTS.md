# Music Bar

Raycast-style launcher (⌘⇧Space) for controlling YouTube Music playing in a
Chromium browser (Brave first, also Chrome and Helium). macOS only.

## Package manager

Use **pnpm** for everything. Do not use npm or yarn, and do not commit a
`package-lock.json` or `yarn.lock`.

- `pnpm install`
- `pnpm dev` — run the app with Vite HMR (Electron Forge)
- `pnpm typecheck` — typecheck main/preload and renderer
- `pnpm build` / `pnpm make` — package the app / build a zip

`.npmrc` sets `node-linker=hoisted` because Electron Forge's packager needs a
flat `node_modules`. Electron 44 downloads its binary on first launch, not at
install time.

## Stack

Electron Forge + Vite, React 19, Tailwind CSS v4, `cmdk` for the command list,
`lucide-react` for icons. Browser control is AppleScript via `osascript`.

## Layout

- `src/main/` — Electron main process. `launcher-window.ts` owns the floating
  panel (show/hide/position); `index.ts` wires the global shortcut and tray.
- `src/main/youtube-music.ts` — the YouTube Music bridge. Runs JavaScript in
  YT Music tabs through each browser's AppleScript `execute javascript`
  (works on background tabs). Requires View → Developer → Allow JavaScript
  from Apple Events in each browser. No accessibility tree: Chromium only
  exposes the front tab's page to it.
  Scripts run in the browser's isolated world: DOM and cookies are shared
  with the page, page globals (`ytcfg`, etc.) are not. `execute javascript`
  cannot await; use `evaluateAsyncInTab` for anything async.
- `src/main/youtube-music-search.ts` — search via YouTube Music's internal
  InnerTube API (`music/get_search_suggestions`, `search`), called from inside
  a YT Music tab so requests carry the user's session. Songs and videos are
  told apart from albums/playlists/profiles by `videoId` and
  `musicVideoType`, never by the localized "Song"/"Album" labels.
- `src/preload/` — exposes `window.musicBar` via `contextBridge`.
- `src/shared/` — IPC channel names and the `MusicBarApi` type, shared by all
  processes. Add every new IPC channel here.
- `src/renderer/` — the launcher UI.

## Conventions

- The app runs as a background (accessory) app: no Dock icon, tray item only.
- Always dark: `nativeTheme.themeSource = 'dark'` in main. Do not add a light theme yet.
- The launcher hides on blur and on Esc. Hiding through `hideLauncher()` also
  calls `app.hide()` so focus returns to the previous app.
- Renderer code never imports Electron; go through `window.musicBar`.

## Player actions: debouncing and ordering

Every new action that changes playback must pick one of these, on purpose.
Rapid presses are normal (users mash ↵ and shortcuts), and each action is a
round trip through AppleScript into the browser tab.

| Kind of action | Rule | Helper (`src/renderer/now-playing.tsx`) | Examples |
|---|---|---|---|
| Toggle (has an on/off state) | Flip the UI at once; send only the **final state** 300ms after presses stop. Main must *set* the state (idempotent), never toggle it. | `debouncedToggle` | play/pause (`setPlaying`), loop (`setLoop`) |
| Heavy action (rebuilds the queue or replaces the song) | Debounce: only the **last** press in a burst runs, 300ms after presses stop. Related actions share a key so the last one wins. | `debounceAction(key, run)` | Start Radio (row and ⌘R), ⌘↵ radio from search (key `'radio'`) |
| Countable step (each press means one step) | No debounce: every press runs. | `act` | previous / next (⌘H / ⌘L) |
| Additive, repeatable on purpose | No debounce. | — | ⇧↵ play next (queueing several songs is the point) |
| One-off with a busy state | Ignore presses while it runs. | flag, e.g. `loadingTab`, `openingIn` | Load an inactive tab, open YouTube Music in a browser |

Also:
- Main runs actions one at a time in order (`enqueue` in `youtube-music.ts`),
  so even un-debounced presses reach the page in sequence.
- Every action bumps `actionSeq`, so reads that started before it are
  discarded and can't overwrite the optimistic UI.
- Search requests are debounced too (200ms, `useSuggestions` in `search.tsx`).
