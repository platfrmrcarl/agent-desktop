/**
 * Port: platform-specific I/O that requires OS integration.
 *
 * These operations are no-ops in headless mode and require
 * Electron shell/desktop APIs in the desktop app.
 */
export interface PlatformIO {
  revealInFileManager(path: string): Promise<void>
  openTerminalHere(path: string): Promise<void>
  openWithDefault(path: string): Promise<void>
  openExternal(url: string): Promise<void>
}

/** No-op implementation for headless or test environments */
export const noopPlatformIO: PlatformIO = {
  revealInFileManager: async () => {},
  openTerminalHere: async () => {},
  openWithDefault: async () => {},
  openExternal: async () => {},
}
