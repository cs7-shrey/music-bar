import { execFileSync } from 'child_process'
import { join } from 'path'
import type { ForgeConfig } from '@electron-forge/shared-types'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerZIP } from '@electron-forge/maker-zip'

const config: ForgeConfig = {
    packagerConfig: {
        name: 'Music Bar',
        appBundleId: 'dev.shrey.music-bar',
        asar: true,
        // Generated from assets/note.svg by `pnpm icons`.
        icon: 'assets/icon',
        extraResource: ['assets/trayTemplate.png', 'assets/trayTemplate@2x.png'],
        extendInfo: {
            // Menu-bar style app: no Dock icon, no app switcher entry.
            LSUIElement: true,
            NSAppleEventsUsageDescription:
                'Music Bar controls YouTube Music in your browser to show and change what is playing.',
        },
    },
    makers: [
        // What users download: opens to the app beside an Applications
        // shortcut to drag it onto. The background and its layout come from
        // `pnpm icons` (DMG_* in scripts/build-icons.mjs).
        new MakerDMG({
            icon: 'assets/icon.icns',
            background: 'assets/dmg-background.png',
            iconSize: 112,
            additionalDMGOptions: { window: { size: { width: 640, height: 400 } } },
            contents: (opts) => [
                { type: 'file', path: opts.appPath, x: 170, y: 180 },
                { type: 'link', path: '/Applications', x: 470, y: 180 },
                // Hidden files, out of sight for anyone who shows them.
                { type: 'position', path: '.background', x: 170, y: 900 },
                { type: 'position', path: '.VolumeIcon.icns', x: 470, y: 900 },
            ],
        }),
        // Kept for auto-update later, which installs from a zip.
        new MakerZIP({}, ['darwin']),
    ],
    hooks: {
        // Packaging renames Electron's app and edits its Info.plist and icon,
        // which breaks the ad-hoc signature Electron ships with. A downloaded
        // copy then fails Gatekeeper as "damaged". Re-sign ad-hoc over the
        // final files so it gets the "Open Anyway" prompt instead. Replace
        // with Developer ID signing (osxSign) once there's a certificate.
        postPackage: async (config, { outputPaths, platform }) => {
            if (platform !== 'darwin') return
            const appName = `${config.packagerConfig.name}.app`
            for (const outputPath of outputPaths) {
                execFileSync('codesign', ['--force', '--deep', '--sign', '-', join(outputPath, appName)])
            }
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
