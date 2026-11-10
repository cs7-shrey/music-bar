// The native messaging host for Music Bar's browser extension (Linux). The
// browser starts it when the extension connects, and talks to it over
// stdin/stdout: each message is JSON after a 4-byte little-endian length.
// It relays those messages to the Music Bar app over a Unix socket that only
// this user can open, one JSON message per line, and back.
//
// Music Bar runs it through its own Electron binary as plain Node (see
// linux-bridge.ts), so it needs nothing else installed. It outlives Music
// Bar: while the app isn't running it keeps trying to reach it, so the
// extension stays connected and is ready the moment the app starts.

'use strict'

const net = require('net')
const os = require('os')
const path = require('path')

const RETRY_MS = 1000

const runtimeDir = process.env.XDG_RUNTIME_DIR || path.join(os.tmpdir(), `music-bar-${process.getuid()}`)
const socketPath = process.env.MUSIC_BAR_SOCKET || path.join(runtimeDir, 'music-bar', 'bridge.sock')

let socket = null

/** Browser → Music Bar: unframe stdin, forward each message as a line. */
let input = Buffer.alloc(0)
process.stdin.on('data', (chunk) => {
    input = Buffer.concat([input, chunk])
    while (input.length >= 4) {
        const length = input.readUInt32LE(0)
        if (input.length < 4 + length) break
        const message = input.subarray(4, 4 + length).toString('utf8')
        input = input.subarray(4 + length)
        // Replies with nowhere to go are dropped: Music Bar quit, and the
        // request they answer died with it.
        if (socket) socket.write(message.replace(/\n/g, ' ') + '\n')
    }
})
// The browser closed the port (the extension reloaded, or the browser quit).
process.stdin.on('end', () => process.exit(0))

/** Music Bar → browser: frame each line onto stdout. */
function send(line) {
    const body = Buffer.from(line, 'utf8')
    const header = Buffer.alloc(4)
    header.writeUInt32LE(body.length, 0)
    process.stdout.write(Buffer.concat([header, body]))
}

function connect() {
    const next = net.createConnection(socketPath)
    let buffered = ''
    next.setEncoding('utf8')
    next.on('connect', () => {
        socket = next
    })
    next.on('data', (chunk) => {
        buffered += chunk
        let newline
        while ((newline = buffered.indexOf('\n')) !== -1) {
            const line = buffered.slice(0, newline)
            buffered = buffered.slice(newline + 1)
            if (line) send(line)
        }
    })
    next.on('error', () => {})
    next.on('close', () => {
        if (socket === next) socket = null
        setTimeout(connect, RETRY_MS)
    })
}

connect()
