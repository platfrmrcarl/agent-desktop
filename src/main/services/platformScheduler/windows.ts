/**
 * Windows Task Scheduler implementation of PlatformScheduler.
 * Uses schtasks.exe to create/remove a recurring task.
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import type { PlatformScheduler } from '../../../core/ports/platformScheduler'

const execAsync = promisify(exec)

const TASK_NAME = 'AgentDesktopScheduler'

export class WindowsTaskScheduler implements PlatformScheduler {
  async install(nodePath: string, scriptPath: string): Promise<void> {
    await this.uninstall()

    const command = `"${nodePath}" "${scriptPath}" --tick`
    await execAsync(
      `schtasks /create /tn "${TASK_NAME}" /tr ${JSON.stringify(command)} /sc minute /mo 1 /f`
    )
    console.log('[platform-scheduler] Installed Windows scheduled task')
  }

  async uninstall(): Promise<void> {
    try {
      await execAsync(`schtasks /delete /tn "${TASK_NAME}" /f`)
    } catch { /* task doesn't exist */ }
    console.log('[platform-scheduler] Removed Windows scheduled task')
  }

  async isInstalled(): Promise<boolean> {
    try {
      await execAsync(`schtasks /query /tn "${TASK_NAME}"`)
      return true
    } catch {
      return false
    }
  }
}
