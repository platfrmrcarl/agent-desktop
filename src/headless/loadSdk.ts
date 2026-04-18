import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { pathToFileURL } from 'url'
import { registerAgentSDK } from '../core/services/anthropic'
import type { AgentSDK } from '../core/services/anthropic'

const HEADLESS_DIR = join(homedir(), '.config', 'agent-desktop', 'headless')

/**
 * Resolve and register the Claude Agent SDK with Core.
 *
 * Two resolution strategies, tried in order:
 * 1. Absolute file URL via node_path.txt — robust when running from a location
 *    where node_modules is not reachable through normal NPM resolution (cron
 *    invocation of standalone taskRunner.js).
 * 2. Bare-name dynamic import — works when node_modules is reachable from CWD
 *    or from the importer's path (running via `npm run start:server`, etc.).
 */
export async function loadAndRegisterSDK(): Promise<void> {
  const nodePathFile = join(HEADLESS_DIR, 'node_path.txt')
  if (existsSync(nodePathFile)) {
    const nodeModules = readFileSync(nodePathFile, 'utf-8').trim()
    const sdkPath = join(nodeModules, '@anthropic-ai', 'claude-agent-sdk', 'sdk.mjs')
    if (existsSync(sdkPath)) {
      const sdk = (await import(pathToFileURL(sdkPath).href)) as AgentSDK
      registerAgentSDK(sdk)
      return
    }
  }
  const sdk = (await (Function('return import("@anthropic-ai/claude-agent-sdk")')() as Promise<AgentSDK>))
  registerAgentSDK(sdk)
}
