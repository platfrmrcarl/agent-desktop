import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'

/**
 * Resolve nvm's default node version bin directory.
 * Reads ~/.nvm/alias/default, follows one level of alias indirection,
 * and returns the matching bin path (or null if nvm is not installed).
 */
function resolveNvmNodeBin(nvmDir: string): string | null {
  const versionsDir = path.join(nvmDir, 'versions', 'node')
  try {
    // Read the default alias (e.g. "v20.19.4" or "lts/iron")
    let version = fs.readFileSync(path.join(nvmDir, 'alias', 'default'), 'utf8').trim()

    // If it's an alias (e.g. "lts/iron"), follow one level
    if (!version.startsWith('v')) {
      version = fs.readFileSync(path.join(nvmDir, 'alias', version), 'utf8').trim()
    }

    if (version.startsWith('v')) {
      const bin = path.join(versionsDir, version, 'bin')
      fs.accessSync(bin, fs.constants.R_OK)
      return bin
    }
  } catch {
    // nvm not installed or alias unresolvable — try latest installed version
    try {
      const versions = fs.readdirSync(versionsDir).filter(v => v.startsWith('v'))
      if (versions.length === 0) return null
      // Semver sort descending, pick latest
      versions.sort((a, b) => {
        const pa = a.slice(1).split('.').map(Number)
        const pb = b.slice(1).split('.').map(Number)
        for (let i = 0; i < 3; i++) {
          if (pa[i] !== pb[i]) return pb[i] - pa[i]
        }
        return 0
      })
      return path.join(versionsDir, versions[0], 'bin')
    } catch {
      return null
    }
  }
  return null
}

/**
 * Append common binary locations to PATH, including platform-specific paths
 * and nvm's default node version bin.
 *
 * Additive only — never removes existing PATH entries, never duplicates.
 * When launched from Finder/Dock or a .desktop file, shell init scripts
 * don't run — this replicates the effect of sourcing ~/.bashrc or ~/.zshrc.
 * Mutates process.env in place — no return value.
 */
export function loadShellEnv(): void {
  const home = os.homedir()

  const extraDirs = [
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
    path.join(home, '.npm-global', 'bin'),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ]

  // macOS (Apple Silicon): Homebrew installs to /opt/homebrew instead of /usr/local
  if (process.platform === 'darwin') {
    extraDirs.push(
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      path.join(home, '.volta', 'bin'),
    )
  } else {
    // Linux-only paths
    extraDirs.push('/snap/bin')
  }

  // nvm: resolve and add the default node version's bin directory.
  // When launched from Finder/Dock, shell init scripts don't run so nvm's
  // node is never added to PATH. We replicate what `nvm use default` would do.
  const nvmDir = process.env.NVM_DIR || path.join(home, '.nvm')
  const nvmNodeBin = resolveNvmNodeBin(nvmDir)
  if (nvmNodeBin) extraDirs.push(nvmNodeBin)

  const currentPath = process.env.PATH || ''
  const currentDirs = new Set(currentPath.split(path.delimiter).filter(Boolean))
  const added: string[] = []

  for (const dir of extraDirs) {
    if (!currentDirs.has(dir)) {
      try {
        fs.accessSync(dir, fs.constants.R_OK)
        added.push(dir)
        currentDirs.add(dir)
      } catch {
        // directory doesn't exist, skip
      }
    }
  }

  if (added.length > 0) {
    process.env.PATH = currentPath + path.delimiter + added.join(path.delimiter)
    console.log('[env] Appended to PATH:', added.join(', '))
  }
}
