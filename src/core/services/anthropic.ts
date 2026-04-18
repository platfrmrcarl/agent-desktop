// SDK injection registry — Core no longer resolves the SDK itself.
// Entry points (Electron main, headless index, taskRunner) MUST call
// registerAgentSDK() at startup. This eliminates dynamic import resolution
// from bundled Core code, removing the source of "Cannot find package"
// errors when the runtime resolution context is fragile (cron, asar).
type AgentSDK = typeof import('@anthropic-ai/claude-agent-sdk')

let _sdk: AgentSDK | null = null

export function registerAgentSDK(sdk: AgentSDK): void {
  _sdk = sdk
}

export async function loadAgentSDK(): Promise<AgentSDK> {
  if (!_sdk) {
    throw new Error(
      'AgentSDK not registered. The entry point must call registerAgentSDK() at startup.'
    )
  }
  return _sdk
}

export type { AgentSDK }
