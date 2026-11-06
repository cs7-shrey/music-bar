import { app, autoUpdater } from 'electron'
import { describe, logger } from './log'

// Updates come from update.electronjs.org, which serves the zip attached to
// each GitHub release (see the release workflow) in the format Squirrel.Mac,
// Electron's updater, expects. Squirrel downloads in the background, checks
// the new app is signed by the same Developer ID, and swaps it in on restart.
const REPO = 'cs7-shrey/music-bar'
const FIRST_CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 60 * 60 * 1000

const log = logger('updater')

// The version downloaded and waiting for a restart, e.g. "0.1.6".
let readyVersion: string | null = null

/** The downloaded version waiting for a restart, if any. */
export function updateReady(): string | null {
    return readyVersion
}

/** Quits, installs the downloaded update and opens the new version. */
export function installUpdate(): void {
    if (!readyVersion) return
    log.info(`restarting to install ${readyVersion}`)
    autoUpdater.quitAndInstall()
}

/**
 * Checks for updates now and then every hour. `onReady` runs once an update
 * has downloaded, to offer the restart.
 */
export function startUpdater(onReady: (version: string) => void): void {
    // Development builds have no release to update to. Squirrel can't
    // replace an app run from the DMG or Downloads, so updates wait until
    // it's in Applications.
    if (!app.isPackaged) return
    if (!app.isInApplicationsFolder()) {
        log.info('not in Applications; updates are off')
        return
    }

    autoUpdater.setFeedURL({
        url: `https://update.electronjs.org/${REPO}/${process.platform}-${process.arch}/${app.getVersion()}`,
    })
    autoUpdater.on('error', (error) => log.warn(`update failed: ${describe(error)}`))
    autoUpdater.on('update-available', () => log.info('update available, downloading'))
    autoUpdater.on('update-downloaded', (_event, _notes, releaseName) => {
        // The release's title, "Music Bar X.Y.Z".
        readyVersion = releaseName.match(/\d+\.\d+\.\d+/)?.[0] ?? releaseName
        log.info(`update ${readyVersion} downloaded`)
        onReady(readyVersion)
    })

    const check = () => {
        // Once one is downloaded, Squirrel installs that on restart; checking
        // again would only download a newer one over it.
        if (!readyVersion) autoUpdater.checkForUpdates()
    }
    setTimeout(check, FIRST_CHECK_DELAY_MS)
    setInterval(check, CHECK_INTERVAL_MS)
}
