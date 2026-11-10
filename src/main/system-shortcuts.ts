import { loadKoffi } from './koffi'
import { describe, logger } from './log'

// Borrows a key combination from macOS's own shortcuts while Music Bar runs.
// macOS 27 gives ⌘⇧Space to Siri ("Ask about the active window"), and a
// system shortcut wins over an app's, so the launcher's would never fire.
// This turns the system one off through the private CoreGraphics call AltTab
// uses for ⌘Tab, and back on when Music Bar quits.
//
// The switch is system-wide and outlasts the process: if Music Bar crashes,
// the system shortcut stays off until Music Bar next starts and quits, or
// until logout. The user's setting in System Settings is never changed.

const log = logger('system-shortcuts')

// Carbon key code and the CGS modifier flags for the keys Music Bar borrows.
const KEY_CODES: Record<string, number> = { Space: 49 }
const MODIFIER_FLAGS: Record<string, number> = { Shift: 0x20000, Control: 0x40000, Alt: 0x80000, Command: 0x100000 }
// Symbolic hotkey ids run to about 300 today; leave room.
const MAX_HOTKEY_ID = 1024

let cgs: {
    getValue: (id: number, character: number[], keyCode: number[], modifiers: number[]) => number
    isEnabled: (id: number) => boolean
    setEnabled: (id: number, enabled: boolean) => number
} | null = null

function loadCgs(): NonNullable<typeof cgs> {
    if (cgs) return cgs
    const lib = loadKoffi().load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
    cgs = {
        getValue: lib.func('int CGSGetSymbolicHotKeyValue(int, _Out_ uint16_t *, _Out_ uint16_t *, _Out_ uint32_t *)'),
        isEnabled: lib.func('bool CGSIsSymbolicHotKeyEnabled(int)'),
        setEnabled: lib.func('int CGSSetSymbolicHotKeyEnabled(int, bool)'),
    }
    return cgs
}

// Ids this run turned off, to turn back on at quit.
const borrowed = new Set<number>()

/**
 * Turns off every enabled system shortcut on `accelerator` (an Electron
 * accelerator such as "Command+Shift+Space"). Returns false if that couldn't
 * be done, and the accelerator likely won't reach Music Bar.
 */
export function borrowSystemShortcut(accelerator: string): boolean {
    // Only macOS has system shortcuts that outrank an app's.
    if (process.platform !== 'darwin') return true
    const parts = accelerator.split('+')
    const keyCode = KEY_CODES[parts.at(-1) ?? '']
    const modifiers = parts.slice(0, -1).reduce((flags, part) => flags | (MODIFIER_FLAGS[part] ?? NaN), 0)
    if (keyCode === undefined || Number.isNaN(modifiers)) {
        log.warn(`can't look up system shortcuts for ${accelerator}`)
        return false
    }
    try {
        const { getValue, isEnabled, setEnabled } = loadCgs()
        for (let id = 0; id < MAX_HOTKEY_ID; id++) {
            const key = [0]
            const flags = [0]
            if (getValue(id, [0], key, flags) !== 0 || key[0] !== keyCode || flags[0] !== modifiers) continue
            if (!isEnabled(id)) continue
            if (setEnabled(id, false) !== 0) throw new Error(`system shortcut ${id} didn't turn off`)
            borrowed.add(id)
            log.info(`turned off system shortcut ${id} (${accelerator}) while Music Bar runs`)
        }
        return true
    } catch (error) {
        log.warn(`couldn't turn off the system shortcut on ${accelerator}: ${describe(error)}`)
        return false
    }
}

/** Turns the borrowed system shortcuts back on. Run at quit. */
export function returnSystemShortcuts(): void {
    if (borrowed.size === 0) return
    try {
        const { setEnabled } = loadCgs()
        for (const id of borrowed) setEnabled(id, true)
        log.info(`turned system shortcuts back on: ${[...borrowed].join(', ')}`)
        borrowed.clear()
    } catch (error) {
        log.warn(`couldn't turn system shortcuts back on: ${describe(error)}`)
    }
}
