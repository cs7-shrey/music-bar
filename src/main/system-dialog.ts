import type { BrowserWindow } from 'electron'
import koffi from 'koffi'
import { describe, logger } from './log'

// Marks a window as a "system dialog" for macOS accessibility, the way
// Raycast marks its launcher. Window managers read the accessibility subrole
// to decide what to manage: Electron's windows all say "standard window", so
// AeroSpace managed the launcher, gave it a workspace, and switched to that
// workspace whenever it took the keyboard. A system dialog it leaves alone.
// Electron has no option for this, so it's set through the Objective-C
// runtime: [[view window] setAccessibilitySubrole:@"AXSystemDialog"].

const log = logger('system-dialog')

export function markAsSystemDialog(window: BrowserWindow): void {
    try {
        const objc = koffi.load('/usr/lib/libobjc.A.dylib')
        const selector = objc.func('void *sel_registerName(const char *)')
        const getClass = objc.func('void *objc_getClass(const char *)')
        const send = objc.func('objc_msgSend', 'void *', ['void *', 'void *'])
        const sendObject = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'void *'])
        const sendString = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'const char *'])

        const view = koffi.decode(window.getNativeWindowHandle(), 'void *')
        const nsWindow = send(view, selector('window'))
        const subrole = sendString(getClass('NSString'), selector('stringWithUTF8String:'), 'AXSystemDialog')
        sendObject(nsWindow, selector('setAccessibilitySubrole:'), subrole)
    } catch (error) {
        log.warn(`couldn't mark the launcher as a system dialog: ${describe(error)}`)
    }
}
