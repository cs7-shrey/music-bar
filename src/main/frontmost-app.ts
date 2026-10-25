import { execFile } from 'child_process'

// Reads and restores the frontmost app through AppKit (JXA), which needs no
// Automation permission, unlike asking System Events.

export interface FrontmostApp {
    pid: number
    bundleId: string
}

const ACTIVATE_TIMEOUT_MS = 1000
const ACTIVATE_POLL_MS = 50

function run(file: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(file, args, { timeout: 3000 }, (error, stdout) => {
            if (error) reject(error)
            else resolve(stdout.trim())
        })
    })
}

function jxa(script: string): Promise<string> {
    return run('osascript', ['-l', 'JavaScript', '-e', `ObjC.import('AppKit');\n${script}`])
}

export async function frontmostApp(): Promise<FrontmostApp | null> {
    try {
        const [pid, bundleId] = (
            await jxa(`const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
app.processIdentifier + '\\t' + (app.bundleIdentifier.js || '')`)
        ).split('\t')
        return Number(pid) ? { pid: Number(pid), bundleId } : null
    } catch {
        return null
    }
}

async function becameFrontmost(app: FrontmostApp): Promise<boolean> {
    const deadline = Date.now() + ACTIVATE_TIMEOUT_MS
    while (Date.now() < deadline) {
        if ((await frontmostApp())?.pid === app.pid) return true
        await new Promise((resolve) => setTimeout(resolve, ACTIVATE_POLL_MS))
    }
    return false
}

/**
 * Brings the app back to the front. macOS can turn down an activation
 * request from a background process, so if the app isn't in front within a
 * second, Launch Services is asked to open it, which always activates it.
 */
export async function activateApp(app: FrontmostApp): Promise<boolean> {
    try {
        await jxa(`$.NSRunningApplication.runningApplicationWithProcessIdentifier(${app.pid})
    .activateWithOptions($.NSApplicationActivateIgnoringOtherApps)`)
        if (await becameFrontmost(app)) return true
        if (!app.bundleId) return false
        await run('open', ['-b', app.bundleId])
        return await becameFrontmost(app)
    } catch {
        return false
    }
}
