import { app } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'

// A log file to ask users for when something goes wrong:
// ~/Library/Logs/Music Bar/main.log, the macOS place for app logs (it shows
// in Console.app, and the user owns it, so writing needs no permission).
// Past MAX_BYTES it moves to main.old.log and a new one starts, so the two
// together hold the recent past and never grow beyond twice that.
// Writes are synchronous, so the lines before a crash make it to disk.

const MAX_BYTES = 5 * 1024 * 1024

type Level = 'INFO' | 'WARN' | 'ERROR'

let file: string | null = null
let size = 0

export const logFile = () => join(app.getPath('logs'), 'main.log')

function open(): string {
    if (file) return file
    file = logFile()
    mkdirSync(join(file, '..'), { recursive: true })
    try {
        size = statSync(file).size
    } catch {
        size = 0
    }
    return file
}

/** Error stacks, and anything else as JSON. */
function format(detail: unknown): string {
    if (detail instanceof Error) return detail.stack ?? `${detail.name}: ${detail.message}`
    if (typeof detail === 'string') return detail
    try {
        return JSON.stringify(detail)
    } catch {
        return String(detail)
    }
}

function write(level: Level, scope: string, message: string, details: unknown[]): void {
    const parts = details.filter((detail) => detail !== '').map(format)
    const line = [new Date().toISOString(), level.padEnd(5), `[${scope}]`, message, ...parts].join(' ') + '\n'
    // In development, the terminal running the app shows it too.
    if (!app.isPackaged) (level === 'INFO' ? console.log : console.warn)(line.trimEnd())
    try {
        const path = open()
        if (size + line.length > MAX_BYTES) {
            renameSync(path, join(path, '..', 'main.old.log'))
            size = 0
        }
        appendFileSync(path, line)
        size += Buffer.byteLength(line)
    } catch {
        // Nowhere left to report a failed log write.
    }
}

/** A logger whose lines are tagged with where they came from. */
export function logger(scope: string) {
    return {
        info: (message: string, ...details: unknown[]) => write('INFO', scope, message, details),
        warn: (message: string, ...details: unknown[]) => write('WARN', scope, message, details),
        error: (message: string, ...details: unknown[]) => write('ERROR', scope, message, details),
    }
}

/** Error messages for a log line, without the stack. */
export const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))
