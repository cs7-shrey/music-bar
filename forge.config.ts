import { execFileSync } from 'child_process'
import { cpSync } from 'fs'
import { join } from 'path'
import type { ForgeConfig } from '@electron-forge/shared-types'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { MakerDeb } from '@electron-forge/maker-deb'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerZIP } from '@electron-forge/maker-zip'
import { notarize } from '@electron/notarize'

// Signing: Developer ID, whenever the certificate is in a keychain (yours,
// or the one the release workflow imports it into). Otherwise ad-hoc, which
// runs locally but makes downloads need Open Anyway.
const SIGNING_IDENTITY = 'Developer ID Application: Shrey Singh (VF8SH989TV)'
const canSign = (() => {
    try {
        return execFileSync('security', ['find-identity', '-v', '-p', 'codesigning']).toString().includes(SIGNING_IDENTITY)
    } catch {
        return false
    }
})()

// Notarization: Apple scans the signed app and DMG so Gatekeeper opens them
// without a warning. Needs an App Store Connect API key: APPLE_API_KEY (path
// to the .p8), APPLE_API_KEY_ID and APPLE_API_ISSUER.
const { APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER } = process.env
const notarizeWith =
    canSign && APPLE_API_KEY && APPLE_API_KEY_ID && APPLE_API_ISSUER
        ? { appleApiKey: APPLE_API_KEY, appleApiKeyId: APPLE_API_KEY_ID, appleApiIssuer: APPLE_API_ISSUER }
        : undefined

// The release workflow sets this, so a release can't ship unsigned by accident.
if (process.env.MUSIC_BAR_REQUIRE_NOTARIZATION && !notarizeWith) {
    throw new Error(
        canSign
            ? 'Notarization needs APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER.'
            : `No "${SIGNING_IDENTITY}" certificate in the keychain.`,
    )
}

const isLinux = process.platform === 'linux'

const config: ForgeConfig = {
    packagerConfig: {
        name: 'Music Bar',
        appBundleId: 'dev.shrey.music-bar',
        // Linux commands don't have spaces; the .deb's /usr/bin/music-bar.
        ...(isLinux && { executableName: 'music-bar' }),
        // Native binaries can't be loaded from inside the archive.
        asar: { unpack: '**/*.node' },
        // Generated from assets/note.svg by `pnpm icons`.
        icon: 'assets/icon',
        // Read through resourcePath() in src/main/resources.ts. Linux also
        // carries the browser extension and its native messaging host (see
        // src/main/linux-transport.ts), and icons for the tray and windows.
        extraResource: isLinux
            ? ['assets/tray.png', 'assets/tray@2x.png', 'assets/icon.png', 'extension', 'native-host/music-bar-host.js']
            : ['assets/trayTemplate.png', 'assets/trayTemplate@2x.png'],
        // Builds without network access (the Nix package) hand the packager
        // an Electron zip of their own instead of having it download one.
        ...(process.env.MUSIC_BAR_ELECTRON_ZIP_DIR && { electronZipDir: process.env.MUSIC_BAR_ELECTRON_ZIP_DIR }),
        extendInfo: {
            // Menu-bar style app: no Dock icon, no app switcher entry.
            LSUIElement: true,
            NSAppleEventsUsageDescription:
                'Music Bar controls YouTube Music in your browser to show and change what is playing.',
        },
        // Hardened runtime on every binary (osx-sign's default), koffi's
        // included. The app itself gets entitlements.plist; helpers keep
        // osx-sign's per-helper defaults.
        osxSign: canSign
            ? {
                  identity: SIGNING_IDENTITY,
                  optionsForFile: (filePath) =>
                      filePath.endsWith('Music Bar.app') ? { entitlements: 'entitlements.plist' } : {},
              }
            : undefined,
        // Notarizes the app and staples the ticket to it, so it opens offline too.
        osxNotarize: notarizeWith,
    },
    makers: [
        // What users download: opens to the app beside an Applications
        // shortcut to drag it onto. The background and its layout come from
        // `pnpm icons` (DMG_* in scripts/build-icons.mjs).
        new MakerDMG({
            icon: 'assets/icon.icns',
            background: 'assets/dmg-background.png',
            iconSize: 112,
            additionalDMGOptions: {
                window: { size: { width: 640, height: 400 } },
                ...(canSign && { 'code-sign': { 'signing-identity': SIGNING_IDENTITY, identifier: 'dev.shrey.music-bar.dmg' } }),
            },
            contents: (opts) => [
                { type: 'file', path: opts.appPath, x: 170, y: 180 },
                { type: 'link', path: '/Applications', x: 470, y: 180 },
                // Hidden files, out of sight for anyone who shows them.
                { type: 'position', path: '.background', x: 170, y: 900 },
                { type: 'position', path: '.VolumeIcon.icns', x: 470, y: 900 },
            ],
        }),
        // What auto-update downloads (src/main/updater.ts).
        new MakerZIP({}, ['darwin']),
        // Debian and Ubuntu: installs to /usr/lib/music-bar, with a
        // music-bar command and a menu entry. Needs dpkg and fakeroot.
        new MakerDeb({
            options: {
                name: 'music-bar',
                productName: 'Music Bar',
                genericName: 'Music Controller',
                description: 'Raycast-style launcher for YouTube Music in your browser',
                productDescription:
                    'Press a shortcut anywhere to see what is playing, skip, loop, start a radio, or search for a song and play it. Music Bar controls YouTube Music in Brave, Chrome or Chromium through its browser extension.',
                categories: ['AudioVideo', 'Audio'],
                icon: 'assets/icon.png',
                homepage: 'https://github.com/cs7-shrey/music-bar',
                maintainer: 'Shrey Singh (https://github.com/cs7-shrey)',
                section: 'sound',
            },
        }),
    ],
    hooks: {
        // The Vite plugin packages only the bundled code, not node_modules.
        // koffi loads a native binary, so it isn't bundled (see
        // vite.main.config.mjs) and is copied in here, with just the Mac
        // binaries out of its 28MB of platforms.
        packageAfterCopy: async (_config, buildPath, _electronVersion, platform) => {
            // Only macOS loads koffi (src/main/koffi.ts).
            if (platform !== 'darwin') return
            const from = join(process.cwd(), 'node_modules/koffi')
            const to = join(buildPath, 'node_modules/koffi')
            for (const file of ['package.json', 'index.js', 'build/koffi/darwin_arm64', 'build/koffi/darwin_x64']) {
                cpSync(join(from, file), join(to, file), { recursive: true })
            }
        },
        // Without the certificate: packaging renames Electron's app and edits
        // its Info.plist and icon, which breaks the ad-hoc signature Electron
        // ships with. A downloaded copy then fails Gatekeeper as "damaged".
        // Re-sign ad-hoc over the final files so it gets the "Open Anyway"
        // prompt instead. With the certificate, osxSign has signed it already.
        postPackage: async (config, { outputPaths, platform }) => {
            if (platform !== 'darwin' || canSign) return
            const appName = `${config.packagerConfig.name}.app`
            for (const outputPath of outputPaths) {
                execFileSync('codesign', ['--force', '--deep', '--sign', '-', join(outputPath, appName)])
            }
        },
        // The DMG is notarized too (the app inside already is), and stapled,
        // so the download opens without a check against Apple's servers.
        postMake: async (_config, results) => {
            if (!notarizeWith) return results
            for (const artifact of results.flatMap((result) => result.artifacts)) {
                if (artifact.endsWith('.dmg')) await notarize({ appPath: artifact, ...notarizeWith })
            }
            return results
        },
    },
    plugins: [
        new VitePlugin({
            build: [
                { entry: 'src/main/index.ts', config: 'vite.main.config.mjs' },
                { entry: 'src/preload/index.ts', config: 'vite.preload.config.mjs' },
            ],
            renderer: [{ name: 'main_window', config: 'vite.renderer.config.mjs' }],
        }),
    ],
}

export default config
