// Builds the app icon and the menu bar icon from assets/note.svg.
//
//   pnpm icons
//
// Writes assets/icon.svg + assets/icon.icns (app icon on Apple's rounded
// tile), assets/mark.svg (the note on a circle, for use inside the app) and
// assets/trayTemplate.svg + trayTemplate.png / @2x.png (black on
// transparent, which macOS tints for light and dark menu bars), and
// assets/dmg-background.png / @2x.png (the installer window).
// For Linux: assets/icon.png (windows and the menu entry), assets/tray.png /
// @2x.png (the mark, which shows on light and dark panels; Linux can't tint
// a template), and extension/icon-128.png (the browser extension's icon).
// The .icns (iconutil) and the DMG background (set in Helvetica Neue) need
// macOS; elsewhere they're left as they are.

import { execFileSync } from 'child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Resvg } from '@resvg/resvg-js'

const ASSETS = join(import.meta.dirname, '..', 'assets')
const EXTENSION = join(import.meta.dirname, '..', 'extension')

// assets/note.svg, in drawing order: the note's body (stem, flag and head as
// one solid shape), the inside of the flag, the tick in the flag, the dot.
const source = readFileSync(join(ASSETS, 'note.svg'), 'utf8')
const [body, flagInside, tick] = [...source.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1])
const [, cx, cy, r] = source.match(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/).map(Number)
const [, noteWidth, noteHeight] = source.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number)
const dot = `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`

// Places the note centered in a square canvas, `width` units wide.
function placeNote(canvas, width) {
    const scale = width / noteWidth
    const x = (canvas - noteWidth * scale) / 2
    const y = (canvas - noteHeight * scale) / 2
    return `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(5)})`
}

// App icon: Apple's macOS grid, an 824 tile with 185 corners on a 1024
// canvas, plus the standard soft shadow under it.
const NOTE_SHARE_OF_TILE = 0.52
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    <defs>
        <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#1c1c1e"/>
            <stop offset="1" stop-color="#050505"/>
        </linearGradient>
        <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>
            <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.04"/>
            <stop offset="1" stop-color="#ffffff" stop-opacity="0.08"/>
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="12"/>
        </filter>
    </defs>
    <rect x="108" y="118" width="808" height="808" rx="185" fill="#000000" opacity="0.4" filter="url(#shadow)"/>
    <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#tile)"/>
    <rect x="101.5" y="101.5" width="821" height="821" rx="183.5" fill="none" stroke="url(#edge)" stroke-width="3"/>
    <g transform="${placeNote(1024, 824 * NOTE_SHARE_OF_TILE)}">
        <path d="${body} ${flagInside}" fill="#f2f2f2" fill-rule="evenodd"/>
        <path d="${tick}" fill="#f2f2f2"/>
        <path d="${dot}" fill="#c51234"/>
    </g>
</svg>
`

// In-app mark (the launcher footer): the note on a dark circle, edge to edge
// with no shadow, sized to read at 20px. The dot is cut out, as in the menu
// bar icon. The note leans 10° counterclockwise.
const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 824 824" width="824" height="824">
    <defs>
        <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#2a2a2d"/>
            <stop offset="1" stop-color="#0a0a0a"/>
        </linearGradient>
    </defs>
    <circle cx="412" cy="412" r="412" fill="url(#tile)"/>
    <circle cx="412" cy="412" r="398" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="28"/>
    <g transform="rotate(-10 412 412) ${placeNote(824, 824 * 0.52)}">
        <path d="${body} ${flagInside} ${dot}" fill="#f2f2f2" fill-rule="evenodd"/>
    </g>
</svg>
`

// Menu bar icon: one solid shape, with the flag's inside and the dot cut
// out. The tick is dropped; it's under a pixel at this size.
const TRAY_SIZE = 18
const tray = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TRAY_SIZE} ${TRAY_SIZE}" width="${TRAY_SIZE}" height="${TRAY_SIZE}">
    <g transform="${placeNote(TRAY_SIZE, 16 * (noteWidth / noteHeight))}">
        <path d="${body} ${flagInside} ${dot}" fill="#000000" fill-rule="evenodd"/>
    </g>
</svg>
`

// Installer (DMG) window: plain white, the app's icon beside an
// Applications shortcut with an arrow between them. White because Finder
// draws the icon names itself, in black in light mode. The window is
// DMG_WINDOW; Finder may still draw it bigger (it does on macOS 26), so the
// picture runs on past it. The icon centers here must match `contents` in
// forge.config.ts.
const DMG_WINDOW = { width: 640, height: 400 }
const DMG_CANVAS = { width: 1600, height: 1000 }
const DMG_APP = { x: 170, y: 180 }
const DMG_APPLICATIONS = { x: 470, y: 180 }
const arrowY = DMG_APP.y - 4
const dmgBackground = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DMG_CANVAS.width} ${DMG_CANVAS.height}" width="${DMG_CANVAS.width}" height="${DMG_CANVAS.height}">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <g fill="none" stroke="#b0b0b5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M${DMG_APP.x + 88} ${arrowY}H${DMG_APPLICATIONS.x - 88}"/>
        <path d="M${DMG_APPLICATIONS.x - 100} ${arrowY - 12}L${DMG_APPLICATIONS.x - 88} ${arrowY}L${DMG_APPLICATIONS.x - 100} ${arrowY + 12}"/>
    </g>
    <text x="${DMG_WINDOW.width / 2}" y="318" text-anchor="middle" font-family="Helvetica Neue" font-size="14" font-weight="500" fill="#8e8e93">Drag Music Bar onto Applications to install it</text>
</svg>
`

const render = (svg, size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()

writeFileSync(join(ASSETS, 'icon.svg'), icon)
writeFileSync(join(ASSETS, 'mark.svg'), mark)
writeFileSync(join(ASSETS, 'trayTemplate.svg'), tray)
writeFileSync(join(ASSETS, 'trayTemplate.png'), render(tray, TRAY_SIZE))
writeFileSync(join(ASSETS, 'trayTemplate@2x.png'), render(tray, TRAY_SIZE * 2))
// Linux panels draw tray icons at about 22px.
const LINUX_TRAY_SIZE = 22
writeFileSync(join(ASSETS, 'icon.png'), render(icon, 512))
writeFileSync(join(ASSETS, 'tray.png'), render(mark, LINUX_TRAY_SIZE))
writeFileSync(join(ASSETS, 'tray@2x.png'), render(mark, LINUX_TRAY_SIZE * 2))
writeFileSync(join(EXTENSION, 'icon-128.png'), render(icon, 128))

// The DMG's text is set in Helvetica Neue and the .icns needs iconutil, so
// both are macOS only; elsewhere they're left as they are.
if (process.platform !== 'darwin') {
    console.log('Wrote the PNGs; the .icns and DMG background need macOS, so they were left as they are')
    process.exit(0)
}

writeFileSync(join(ASSETS, 'dmg-background.png'), render(dmgBackground, DMG_CANVAS.width))
writeFileSync(join(ASSETS, 'dmg-background@2x.png'), render(dmgBackground, DMG_CANVAS.width * 2))

const iconset = join(tmpdir(), 'music-bar-icon.iconset')
rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset)
for (const size of [16, 32, 128, 256, 512]) {
    writeFileSync(join(iconset, `icon_${size}x${size}.png`), render(icon, size))
    writeFileSync(join(iconset, `icon_${size}x${size}@2x.png`), render(icon, size * 2))
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(ASSETS, 'icon.icns')])
rmSync(iconset, { recursive: true })
console.log('Wrote assets/icon.icns, assets/trayTemplate.png, assets/dmg-background.png and their @2x')
