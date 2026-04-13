import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('child_process', () => ({
  exec: vi.fn(),
}))

vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}))

import { exec } from 'child_process'
import { promises as fsp } from 'fs'
import { LinuxCrontabScheduler } from './linux'

const UNIT_NAME = 'agent-desktop-scheduler'

let systemdAvailable: boolean
let timerEnabled: boolean

function setupExecMock() {
  ;(exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (cmd: string, callback: (err: Error | null, result?: { stdout: string }) => void) => {
      // systemd detection
      if (cmd === 'systemctl --user --version') {
        if (systemdAvailable) callback(null, { stdout: 'systemd 260' })
        else callback(new Error('not found'))
        return
      }
      // crontab detection
      if (cmd === 'which crontab') {
        callback(new Error('not found'))
        return
      }
      // systemd timer operations
      if (cmd === 'systemctl --user daemon-reload') {
        callback(null, { stdout: '' })
        return
      }
      if (cmd === `systemctl --user enable --now ${UNIT_NAME}.timer`) {
        timerEnabled = true
        callback(null, { stdout: '' })
        return
      }
      if (cmd === `systemctl --user disable --now ${UNIT_NAME}.timer`) {
        timerEnabled = false
        callback(null, { stdout: '' })
        return
      }
      if (cmd === `systemctl --user is-enabled ${UNIT_NAME}.timer`) {
        if (timerEnabled) callback(null, { stdout: 'enabled' })
        else callback(new Error('disabled'))
        return
      }
      callback(new Error(`unexpected command: ${cmd}`))
    },
  )
}

describe('LinuxCrontabScheduler (systemd backend)', () => {
  let scheduler: LinuxCrontabScheduler

  beforeEach(() => {
    vi.clearAllMocks()
    systemdAvailable = true
    timerEnabled = false
    // Reset cached scheduler between tests
    scheduler = new LinuxCrontabScheduler()
    setupExecMock()
  })

  describe('install', () => {
    it('creates systemd service and timer unit files', async () => {
      await scheduler.install('/usr/bin/node', '/path/to/script.js')

      const writeFileCalls = vi.mocked(fsp.writeFile).mock.calls
      expect(writeFileCalls).toHaveLength(2)

      // Service unit
      const [servicePath, serviceContent] = writeFileCalls[0]
      expect(servicePath).toContain(`${UNIT_NAME}.service`)
      expect(serviceContent).toContain('ExecStart=/usr/bin/node /path/to/script.js --tick')

      // Timer unit
      const [timerPath, timerContent] = writeFileCalls[1]
      expect(timerPath).toContain(`${UNIT_NAME}.timer`)
      expect(timerContent).toContain('OnUnitActiveSec=60')
    })

    it('enables the timer after writing units', async () => {
      await scheduler.install('/usr/bin/node', '/path/to/script.js')

      expect(timerEnabled).toBe(true)
    })
  })

  describe('uninstall', () => {
    it('disables timer and removes unit files', async () => {
      timerEnabled = true

      await scheduler.uninstall()

      expect(timerEnabled).toBe(false)
      expect(vi.mocked(fsp.unlink)).toHaveBeenCalledTimes(2)
    })
  })

  describe('isInstalled', () => {
    it('returns true when timer is enabled', async () => {
      timerEnabled = true

      expect(await scheduler.isInstalled()).toBe(true)
    })

    it('returns false when timer is not enabled', async () => {
      timerEnabled = false

      expect(await scheduler.isInstalled()).toBe(false)
    })
  })
})
