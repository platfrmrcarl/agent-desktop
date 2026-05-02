import * as path from 'path'
import * as fs from 'fs'
import { createLogger } from '../../../core/utils/logger'

const log = createLogger('env.sanitizeWayland')

/**
 * Discover and inject Wayland-related environment variables that may be absent
 * when the app is launched from a .desktop file or TTY session.
 *
 * Sets (additive only — never overwrites existing values):
 * - DBUS_SESSION_BUS_ADDRESS: required for XDG Desktop Portal (global shortcuts)
 * - WAYLAND_DISPLAY: needed for Ozone/Wayland backend selection
 * - HYPRLAND_INSTANCE_SIGNATURE: needed for hyprctl socket discovery
 *
 * Emits a diagnostic log when a Wayland session is active so shortcut issues
 * are easier to debug. Mutates process.env in place — no return value.
 */
export function sanitizeWaylandEnv(): void {
  // Ensure DBUS_SESSION_BUS_ADDRESS for Wayland portal access (used by global shortcuts).
  // On modern Arch/systemd, the socket is at $XDG_RUNTIME_DIR/bus.
  // In AppImage launched from a .desktop file, this env var may not be inherited.
  if (!process.env.DBUS_SESSION_BUS_ADDRESS) {
    const xdgRuntime = process.env.XDG_RUNTIME_DIR
    if (xdgRuntime) {
      const busSocket = path.join(xdgRuntime, 'bus')
      try {
        fs.accessSync(busSocket)
        process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${busSocket}`
        log.info('set DBUS_SESSION_BUS_ADDRESS', { value: process.env.DBUS_SESSION_BUS_ADDRESS })
      } catch {
        log.warn('D-Bus session bus socket not found', { busSocket })
      }
    } else {
      log.warn('XDG_RUNTIME_DIR not set — cannot resolve D-Bus session bus address')
    }
  }

  // Ensure WAYLAND_DISPLAY when a Wayland compositor is running but the var isn't inherited.
  // Common when Hyprland is started from a TTY — child processes from other TTYs or services
  // don't inherit WAYLAND_DISPLAY even though the compositor is active.
  // Scan $XDG_RUNTIME_DIR for wayland-* sockets.
  if (!process.env.WAYLAND_DISPLAY) {
    const xdgRuntime = process.env.XDG_RUNTIME_DIR
    if (xdgRuntime) {
      try {
        const entries = fs.readdirSync(xdgRuntime)
        const waylandSocket = entries.find(e => e.startsWith('wayland-'))
        if (waylandSocket) {
          process.env.WAYLAND_DISPLAY = waylandSocket
          log.info('set WAYLAND_DISPLAY', { value: waylandSocket })
        }
      } catch {
        // can't read XDG_RUNTIME_DIR — skip
      }
    }
  }

  // Ensure HYPRLAND_INSTANCE_SIGNATURE for hyprctl socket discovery.
  // hyprctl needs this to find the compositor socket at $XDG_RUNTIME_DIR/hypr/{signature}/
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) {
    const xdgRuntime = process.env.XDG_RUNTIME_DIR
    if (xdgRuntime) {
      const hyprDir = path.join(xdgRuntime, 'hypr')
      try {
        const entries = fs.readdirSync(hyprDir)
        if (entries.length > 0) {
          process.env.HYPRLAND_INSTANCE_SIGNATURE = entries[0]
          log.info('set HYPRLAND_INSTANCE_SIGNATURE', { value: entries[0] })
        }
      } catch {
        // hypr directory doesn't exist — not Hyprland or not yet started
      }
    }
  }

  // Diagnostic logging — helps debug shortcut issues in AppImage
  if (isWaylandSession()) {
    log.info('Wayland session detected — diagnostic env vars', {
      DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || '(unset)',
      XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '(unset)',
      WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || '(unset)',
      HYPRLAND_INSTANCE_SIGNATURE: process.env.HYPRLAND_INSTANCE_SIGNATURE || '(unset)',
      DISPLAY: process.env.DISPLAY || '(unset)',
    })
  }
}

/** Returns true when the current session is Wayland (any signal). */
function isWaylandSession(): boolean {
  if (process.env.XDG_SESSION_TYPE === 'wayland') return true
  if (process.env.WAYLAND_DISPLAY) return true
  if (process.env.HYPRLAND_INSTANCE_SIGNATURE) return true
  return false
}
