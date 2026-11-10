import { app } from 'electron'

/**
 * Running on Wayland (Electron's default whenever WAYLAND_DISPLAY is set,
 * unless told --ozone-platform=x11). Wayland compositors don't let apps
 * take global keys or place their own windows.
 */
export const isWayland =
    process.platform === 'linux' && !!process.env.WAYLAND_DISPLAY && app.commandLine.getSwitchValue('ozone-platform') !== 'x11'

/** Tells each window's preload about the session (see `wayland` in MusicBarApi). */
export const WAYLAND_ARGUMENT = '--music-bar-wayland'
export const sessionArguments = () => (isWayland ? [WAYLAND_ARGUMENT] : [])
