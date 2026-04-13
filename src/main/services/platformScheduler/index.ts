import type { PlatformScheduler } from '../../../core/ports/platformScheduler'
import { noopPlatformScheduler } from '../../../core/ports/platformScheduler'
import { LinuxCrontabScheduler } from './linux'
import { MacOSLaunchdScheduler } from './macos'
import { WindowsTaskScheduler } from './windows'

export function createPlatformScheduler(): PlatformScheduler {
  switch (process.platform) {
    case 'linux':
      return new LinuxCrontabScheduler()
    case 'darwin':
      return new MacOSLaunchdScheduler()
    case 'win32':
      return new WindowsTaskScheduler()
    default:
      return noopPlatformScheduler
  }
}

export type { PlatformScheduler } from '../../../core/ports/platformScheduler'
export { noopPlatformScheduler } from '../../../core/ports/platformScheduler'
