# Music Bar

A Raycast-style launcher for YouTube Music on the Mac and Linux. Press
⌘⇧Space anywhere to see what's playing, skip, loop, start a radio, or
search for a song and play it, without leaving what you're doing.

Music Bar controls YouTube Music where it already plays: a tab in Brave,
Chrome or Helium (on Linux: Brave, Chrome or Chromium). It has no player of
its own, so your account, library, queue and Premium all work as they do in
the browser.

## Install

1. Download `Music-Bar-…-arm64.dmg` from the
   [latest release](https://github.com/cs7-shrey/music-bar/releases/latest)
   and open it.
2. Drag **Music Bar** onto **Applications**.
3. Open Music Bar from Applications.

Needs a Mac with Apple silicon. For Linux, see [Linux](#linux).

## Set up

Music Bar opens a setup window the first time. Choose the browsers you use
YouTube Music in, then, for each one:

1. **Open the browser.**
2. **Allow Automation.** macOS asks whether Music Bar may control the
   browser. Click Allow.
3. **Allow JavaScript from Apple Events.** In the browser's menu bar, choose
   **View → Developer → Allow JavaScript from Apple Events**. This lets
   Music Bar read and press the player in the YouTube Music tab.

The setup window ticks each step off as it happens. Change browsers later
in **Settings…** (⌘,) from the music note in the menu bar.

## Use

Press **⌘⇧Space** to open Music Bar. Type to search.

| Keys | Does |
|---|---|
| ⌘H / ⌘L | Previous / next |
| ⌘O | Loop |
| ⌘R | Start a radio from the song that's playing |
| ↵ | Play the search result |
| ⇧↵ | Play it next |
| ⌘↵ | Start a radio from it |
| ⌘, | Settings |
| esc | Back, clear, or close |

Music Bar can open at login, quietly in the menu bar (Settings → General).

On macOS 27, ⌘⇧Space belongs to Siri's "Ask about the active window".
Music Bar switches that shortcut off while it runs and back on when it
quits. Your setting in System Settings isn't changed.

Browsers don't let a page start sound until you've clicked in it once. If
Music Bar can't start playback, it offers **Show Tab**: click play there
once, and it works from then on.

## Linux

On Linux, Music Bar reaches YouTube Music through its own browser
extension instead of AppleScript. Everything else works the same, with
Ctrl wherever the Mac uses ⌘ (Ctrl+H / Ctrl+L, Ctrl+O, Ctrl+R, Ctrl+↵, …).

### Install

- **Debian, Ubuntu:** download `music-bar_…_amd64.deb` from the
  [latest release](https://github.com/cs7-shrey/music-bar/releases/latest),
  then `sudo apt install ./music-bar_…_amd64.deb`.
- **NixOS:** the repository is a flake. Try it with
  `nix run github:cs7-shrey/music-bar`, or add it to your configuration:

  ```nix
  # flake.nix
  inputs.music-bar.url = "github:cs7-shrey/music-bar";
  inputs.music-bar.inputs.nixpkgs.follows = "nixpkgs";

  # configuration.nix, or home.packages in home-manager
  environment.systemPackages = [ inputs.music-bar.packages.${pkgs.system}.default ];
  ```

  There's also `overlays.default`, which adds `pkgs.music-bar`.

### Set up

The setup window walks you through it, for each browser you choose:

1. **Open the browser.**
2. **Add the Music Bar extension.** Open the browser's extensions page
   (setup has a button for it), turn on **Developer mode**, click **Load
   unpacked**, and choose the folder setup shows
   (`~/.config/Music Bar/extension`; **Copy Folder Path**, then Ctrl+L in
   the file picker to paste it). Music Bar keeps that folder up to date and
   reloads the extension when it changes.
3. **Allow User Scripts.** On the extension's **Details** page, turn on
   **Allow User Scripts**. That's how it runs Music Bar's scripts in YouTube
   Music tabs. It has no access to any other site.

### The shortcut

On X11, Music Bar opens with **Ctrl+Shift+Space**. Wayland doesn't let apps
take a key for themselves, so there you bind one to `music-bar --toggle`
in your desktop's keyboard settings:

- **GNOME:** Settings → Keyboard → View and Customize Shortcuts → Custom
  Shortcuts.
- **KDE Plasma:** System Settings → Keyboard → Shortcuts → Add New →
  Command or Script.
- **Hyprland:** it floats the launcher by itself (a fixed-size window), so
  only the key is needed. In `hyprland.conf`:

  ```
  bind = CTRL SHIFT, SPACE, exec, music-bar --toggle
  ```

  or with the Lua config (0.55+):

  ```lua
  hl.bind("CTRL + SHIFT + SPACE", hl.dsp.exec_cmd("music-bar --toggle"))
  ```

  The launcher closes when it loses focus. With `follow_mouse = 1`, moving
  the mouse off it moves focus too; a `stayfocused` rule for the title
  `Music Bar Launcher` keeps it until you press Esc or the key again.

- **Sway:**

  ```
  bindsym Ctrl+Shift+Space exec music-bar --toggle
  for_window [title="^Music Bar Launcher$"] floating enable, border none
  ```

**Open at login** (Settings → General) adds Music Bar to
`~/.config/autostart`, which GNOME, KDE and Xfce read. Window managers
without XDG autostart (Hyprland, Sway) need `music-bar --login` in their
own autostart (`exec-once`, `exec`); it starts quietly in the tray.

## Privacy

Music Bar has no servers, accounts, analytics or tracking. Everything stays
on your Mac and in your browser.

- It talks only to the browsers you turn on in setup, and in them only to
  YouTube Music tabs.
- Searches run inside your YouTube Music tab, the same requests the site
  makes when you search there. They go to YouTube, under your account, and
  nowhere else.
- Album art is downloaded from the image servers YouTube Music uses.
- Settings are in `~/Library/Application Support/Music Bar/` (Linux:
  `~/.config/Music Bar/`).
- A log for troubleshooting is in `~/Library/Logs/Music Bar/` (Linux:
  `~/.config/Music Bar/logs/`; **Show Log File** in the menu bar menu). It records what Music Bar did and what went
  wrong, never your searches or what you're playing. It leaves your Mac
  only if you send it to someone.

## Build from source

Needs [pnpm](https://pnpm.io), and macOS or Linux.

```sh
pnpm install
pnpm dev      # run with live reload
pnpm make     # build the DMG (macOS) or .deb (Linux; needs dpkg and fakeroot) into out/make
```

On NixOS, `nix develop` gives you all of that, with nixpkgs' Electron for
`pnpm dev` (the one Electron's npm package downloads doesn't run there).
`nix build` builds the package.

`AGENTS.md` describes how the code fits together.

## License

[MIT](LICENSE). Music Bar is not affiliated with or endorsed by YouTube or
Google.
