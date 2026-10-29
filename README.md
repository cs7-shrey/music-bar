# Music Bar

A Raycast-style launcher for YouTube Music on the Mac. Press ⌘⇧Space
anywhere to see what's playing, skip, loop, start a radio, or search for a
song and play it, without leaving what you're doing.

Music Bar controls YouTube Music where it already plays: a tab in Brave,
Chrome or Helium. It has no player of its own, so your account, library,
queue and Premium all work as they do in the browser.

## Install

1. Download `Music-Bar-…-arm64.dmg` from the
   [latest release](https://github.com/cs7-shrey/music-bar/releases/latest)
   and open it.
2. Drag **Music Bar** onto **Applications**.
3. Open Music Bar from Applications. macOS will say it can't verify the app,
   because it isn't signed with an Apple Developer ID yet. Click **Done**.
4. Open **System Settings → Privacy & Security**, scroll down, and click
   **Open Anyway** next to Music Bar. Confirm, and it opens.

Needs a Mac with Apple silicon.

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

## Privacy

Music Bar has no servers, accounts, analytics or tracking. Everything stays
on your Mac and in your browser.

- It talks only to the browsers you turn on in setup, and in them only to
  YouTube Music tabs.
- Searches run inside your YouTube Music tab, the same requests the site
  makes when you search there. They go to YouTube, under your account, and
  nowhere else.
- Album art is downloaded from the image servers YouTube Music uses.
- Settings are in `~/Library/Application Support/Music Bar/`.
- A log for troubleshooting is in `~/Library/Logs/Music Bar/` (**Show Log
  File** in the menu bar menu). It records what Music Bar did and what went
  wrong, never your searches or what you're playing. It leaves your Mac
  only if you send it to someone.

## Build from source

Needs [pnpm](https://pnpm.io) and macOS.

```sh
pnpm install
pnpm dev      # run with live reload
pnpm make     # build the DMG into out/make
```

`AGENTS.md` describes how the code fits together.

## License

[MIT](LICENSE). Music Bar is not affiliated with or endorsed by YouTube or
Google.
