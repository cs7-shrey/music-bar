import type { ForgeConfig } from '@electron-forge/shared-types'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { MakerZIP } from '@electron-forge/maker-zip'

const config: ForgeConfig = {
    packagerConfig: {
        name: 'Music Bar',
        appBundleId: 'dev.shrey.music-bar',
        asar: true,
        extendInfo: {
            // Menu-bar style app: no Dock icon, no app switcher entry.
            LSUIElement: true,
            NSAppleEventsUsageDescription:
                'Music Bar controls YouTube Music in your browser to show and change what is playing.',
        },
    },
    makers: [new MakerZIP({}, ['darwin'])],
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
