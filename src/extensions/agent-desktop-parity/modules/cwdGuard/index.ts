import type { ExtensionAPI, ExtensionRuntimeContext } from '../../shared/types'
import { isToolCallEventType } from '@mariozechner/pi-coding-agent'
import {
  isPathOutsideWriteAllowed,
  isPathOutsideAllowed,
  extractBashWritePaths,
} from '../../../../core/services/guards/cwdGuard'
import type { CwdWhitelistEntry } from '../../../../core/types'

/**
 * Phase 1 — CWD write guard.
 *
 * Subscribes to PI's `tool_call` event. When the event targets a mutating tool
 * (write, edit, bash) and the resolved path lies outside CWD + readwrite
 * whitelist, returns `{ block: true, reason }` and emits a system_message
 * chunk so the UI can display the block.
 *
 * Read-only bash commands (cat, ls, etc.) are NOT handled here — they're a
 * future read-restriction module's concern.
 */
export function initCwdGuard(pi: ExtensionAPI, ctx: ExtensionRuntimeContext): void {
  if (!ctx.aiSettings.cwdRestrictionEnabled) return

  const cwd = ctx.aiSettings.cwd || process.cwd()
  const whitelist: CwdWhitelistEntry[] = ctx.aiSettings.cwdWhitelist ?? []
  const hasWhitelist = whitelist.length > 0

  const checkPath = (filePath: string): { allowed: true } | { allowed: false; resolvedPath: string } => {
    const outside = hasWhitelist
      ? isPathOutsideWriteAllowed(filePath, cwd, whitelist)
      : isPathOutsideAllowed(filePath, cwd)
    return outside ? { allowed: false, resolvedPath: outside } : { allowed: true }
  }

  const allowedDirsMessage = (): string => {
    if (hasWhitelist) {
      const rw = whitelist.filter(e => e.access === 'readwrite').map(e => `"${e.path}" (readwrite)`)
      return [`"${cwd}" (cwd)`, ...rw].join(', ')
    }
    return `"${cwd}"`
  }

  pi.on('tool_call', (event) => {
    if (isToolCallEventType('write', event) || isToolCallEventType('edit', event)) {
      const filePath = event.input.path
      if (!filePath) return undefined
      const check = checkPath(filePath)
      if (check.allowed) return undefined
      const reason = `${event.toolName} target "${check.resolvedPath}" is outside allowed directories (${allowedDirsMessage()}).`
      ctx.bridge.emitSystemMessage(
        `Write blocked by cwd-guard: ${reason}`,
        { hookName: 'cwd-guard', hookEvent: 'PreToolUse' },
      )
      return { block: true, reason }
    }

    if (isToolCallEventType('bash', event)) {
      const command = event.input.command
      if (!command) return undefined
      for (const p of extractBashWritePaths(command)) {
        const check = checkPath(p)
        if (!check.allowed) {
          const reason = `Bash write-target "${check.resolvedPath}" is outside allowed directories (${allowedDirsMessage()}).`
          ctx.bridge.emitSystemMessage(
            `Bash blocked by cwd-guard: ${reason}`,
            { hookName: 'cwd-guard', hookEvent: 'PreToolUse' },
          )
          return { block: true, reason }
        }
      }
      return undefined
    }

    return undefined
  })
}
