/**
 * Linux implementation of PlatformScheduler.
 * Uses systemd user timers (available on all systemd distros).
 * Falls back to crontab if systemd is not available.
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { homedir } from 'os'
import { promises as fsp } from 'fs'
import type { PlatformScheduler } from '../../../core/ports/platformScheduler'

const execAsync = promisify(exec)

// ─── systemd user timer ────────────────────────────────────

const UNIT_NAME = 'agent-desktop-scheduler'
const SYSTEMD_USER_DIR = join(homedir(), '.config', 'systemd', 'user')
const SERVICE_PATH = join(SYSTEMD_USER_DIR, `${UNIT_NAME}.service`)
const TIMER_PATH = join(SYSTEMD_USER_DIR, `${UNIT_NAME}.timer`)
const LOG_PATH = join(homedir(), '.config', 'agent-desktop', 'scheduler-cron.log')

class SystemdTimerScheduler implements PlatformScheduler {
  async install(nodePath: string, scriptPath: string): Promise<void> {
    await this.uninstall()

    await fsp.mkdir(SYSTEMD_USER_DIR, { recursive: true })

    const serviceUnit = `[Unit]
Description=Agent Desktop Scheduler Tick

[Service]
Type=oneshot
ExecStart=${nodePath} ${scriptPath} --tick
StandardOutput=append:${LOG_PATH}
StandardError=append:${LOG_PATH}
`

    const timerUnit = `[Unit]
Description=Agent Desktop Scheduler Timer

[Timer]
OnBootSec=60
OnUnitActiveSec=60
AccuracySec=10

[Install]
WantedBy=timers.target
`

    await fsp.writeFile(SERVICE_PATH, serviceUnit, 'utf-8')
    await fsp.writeFile(TIMER_PATH, timerUnit, 'utf-8')

    await execAsync('systemctl --user daemon-reload')
    await execAsync(`systemctl --user enable --now ${UNIT_NAME}.timer`)
    console.log('[platform-scheduler] Installed systemd user timer')
  }

  async uninstall(): Promise<void> {
    try {
      await execAsync(`systemctl --user disable --now ${UNIT_NAME}.timer`)
    } catch { /* not installed */ }
    try {
      await fsp.unlink(SERVICE_PATH)
    } catch { /* doesn't exist */ }
    try {
      await fsp.unlink(TIMER_PATH)
    } catch { /* doesn't exist */ }
    try {
      await execAsync('systemctl --user daemon-reload')
    } catch { /* ignore */ }
    console.log('[platform-scheduler] Removed systemd user timer')
  }

  async isInstalled(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`systemctl --user is-enabled ${UNIT_NAME}.timer`)
      return stdout.trim() === 'enabled'
    } catch {
      return false
    }
  }
}

// ─── crontab fallback ──────────────────────────────────────

const CRON_MARKER = '# agent-desktop-scheduler'

class CrontabScheduler implements PlatformScheduler {
  async install(nodePath: string, scriptPath: string): Promise<void> {
    await this.uninstall()

    const existing = await this.readCrontab()
    const entry = `* * * * * ${nodePath} ${scriptPath} --tick >> ${LOG_PATH} 2>&1 ${CRON_MARKER}`
    const newCrontab = existing ? `${existing}\n${entry}\n` : `${entry}\n`

    await execAsync(`echo ${JSON.stringify(newCrontab)} | crontab -`)
    console.log('[platform-scheduler] Installed crontab entry')
  }

  async uninstall(): Promise<void> {
    const existing = await this.readCrontab()
    if (!existing) return

    const filtered = existing
      .split('\n')
      .filter(line => !line.includes(CRON_MARKER))
      .join('\n')
      .trim()

    if (filtered) {
      await execAsync(`echo ${JSON.stringify(filtered + '\n')} | crontab -`)
    } else {
      await execAsync('crontab -r').catch(() => {})
    }
    console.log('[platform-scheduler] Removed crontab entry')
  }

  async isInstalled(): Promise<boolean> {
    const crontab = await this.readCrontab()
    return crontab.includes(CRON_MARKER)
  }

  private async readCrontab(): Promise<string> {
    try {
      const { stdout } = await execAsync('crontab -l')
      return stdout.trim()
    } catch {
      return ''
    }
  }
}

// ─── Factory: systemd first, crontab fallback ──────────────

let cachedScheduler: PlatformScheduler | null = null

async function hasSystemd(): Promise<boolean> {
  try {
    await execAsync('systemctl --user --version')
    return true
  } catch {
    return false
  }
}

async function hasCrontab(): Promise<boolean> {
  try {
    await execAsync('which crontab')
    return true
  } catch {
    return false
  }
}

export class LinuxCrontabScheduler implements PlatformScheduler {
  private async resolve(): Promise<PlatformScheduler> {
    if (cachedScheduler) return cachedScheduler
    if (await hasSystemd()) {
      cachedScheduler = new SystemdTimerScheduler()
    } else if (await hasCrontab()) {
      cachedScheduler = new CrontabScheduler()
    } else {
      console.warn('[platform-scheduler] Neither systemd nor crontab available')
      cachedScheduler = { install: async () => {}, uninstall: async () => {}, isInstalled: async () => false }
    }
    return cachedScheduler
  }

  async install(nodePath: string, scriptPath: string): Promise<void> {
    const impl = await this.resolve()
    await impl.install(nodePath, scriptPath)
  }

  async uninstall(): Promise<void> {
    const impl = await this.resolve()
    await impl.uninstall()
  }

  async isInstalled(): Promise<boolean> {
    const impl = await this.resolve()
    return impl.isInstalled()
  }
}
