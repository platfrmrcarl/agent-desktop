import { readFile } from 'node:fs/promises'
import { exec } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface HookSystemMessage {
  content: string
  hookEvent: string
  hookName?: string
  decision?: 'deny'
  reason?: string
}

interface SettingsHook {
  type: 'command'
  command: string
  /** Timeout in seconds (Claude Code settings.json convention). */
  timeout?: number
}

interface SettingsHookMatcher {
  matcher?: string
  hooks: SettingsHook[]
}

interface HookConfig {
  hooks?: Record<string, SettingsHookMatcher[]>
}

interface HookResult {
  systemMessage?: string
  decision?: 'deny'
  reason?: string
}

export interface RunHooksOptions {
  cwd: string
  /** Override settings.json path; defaults to ~/.claude/settings.json. */
  settingsPath?: string
}

export type EventName = 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'SessionStart' | 'Stop'

const DEFAULT_TIMEOUT_SECONDS = 60

function defaultSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json')
}

async function loadConfig(path: string): Promise<HookConfig> {
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as HookConfig
  } catch {
    return {}
  }
}

function matches(matcher: string | undefined, toolName: string | undefined): boolean {
  if (!matcher) return true
  if (!toolName) return false
  try {
    return new RegExp(matcher).test(toolName)
  } catch {
    return false
  }
}

function execHook(
  command: string,
  input: Record<string, unknown>,
  timeoutMs: number,
): Promise<HookResult | null> {
  return new Promise((resolve) => {
    const child = exec(command, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null)
      const trimmed = stdout.trim()
      if (!trimmed) return resolve(null)
      try {
        resolve(JSON.parse(trimmed) as HookResult)
      } catch {
        resolve(null)
      }
    })
    child.stdin?.write(JSON.stringify(input))
    child.stdin?.end()
  })
}

/**
 * Run all hooks matching the given event name. Returns system messages
 * (and optional block decisions for PreToolUse/PostToolUse). `input` is
 * the hook-input shape (prompt, tool_name, tool_input, etc.).
 *
 * Settings file `timeout` values are interpreted as seconds (Claude Code convention).
 */
export async function runHooks(
  eventName: EventName,
  input: Record<string, unknown>,
  opts: RunHooksOptions,
): Promise<HookSystemMessage[]> {
  const path = opts.settingsPath ?? defaultSettingsPath()
  const config = await loadConfig(path)
  const matchers = config.hooks?.[eventName] ?? []
  if (matchers.length === 0) return []

  const toolName = input.tool_name as string | undefined
  const results: HookSystemMessage[] = []
  const hookInput = { hook_event_name: eventName, cwd: opts.cwd, ...input }

  for (const matcher of matchers) {
    if (!matches(matcher.matcher, toolName)) continue
    for (const hook of matcher.hooks) {
      if (hook.type !== 'command') continue
      const timeoutMs = (hook.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000
      const parsed = await execHook(hook.command, hookInput, timeoutMs)
      if (!parsed) continue
      if (parsed.systemMessage) {
        results.push({ content: parsed.systemMessage, hookEvent: eventName })
      }
      if (parsed.decision === 'deny') {
        results.push({ content: '', hookEvent: eventName, decision: 'deny', reason: parsed.reason })
      }
    }
  }

  return results
}
