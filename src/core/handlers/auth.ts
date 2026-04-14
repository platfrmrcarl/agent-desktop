import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import type { AuthStatus, AuthDiagnostics } from '../types/types'

function getCredentialsPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  return path.join(configDir, '.credentials.json')
}

function credentialsAvailable(credentialsPath: string): boolean {
  return fs.existsSync(credentialsPath)
}

function getUserInfoFromCredentials(credentialsPath: string): { email: string; name: string } {
  const fallback = { email: 'Claude User', name: 'Claude User' }
  try {
    const configDir = path.dirname(credentialsPath)
    const claudeJsonPath = path.join(configDir, '.claude.json')
    if (fs.existsSync(claudeJsonPath)) {
      const data = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'))
      const account = data?.oauthAccount
      if (account?.emailAddress) {
        return {
          email: account.emailAddress,
          name: account.displayName || account.emailAddress,
        }
      }
    }
  } catch {
    // ignore
  }
  return fallback
}

function runDiagnostics(sdkError?: string): AuthDiagnostics {
  const home = os.homedir()
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')
  const credentialsPath = path.join(configDir, '.credentials.json')

  return {
    claudeBinaryFound: false,
    claudeBinaryPath: null,
    credentialsFileExists: credentialsAvailable(credentialsPath),
    configDir,
    isAppImage: !!process.env.APPIMAGE,
    home,
    ldLibraryPath: process.env.LD_LIBRARY_PATH || undefined,
    sdkError,
  }
}

async function getStatus(db: SqlJsAdapter): Promise<AuthStatus> {
  // Check for API key auth first — bypass OAuth entirely when set
  try {
    const row = (db as any).prepare("SELECT value FROM settings WHERE key = 'ai_apiKey'").get() as { value: string } | undefined
    if (row?.value) {
      return {
        authenticated: true,
        user: { email: 'API Key', name: 'API Key User' },
      }
    }
  } catch {
    // settings table might not exist yet during initial setup
  }

  const credentialsPath = getCredentialsPath()

  if (!credentialsAvailable(credentialsPath)) {
    const hint = `Credentials not found at ${credentialsPath}. Run \`claude login\` in your terminal first.`
    const diagnostics = runDiagnostics('Credentials file not found')
    return {
      authenticated: false,
      user: null,
      error: hint,
      diagnostics,
    }
  }

  const userInfo = getUserInfoFromCredentials(credentialsPath)
  return { authenticated: true, user: userInfo }
}

function logout(): AuthStatus {
  return { authenticated: false, user: null }
}

export function registerAuthHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  registrar.handle('auth:getStatus', async () => {
    try {
      return await getStatus(db)
    } catch (err) {
      throw new Error(`Failed to get auth status: ${(err as Error).message}`)
    }
  })

  registrar.handle('auth:login', async () => {
    try {
      const status = await getStatus(db)
      if (!status.authenticated) {
        throw new Error(status.error || 'Not logged in. Run `claude login` in your terminal first.')
      }
      return status
    } catch (err) {
      throw new Error(`Login failed: ${(err as Error).message}`)
    }
  })

  registrar.handle('auth:logout', async () => {
    return logout()
  })
}
