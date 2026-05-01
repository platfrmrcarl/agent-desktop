import * as path from 'path'
import * as os from 'os'
import type { IpcMain } from 'electron'
import type Database from 'better-sqlite3'
import type { AuthStatus, AuthDiagnostics } from '../../shared/types'
import { loadAgentSDK } from './anthropic'
import { findBinaryInPath, isAppImage } from '../utils/env'
import { getSetting } from '../../core/utils/db'
import { credentialsAvailable, getUserInfoFromCredentials } from '../../core/auth/credentials'

async function runDiagnostics(sdkError?: string): Promise<AuthDiagnostics> {
  const home = os.homedir()
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')
  const credentialsPath = path.join(configDir, '.credentials.json')
  const claudeBinaryPath = findBinaryInPath('claude')

  return {
    claudeBinaryFound: claudeBinaryPath !== null,
    claudeBinaryPath,
    credentialsFileExists: await credentialsAvailable(credentialsPath),
    configDir,
    isAppImage: isAppImage(),
    home,
    ldLibraryPath: process.env.LD_LIBRARY_PATH || undefined,
    sdkError,
  }
}

async function getStatus(db?: Database.Database): Promise<AuthStatus> {
  // Check for API key auth first — bypass OAuth entirely when set
  if (db) {
    try {
      if (getSetting(db, 'ai_apiKey')) {
        return {
          authenticated: true,
          user: { email: 'API Key', name: 'API Key User' },
        }
      }
    } catch {
      // settings table might not exist yet during initial setup
    }
  }

  // Pre-check: if credentials are not found (file or macOS Keychain), skip the SDK call
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  const credentialsPath = path.join(configDir, '.credentials.json')

  if (!(await credentialsAvailable(credentialsPath))) {
    const hint =
      process.platform === 'darwin'
        ? 'Run `claude login` in your terminal first.'
        : `Credentials not found at ${credentialsPath}. Run \`claude login\` in your terminal first.`
    const diagnostics = await runDiagnostics('Credentials file not found')
    return {
      authenticated: false,
      user: null,
      error: hint,
      diagnostics,
    }
  }

  const userInfo = await getUserInfoFromCredentials(credentialsPath)

  try {
    const sdk = await loadAgentSDK()

    const testQuery = sdk.query({
      prompt: 'Reply with OK',
      options: {
        maxTurns: 1,
        allowedTools: [],
        permissionMode: 'bypassPermissions' as const,
        allowDangerouslySkipPermissions: true,
      },
    })

    for await (const message of testQuery) {
      const msg = message as Record<string, unknown>
      if (msg.type === 'system' && (msg as { subtype?: string }).subtype === 'init') {
        return { authenticated: true, user: userInfo }
      }
      if (msg.type === 'result') {
        const isError = !!(msg as { is_error?: boolean }).is_error
        return {
          authenticated: !isError,
          user: isError ? null : userInfo,
        }
      }
    }

    return { authenticated: true, user: userInfo }
  } catch (err) {
    const sdkError = err instanceof Error ? err.message : String(err)
    const diagnostics = await runDiagnostics(sdkError)
    return {
      authenticated: false,
      user: null,
      error: `Authentication failed: ${sdkError}`,
      diagnostics,
    }
  }
}

async function login(db?: Database.Database): Promise<AuthStatus> {
  const status = await getStatus(db)
  if (!status.authenticated) {
    throw new Error(status.error || 'Not logged in. Run `claude login` in your terminal first.')
  }
  return status
}

function logout(): AuthStatus {
  return { authenticated: false, user: null }
}

export function registerHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('auth:getStatus', () => getStatus(db))
  ipcMain.handle('auth:login', () => login(db))
  ipcMain.handle('auth:logout', () => logout())
}

// Exported for testing
export { getStatus, runDiagnostics }
