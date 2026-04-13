/**
 * Port: system UI capabilities (dialogs, notifications).
 *
 * These operations require native UI in the desktop app
 * and are no-ops or alternatives in headless mode.
 */
export interface SystemUI {
  selectFolder(): Promise<string | null>
  selectFile(): Promise<string | null>
  showNotification(title: string, body: string): Promise<void>
}

/** No-op implementation for headless or test environments */
export const noopSystemUI: SystemUI = {
  selectFolder: async () => null,
  selectFile: async () => null,
  showNotification: async () => {},
}
