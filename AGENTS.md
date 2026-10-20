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
