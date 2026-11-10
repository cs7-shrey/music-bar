// koffi (a foreign function interface) reaches macOS's Objective-C runtime and
// private CoreGraphics calls (system-dialog.ts, system-shortcuts.ts). It's
// loaded on first use, not imported, so other platforms never load its
// native binary; only the Mac ones are packaged (forge.config.ts).
export type Koffi = typeof import('koffi')

export function loadKoffi(): Koffi {
    if (process.platform !== 'darwin') throw new Error('koffi is only used on macOS')
    // Left out of the Vite bundle (vite.main.config.mjs), so this stays a
    // plain require of the packaged module.
    return require('koffi') as Koffi
}
