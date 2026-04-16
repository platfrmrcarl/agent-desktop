import { spawn } from 'node:child_process'
import { GitOperationError } from '@shared/git-types'

export interface RunGitOptions {
  timeoutMs?: number
  throwOnNonZero?: boolean
  captureEnv?: boolean
}

export interface RunGitResult {
  stdout: string
  stderr: string
  code: number
  envUsed?: NodeJS.ProcessEnv
}

const DEFAULT_TIMEOUT = 10_000

export async function runGit(
  cwd: string,
  args: string[],
  opts: RunGitOptions = {},
): Promise<RunGitResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT
  const throwOnNonZero = opts.throwOnNonZero ?? true

  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
  }

  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: false, env })
    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 500)
    }, timeoutMs)

    child.stdout.on('data', (d) => { stdout += d.toString('utf8') })
    child.stderr.on('data', (d) => { stderr += d.toString('utf8') })

    child.on('error', (err) => {
      clearTimeout(timer)
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new GitOperationError({ kind: 'not-installed' }))
      } else {
        reject(err)
      }
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        reject(new GitOperationError({ kind: 'timeout', cmd: args }))
        return
      }
      const result: RunGitResult = {
        stdout,
        stderr,
        code: code ?? -1,
        envUsed: opts.captureEnv ? env : undefined,
      }
      if (throwOnNonZero && result.code !== 0) {
        reject(new GitOperationError({
          kind: 'exec-failed',
          cmd: args,
          code: result.code,
          stderr: result.stderr,
        }))
        return
      }
      resolve(result)
    })
  })
}
