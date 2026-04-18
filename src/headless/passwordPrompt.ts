import { createInterface } from 'readline'
import type { Readable, Writable } from 'stream'

interface PromptOptions {
  prompt: string
  stdin: Readable
  stdout: Writable
}

export function promptMasked(opts: PromptOptions): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: opts.stdin, output: opts.stdout, terminal: true })
    const stdout = opts.stdout as Writable & { write: (s: string) => boolean }
    let entered = ''

    const onKey = (s: string): void => {
      if (s === '\r' || s === '\n') return
      entered += s
      stdout.write('*')
    }

    ;(opts.stdin as unknown as { on: Function }).on('data', onKey)
    stdout.write(opts.prompt)
    rl.on('line', (line) => {
      ;(opts.stdin as unknown as { off: Function }).off('data', onKey)
      rl.close()
      stdout.write('\n')
      resolve(entered || line)
      entered = ''
    })
  })
}

export function validatePair(a: string, b: string): string | null {
  if (a.length < 8) return 'Password must be at least 8 characters.'
  if (a !== b) return 'Passwords do not match.'
  return null
}
