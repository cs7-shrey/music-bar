import { execFileSync } from 'child_process'
import { join } from 'path'
import type { ForgeConfig } from '@electron-forge/shared-types'
import { VitePlugin } from '@electron-forge/plugin-vite'
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
    makers: [new MakerZIP({}, ['darwin'])],
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
