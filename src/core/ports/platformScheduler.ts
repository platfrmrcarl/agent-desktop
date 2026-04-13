/**
 * Port: Platform-native task scheduler abstraction.
 * Implementations install/uninstall a recurring OS job that invokes the headless task runner.
 */

export interface PlatformScheduler {
  /** Install a recurring tick job (every minute) */
  install(nodePath: string, scriptPath: string): Promise<void>
  /** Remove the tick job */
  uninstall(): Promise<void>
  /** Check if the job is currently installed */
  isInstalled(): Promise<boolean>
}

export const noopPlatformScheduler: PlatformScheduler = {
  async install() {},
  async uninstall() {},
  async isInstalled() { return false },
}
