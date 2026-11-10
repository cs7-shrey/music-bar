import { app } from 'electron'
import { dirname, join } from 'path'

// Files shipped beside the app's code (extraResource in forge.config.ts).
// A packaged build has them in the folder that holds app.asar: Electron's
// resources folder, or wherever a package that runs the app with a shared
// Electron (as Nix does) puts app.asar. Not process.resourcesPath, which
// is then the shared Electron's. In development they're in the repo.

// Where each one lives in the repo; anything else is in assets/.
const REPO_PATHS: Record<string, string> = {
    extension: 'extension',
    'music-bar-host.js': 'native-host/music-bar-host.js',
}

/** A shipped file or folder, e.g. 'trayTemplate.png' or 'extension/manifest.json'. */
export function resourcePath(name: string): string {
    if (app.isPackaged) return join(dirname(app.getAppPath()), name)
    const [first, ...rest] = name.split('/')
    return join(app.getAppPath(), REPO_PATHS[first] ?? join('assets', first), ...rest)
}
