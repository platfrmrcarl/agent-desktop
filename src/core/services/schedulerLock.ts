import { promises as fsp } from 'fs'
import { dirname } from 'path'

/**
 * Advisory scheduler lock — prevents concurrent DB access between Electron and headless.
 *
 * Strategy: write PID + timestamp to a lock file. Check if the holder is still alive
 * via process.kill(pid, 0). This is more portable than flock() (which Node.js doesn't
 * expose natively) and handles crashes reliably — a dead PID means the lock is stale.
 *
 * The lock file contains: "pid:timestamp" (e.g., "12345:2025-01-15T10:00:00.000Z")
 */

export interface SchedulerLock {
  /** Try to acquire the lock. Returns true if acquired, false if held by a live process. */
  acquire(): Promise<boolean>
  /** Release the lock (delete the lock file). */
  release(): Promise<void>
  /** Check if this instance currently holds the lock. */
  isHeld(): boolean
}

const STALE_THRESHOLD_MS = 3 * 60_000 // 3 minutes — if heartbeat is older, lock is stale

export function createSchedulerLock(lockPath: string): SchedulerLock {
  let held = false

  async function readLockFile(): Promise<{ pid: number; timestamp: string } | null> {
    try {
      const content = await fsp.readFile(lockPath, 'utf-8')
      const [pidStr, timestamp] = content.trim().split('\n')
      const pid = parseInt(pidStr, 10)
      if (isNaN(pid) || !timestamp) return null
      return { pid, timestamp }
    } catch {
      return null // File doesn't exist or can't be read
    }
  }

  function isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0) // Signal 0 = check existence without killing
      return true
    } catch {
      return false // Process doesn't exist
    }
  }

  async function writeLockFile(): Promise<void> {
    await fsp.mkdir(dirname(lockPath), { recursive: true })
    await fsp.writeFile(lockPath, `${process.pid}\n${new Date().toISOString()}`, 'utf-8')
  }

  return {
    async acquire(): Promise<boolean> {
      const existing = await readLockFile()

      if (existing) {
        // Lock file exists — check if holder is alive
        if (existing.pid === process.pid) {
          // We already hold it (re-entrant)
          held = true
          return true
        }

        if (isProcessAlive(existing.pid)) {
          // Check staleness — process alive but heartbeat too old = zombie
          const age = Date.now() - new Date(existing.timestamp).getTime()
          if (age < STALE_THRESHOLD_MS) {
            // Lock is fresh and held by a live process
            return false
          }
          // Stale heartbeat from a live process — treat as stale
          console.log(`[scheduler-lock] Stale lock from PID ${existing.pid} (${Math.round(age / 1000)}s old), taking over`)
        } else {
          console.log(`[scheduler-lock] Stale lock from dead PID ${existing.pid}, taking over`)
        }
      }

      // No lock or stale lock — take it
      await writeLockFile()
      held = true
      return true
    },

    async release(): Promise<void> {
      if (!held) return
      try {
        // Only delete if we still own it
        const existing = await readLockFile()
        if (existing && existing.pid === process.pid) {
          await fsp.unlink(lockPath)
        }
      } catch {
        // Lock file already gone — that's fine
      }
      held = false
    },

    isHeld(): boolean {
      return held
    },
  }
}

/**
 * Update the heartbeat timestamp in an existing lock file.
 * Call this periodically (e.g., every tick) to signal the process is alive.
 */
export async function refreshLockHeartbeat(lockPath: string): Promise<void> {
  try {
    await fsp.writeFile(lockPath, `${process.pid}\n${new Date().toISOString()}`, 'utf-8')
  } catch {
    // Lock file may have been deleted — ignore
  }
}
