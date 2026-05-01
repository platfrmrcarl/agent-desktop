import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'

/**
 * Resolve the path to Claude Code's credentials file.
 *
 * Honors $CLAUDE_CONFIG_DIR if set, else uses `~/.claude/.credentials.json`.
 */
export function getCredentialsPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  return path.join(configDir, '.credentials.json')
}

/**
 * Check whether Claude credentials are available on this machine.
 *
 * On macOS (darwin), Claude Code v2+ stores credentials in the system
 * Keychain rather than as a plaintext file — check both. On Linux/Windows,
 * only the file is consulted.
 */
export async function credentialsAvailable(credentialsPath: string): Promise<boolean> {
  const fileExists = await fs.promises
    .access(credentialsPath, fs.constants.F_OK)
    .then(() => true)
    .catch(() => false)
  if (fileExists) return true

  if (process.platform === 'darwin') {
    try {
      // Service name: "Claude Code-credentials", account: current OS username.
      const username = process.env.USER || os.userInfo().username
      execSync(`security find-generic-password -a "${username}" -s "Claude Code-credentials"`, {
        stdio: 'ignore',
      })
      return true
    } catch {
      // Not in keychain either — fall through to false
    }
  }

  return false
}

/**
 * Extract user email and display name from `~/.claude/.claude.json`
 * (`oauthAccount` field). Returns a generic fallback if the file is
 * missing, malformed, or lacks the expected fields.
 */
export async function getUserInfoFromCredentials(
  credentialsPath: string,
): Promise<{ email: string; name: string }> {
  const fallback = { email: 'Claude User', name: 'Claude User' }
  try {
    const configDir = path.dirname(credentialsPath)
    const claudeJsonPath = path.join(configDir, '.claude.json')
    try {
      const data = JSON.parse(await fs.promises.readFile(claudeJsonPath, 'utf8'))
      const account = data?.oauthAccount
      if (account?.emailAddress) {
        return {
          email: account.emailAddress,
          name: account.displayName || account.emailAddress,
        }
      }
    } catch {
      // file not found or not valid JSON — return fallback
    }
  } catch {
    // ignore
  }
  return fallback
}
