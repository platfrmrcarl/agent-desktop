import * as fs from 'fs'
import { createLogger } from '../../../core/utils/logger'

const log = createLogger('env.sanitizeAppImage')

/**
 * Remove AppImage-injected paths from LD_LIBRARY_PATH and LD_PRELOAD.
 *
 * When the app runs inside an AppImage, the runtime prepends mount-point paths
 * like /tmp/.mount_AgentXXX/usr/lib to LD_LIBRARY_PATH. External child processes
 * (claude CLI, whisper, etc.) must not load Electron's bundled .so files — they
 * are ABI-incompatible. The current process's dynamic linker is already resolved,
 * so stripping these paths only affects children spawned via child_process.spawn().
 *
 * Saves originals as LD_LIBRARY_PATH_APPIMAGE / LD_PRELOAD_APPIMAGE for debugging.
 * Mutates process.env in place — no return value.
 */
export function sanitizeAppImageEnv(): void {
  const appDir = process.env.APPDIR || ''

  // Clean LD_LIBRARY_PATH — remove AppImage mount paths
  const ldPath = process.env.LD_LIBRARY_PATH
  if (ldPath) {
    const original = ldPath
    const cleaned = ldPath
      .split(':')
      .filter(p => {
        if (!p) return false
        // Remove paths inside the AppImage mount directory
        if (appDir && p.startsWith(appDir)) return false
        // Remove /tmp/.mount_* paths (AppImage runtime mount points)
        if (p.match(/^\/tmp\/\.mount_[^/]+/)) return false
        return true
      })
      .join(':')

    if (cleaned !== original) {
      // Save original for debugging, then set cleaned version
      process.env.LD_LIBRARY_PATH_APPIMAGE = original
      process.env.LD_LIBRARY_PATH = cleaned || undefined
      log.info('cleaned LD_LIBRARY_PATH for child processes', { original, cleaned: cleaned || '(empty)' })
    }
  }

  // Clean LD_PRELOAD — only if it contains AppImage paths
  const ldPreload = process.env.LD_PRELOAD
  if (ldPreload && appDir && ldPreload.includes(appDir)) {
    const original = ldPreload
    const cleaned = ldPreload
      .split(':')
      .filter(p => p && !p.startsWith(appDir) && !p.match(/^\/tmp\/\.mount_[^/]+/))
      .join(':')

    if (cleaned !== original) {
      process.env.LD_PRELOAD_APPIMAGE = original
      process.env.LD_PRELOAD = cleaned || undefined
      log.info('cleaned LD_PRELOAD for child processes')
    }
  }
}
