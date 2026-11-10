# Music Bar

Raycast-style launcher (⌘⇧Space) for controlling YouTube Music playing in a
Chromium browser (Brave first, also Chrome and Helium; on Linux, Brave,
Chrome and Chromium). macOS first; Linux too (Debian package, Nix flake).

## Package manager

Use **pnpm** for everything. Do not use npm or yarn, and do not commit a
`package-lock.json` or `yarn.lock`.

- `pnpm install`
- `pnpm dev` — run the app with Vite HMR (Electron Forge)
- `pnpm typecheck` — typecheck main/preload and renderer
- `pnpm build` / `pnpm make` — package the app / build the DMG and zip
  (macOS) or the .deb (Linux, needs `dpkg` and `fakeroot`)
- `pnpm icons` — regenerate the app icon and menu bar icon from `assets/note.svg`
- `pnpm release <patch|minor|major|x.y.z>` — cut a release (see Releasing)

`pnpm-workspace.yaml` sets `nodeLinker: hoisted` because Electron Forge's
packager needs a flat `node_modules` (pnpm 11+ ignores it in `.npmrc`). It
also lists the dependencies allowed to run install scripts (`allowBuilds`);
pnpm skips any other's and fails the install. Electron 44 downloads its
binary on first launch, not at install time.

## Stack

Electron Forge + Vite, React 19, Tailwind CSS v4, `cmdk` for the command list,
`lucide-react` for icons. Browser control is AppleScript via `osascript` on
macOS, and a browser extension on Linux (see Linux below).

## Layout

- `src/main/` — Electron main process. `launcher-window.ts` owns the floating
  panel (show/hide/position); `index.ts` wires the global shortcut and tray.
- `src/main/youtube-music.ts` — the YouTube Music bridge. Runs JavaScript in
  YT Music tabs (works on background tabs) through a `TabTransport`
  (`tab-transport.ts`), the one platform-specific layer: listing tabs,
  running a script in one, showing a tab and switching back, opening one.
  Everything above it (following tabs, waking, the autoplay probe, every
  script) is shared, so a feature written once works on both.
- `src/main/mac-transport.ts` — macOS: each browser's AppleScript `execute
  javascript`. Requires View → Developer → Allow JavaScript from Apple
  Events in each browser. Scripts address each browser by bundle id
  (`BUNDLE_IDS`), never by name: macOS can resolve a name like "Brave
  Browser" to another app (Helium, on one Mac). No accessibility tree:
  Chromium only exposes the front tab's page to it.
  Scripts run in the browser's isolated world: DOM and cookies are shared
  with the page, page globals (`ytcfg`, etc.) are not. `execute javascript`
  cannot await; use `evaluateAsyncInTab` for anything async.
  Browsers refuse to start sound in a page the user hasn't clicked or typed
  in, unless the site has enough "media engagement" (Chrome ships it for
  YouTube Music, Brave earns it, Helium starts without). Scripted clicks
  don't count. Actions that start playback probe for this first
  (`isPlaybackBlocked`); a blocked tab reports `playBlocked`, and the
  launcher offers Show Tab so the user can click play once.
- `src/main/linux-transport.ts` + `extension/` + `native-host/` — Linux.
  The Music Bar extension (MV3, loaded unpacked, id fixed by `key` in its
  manifest) runs scripts with `chrome.userScripts.execute` in the user
  script world, the counterpart of the AppleScript world, and talks to the
  app through native messaging: the browser starts
  `native-host/music-bar-host.js` (Music Bar's own Electron run as Node,
  through a script the app writes to its data folder), which relays to a
  Unix socket in `$XDG_RUNTIME_DIR/music-bar/` (0700). At each start the
  app copies the extension to `~/.config/Music Bar/extension` (the path the
  user loads, stable across updates), registers the host in every
  supported browser's `NativeMessagingHosts`, and has an outdated extension
  reload itself. The extension can only reach music.youtube.com (its only
  host permission). It relaxes its user script world's CSP to allow inline
  scripts, or `inPageWorld` can't add its `<script>`. Setup's states:
  `needs-extension` (not installed or not connected), `needs-setup` ("Allow
  User Scripts" is off). Browsers are found on `PATH`, running ones in
  `/proc`, icons in the icon theme.
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
  so permission prompts come one by one. Setup ends on a screen that asks
  for ⌘⇧Space (`awaitingShortcut` in settings); the first press closes
  setup and opens the launcher. Until browsers are chosen, and then until
  that first press, every way into the app opens setup. After that the same window opens as
  settings (`src/renderer/settings.tsx`, "Settings…" in the menu bar menu):
  a sidebar of sections (`SECTIONS`; add new kinds of settings there).
  Browsers switch on and off there, saved at once, with the same checks. To test a first run: quit Music Bar, then
  `rm ~/Library/Application\ Support/Music\ Bar/settings.json` and
  `tccutil reset AppleEvents dev.shrey.music-bar`.
- `src/main/frontmost-app.ts` — reads and restores the frontmost app through
  AppKit (JXA), no Automation permission needed. macOS only. Opening YouTube Music brings
  the browser forward; this puts the user's app back in front.
- `src/main/login-item.ts` — open at login, as a LaunchAgent the app writes
  to `~/Library/LaunchAgents/dev.shrey.music-bar.plist` (the file existing
  is the setting). Not Electron's login item: on macOS 13+ it can't say the
  app was opened at login. launchd passes `--login`, and a login launch
  stays in the menu bar instead of showing the launcher. Packaged app only.
  Linux: an XDG autostart entry, `~/.config/autostart/music-bar.desktop`.
- `src/main/system-shortcuts.ts`, `src/main/system-dialog.ts` — macOS only,
  through `koffi` (`src/main/koffi.ts` loads it on first use, never on
  Linux, which doesn't ship its binaries). macOS 27 gives ⌘⇧Space to Siri, and a
  system shortcut beats an app's. Music Bar turns the system one off while it
  runs and back on at quit, through private CoreGraphics calls
  (`CGSSetSymbolicHotKeyEnabled`, as AltTab does for ⌘Tab) found by key
  combination, not id. It's system-wide and outlives a crash until the next
  launch or logout. If it fails, ⌥⇧Space is registered as well.
- `src/main/updater.ts` — auto-update through Electron's `autoUpdater`
  (Squirrel.Mac) and update.electronjs.org, which serves the zip attached
  to each GitHub release; it needs the repo public and the app signed.
  Checks hourly in packaged builds run from Applications, downloads in the
  background, then offers "Restart to Update" in the menu bar menu, as a
  launcher row, and on the launcher footer's mark (`UpdateMark` in
  `App.tsx`: a red dot and a periodic note-to-reload animation, held while
  hovered). Squirrel only installs an update signed by the same
  Developer ID.
- `src/main/resources.ts` — files shipped beside the app (`extraResource`):
  read them with `resourcePath()`, which finds them next to `app.asar` (Nix
  runs the app with a shared Electron, so not `process.resourcesPath`).
- `src/main/log.ts` — the log file, `~/Library/Logs/Music Bar/main.log`
  (Linux: `~/.config/Music Bar/logs/main.log`)
  ("Show Log File" in the menu bar menu), to ask users for when something
  breaks. Log user actions (`handleAction` in `index.ts` does it for IPC),
  failures, and state changes, not every poll. Keep search queries and
  what's playing out of it.
- `src/preload/` — exposes `window.musicBar` via `contextBridge`.
- `src/shared/` — IPC channel names and the `MusicBarApi` type, shared by all
  processes. Add every new IPC channel here.
- `src/renderer/` — the launcher UI. `platform.ts` has what differs: write
  shortcuts the macOS way (`'⌘⇧O'`) and show them with `keys()`; read ⌘ with
  `hasModifier()` (Ctrl on Linux).
- `nix/package.nix` + `flake.nix` — the Nix package: built from source with
  Forge, given nixpkgs' Electron as the zip to package
  (`MUSIC_BAR_ELECTRON_ZIP_DIR`), and run with that Electron. Update its
  `hash` when `pnpm-lock.yaml` changes (`nix build` prints the new one).
- `assets/` — `note.svg` is the logo's source. `scripts/build-icons.mjs` turns
  it into `icon.icns` (app icon on Apple's rounded tile) and
  `trayTemplate.png` / `@2x` (menu bar template image), and
  `dmg-background.png` / `@2x` (the installer window). The generated files
  are committed; rerun `pnpm icons` after changing `note.svg`. Linux gets
  `icon.png`, `tray.png` / `@2x` (the mark, as Linux panels can't tint a
  template) and `extension/icon-128.png`; the .icns and DMG background are
  only rendered on macOS.

## Conventions

- Linux: Ctrl does what ⌘ does. There's no app menu (it would show as a
  bar in each window), so the launcher handles Ctrl+, itself. Wayland
  compositors don't give apps global keys or window placement: the
  launcher opens from `music-bar --toggle` (the single-instance hand-off,
  `TOGGLE_FLAG` in `index.ts`), bound to a key by the user, and its window
  is titled `Music Bar Launcher` (`LAUNCHER_TITLE`) for float rules.

- The app runs as a background (accessory) app: no Dock icon, tray item only.
- Always dark: `nativeTheme.themeSource = 'dark'` in main. Do not add a light theme yet.
- The launcher hides on blur and on Esc. Hiding through `hideLauncher()` also
  calls `app.hide()` so focus returns to the previous app.
- The launcher must look like a popup to window managers, as Raycast's does:
  borderless (`roundedCorners: false`, so no hidden close button) and marked
  `AXSystemDialog` (`src/main/system-dialog.ts`, through `koffi`). Otherwise
  AeroSpace manages it, gives it a workspace, and switches to that workspace
  each time it opens. `koffi` loads a native binary, so it's left out of the
  Vite bundle and copied into the package by `packageAfterCopy` in
  `forge.config.ts`.
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
`Music-Bar-X.Y.Z-arm64.dmg`, plus `Music-Bar-darwin-arm64-X.Y.Z.zip` for
auto-update. A second job then builds `music-bar_X.Y.Z_amd64.deb` on
Ubuntu and attaches it. Linux has no auto-update: users update the .deb or
their flake input. A release is what every installed copy updates to within an
hour, so don't publish one that isn't ready. The notes come from `scripts/release-notes.mjs`:
the `feat`, `fix` and `perf` commit summaries since the previous tag, so
write those summaries for users. They end with install steps. Edit a
release's notes on GitHub afterwards if needed. Never move or reuse a
published tag; release a new patch instead.

The website (`../music-bar-website`, its own repo) links its download
button to the DMG of one release, through `VERSION` in
`src/app/page.tsx`. Once a release is published on GitHub (the workflow
passed and the DMG is attached), set `VERSION` there to the new version,
commit `chore: link the download to vX.Y.Z` and push. Not before: the link
would point at a DMG that doesn't exist yet.

Releases are signed with a Developer ID certificate and notarized
(`osxSign`, `osxNotarize` and the `postMake` hook in `forge.config.ts`), so
they open without Gatekeeper warnings. The app runs with the hardened
runtime; its entitlements are in `entitlements.plist` (JIT for V8, Apple
Events for AppleScript). Add one there for anything else the hardened
runtime blocks. The workflow reads these repository secrets:
`MACOS_CERT_P12` (the certificate and key as a base64 `.p12`),
`MACOS_CERT_PASSWORD`, and the App Store Connect API key for notarization:
`APPLE_API_KEY_P8` (the `.p8` file's text), `APPLE_API_KEY_ID`,
`APPLE_API_ISSUER`. It fails rather than publish an unnotarized build
(`MUSIC_BAR_REQUIRE_NOTARIZATION`). `pnpm make` on a Mac with the
certificate in its keychain signs too; it notarizes when `APPLE_API_KEY`
(a path to the `.p8`), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` are set.
Without the certificate it signs ad-hoc, which runs locally but needs Open
Anyway when downloaded. A new signature changes the app's identity for
macOS permissions, so the first signed release asks for Automation again.

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
| One-off with a busy state | Ignore presses while it runs. | flag, e.g. `loadingTab`, `openingIn`, `openingTab` | Load an inactive tab, open YouTube Music in a browser, go to the playing tab (cover, ⌘⇧O) |

Also:
- Main runs actions one at a time in order (`enqueue` in `youtube-music.ts`),
  so even un-debounced presses reach the page in sequence.
- Every action bumps `actionSeq`, so reads that started before it are
  discarded and can't overwrite the optimistic UI.
- Search requests are debounced too (200ms, `useSuggestions` in `search.tsx`).
- Until the first read after each open lands (`syncing`), the card shows
  state from the last open. Actions that depend on it (play/pause, loop,
  radio, going to the tab) are queued instead (`queue`): the button stays pressed, a second
  press does nothing, and the action runs on the fresh state. So ↵ on
  "Pause" right after a media key started playback pauses. Play/pause also
  waits while a song loads (`isLoading`, shown as "Fetching…"): the page
  reports a loading song as neither playing nor paused, and a tab too busy
  to answer gives back its last read marked the same way.
