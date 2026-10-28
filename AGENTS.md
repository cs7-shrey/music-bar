# Music Bar

Raycast-style launcher (⌥⇧Space) for controlling YouTube Music playing in a
Chromium browser (Brave first, also Chrome and Helium). macOS only.

## Package manager

Use **pnpm** for everything. Do not use npm or yarn, and do not commit a
`package-lock.json` or `yarn.lock`.

- `pnpm install`
- `pnpm dev` — run the app with Vite HMR (Electron Forge)
- `pnpm typecheck` — typecheck main/preload and renderer
- `pnpm build` / `pnpm make` — package the app / build a zip
- `pnpm icons` — regenerate the app icon and menu bar icon from `assets/note.svg`
- `pnpm release <patch|minor|major|x.y.z>` — cut a release (see Releasing)

`pnpm-workspace.yaml` sets `nodeLinker: hoisted` because Electron Forge's
packager needs a flat `node_modules` (pnpm 11+ ignores it in `.npmrc`). It
also lists the dependencies allowed to run install scripts (`allowBuilds`);
pnpm skips any other's and fails the install. Electron 44 downloads its
binary on first launch, not at install time.

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
  Browsers refuse to start sound in a page the user hasn't clicked or typed
  in, unless the site has enough "media engagement" (Chrome ships it for
  YouTube Music, Brave earns it, Helium starts without). Scripted clicks
  don't count. Actions that start playback probe for this first
  (`isPlaybackBlocked`); a blocked tab reports `playBlocked`, and the
  launcher offers Show Tab so the user can click play once.
- `src/main/youtube-music-search.ts` — search via YouTube Music's internal
  InnerTube API (`music/get_search_suggestions`, `search`), called from inside
  a YT Music tab so requests carry the user's session. Songs and videos are
  told apart from albums/playlists/profiles by `videoId` and
  `musicVideoType`, never by the localized "Song"/"Album" labels.
- `src/main/settings.ts` — user settings as JSON in the app's data folder
  (`~/Library/Application Support/Music Bar/settings.json`). `browsers` is the
  list chosen in setup; Music Bar only ever talks to those browsers, and to
  none until setup has run, so nobody gets permission prompts they didn't
  ask for.
- `src/main/setup-window.ts` + `src/renderer/setup.tsx` — first-run setup:
  choose browsers, then a live checklist per browser (open it, allow
  Automation, allow JavaScript from Apple Events). A normal window, not the
  launcher panel, because setup sends the user to browser menus and macOS
  prompts. It shows a Dock icon while open. Checks run one browser at a time
  so permission prompts come one by one. Until browsers are chosen, every
  way into the app opens setup. After that the same window opens as
  settings (`src/renderer/settings.tsx`, "Settings…" in the menu bar menu):
  a sidebar of sections (`SECTIONS`; add new kinds of settings there).
  Browsers switch on and off there, saved at once, with the same checks. To test a first run: quit Music Bar, then
  `rm ~/Library/Application\ Support/Music\ Bar/settings.json` and
  `tccutil reset AppleEvents dev.shrey.music-bar`.
- `src/main/frontmost-app.ts` — reads and restores the frontmost app through
  AppKit (JXA), no Automation permission needed. Opening YouTube Music brings
  the browser forward; this puts the user's app back in front.
- `src/main/login-item.ts` — open at login, as a LaunchAgent the app writes
  to `~/Library/LaunchAgents/dev.shrey.music-bar.plist` (the file existing
  is the setting). Not Electron's login item: on macOS 13+ it can't say the
  app was opened at login. launchd passes `--login`, and a login launch
  stays in the menu bar instead of showing the launcher. Packaged app only.
- `src/main/log.ts` — the log file, `~/Library/Logs/Music Bar/main.log`
  ("Show Log File" in the menu bar menu), to ask users for when something
  breaks. Log user actions (`handleAction` in `index.ts` does it for IPC),
  failures, and state changes, not every poll. Keep search queries and
  what's playing out of it.
- `src/preload/` — exposes `window.musicBar` via `contextBridge`.
- `src/shared/` — IPC channel names and the `MusicBarApi` type, shared by all
  processes. Add every new IPC channel here.
- `src/renderer/` — the launcher UI.
- `assets/` — `note.svg` is the logo's source. `scripts/build-icons.mjs` turns
  it into `icon.icns` (app icon on Apple's rounded tile) and
  `trayTemplate.png` / `@2x` (menu bar template image). The generated files
  are committed; rerun `pnpm icons` after changing `note.svg`.

## Conventions

- The app runs as a background (accessory) app: no Dock icon, tray item only.
- Always dark: `nativeTheme.themeSource = 'dark'` in main. Do not add a light theme yet.
- The launcher hides on blur and on Esc. Hiding through `hideLauncher()` also
  calls `app.hide()` so focus returns to the previous app.
- Renderer code never imports Electron; go through `window.musicBar`.
- One renderer serves every window: `main.tsx` renders setup for `#setup`,
  settings for `#settings`, else the launcher.
- Don't use `app.getFileIcon`: it crashes Electron on macOS 26. Use
  `nativeImage.createThumbnailFromPath` for app icons.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):
`<type>(<optional scope>): <summary>`, e.g. `feat(search): start radio from a
song`, `fix(open): return focus to the previous app`. Types: `feat`, `fix`,
`refactor`, `perf`, `style`, `docs`, `test`, `build`, `chore`. Summary in the
imperative, lower case, no trailing period.

## Releasing

`pnpm release minor` (or `patch`, `major`, or an exact `x.y.z`) on an
up-to-date `main` bumps `version` in `package.json`, commits
`chore(release): vX.Y.Z`, tags it `vX.Y.Z` and pushes both. The tag runs
`.github/workflows/release.yml` on GitHub's Apple silicon Macs: it builds
the DMG (`pnpm make`) and publishes a GitHub release with it attached as
`Music-Bar-X.Y.Z-arm64.dmg`. The notes come from `scripts/release-notes.mjs`:
the `feat`, `fix` and `perf` commit summaries since the previous tag, so
write those summaries for users. They end with install steps, including
Open Anyway, needed while the app isn't signed. Edit a release's notes on
GitHub afterwards if needed. Never move or reuse a published tag; release
a new patch instead.

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
