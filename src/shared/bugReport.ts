/**
 * Bug report wire types — shared across main / core / renderer.
 *
 * These were previously defined in `src/main/services/bugReport.ts`. Both
 * `src/renderer/components/bugReport/BugReportModal.tsx` and
 * `src/core/handlers/bugReport.ts` were importing them from that path —
 * a compile-time dependency from renderer/core into a main-process module.
 * They belong in `src/shared/` (plain data, no runtime). See
 * .claude/reviews/2026-04-23/02-architecture.md §12 "Lateral observations".
 *
 * The main module re-exports these from here so existing imports
 * (`from '../../main/services/bugReport'`) keep working during any
 * incremental migration; new consumers should import from
 * `src/shared/bugReport` directly.
 */

export interface BugReportMetadata {
  version: string
  platform: string
  session: 'X11' | 'Wayland' | 'unknown'
  electron: string
  node: string
  aiBackend: string
  theme: string
  webMode: 'yes' | 'no'
}

export interface BugReportPayload {
  description: string
  logs: string
  metadata: BugReportMetadata
}

export type SendResult =
  | { ok: true }
  | { ok: false; error: 'not_configured' | 'timeout' | 'invalid_webhook' | 'server_error' | 'unknown' }
  | { ok: false; error: 'rate_limited'; retryAfterMs: number }
