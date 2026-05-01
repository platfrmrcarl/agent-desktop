import { tokenize } from './syntax'
import { builtinRegistry } from './builtins'
import {
  loadCustomVariable,
  listCustomVariables,
  readCustomVariableMetadata,
  warnOverrideOnce,
} from './customLoader'
import type { ResolverCtx, ResolutionReport, VariableFn, VariableInfo } from './types'

const DEFAULT_TIMEOUT_MS = 5000

interface ResolveOpts {
  timeoutMs?: number
  functionsDir?: string
}

async function resolveOne(
  name: string,
  args: string[],
  raw: string,
  ctx: ResolverCtx,
  timeoutMs: number,
  functionsDir: string | undefined,
  errors: ResolutionReport['errors']
): Promise<string> {
  // 1) Try custom first (overrides builtin)
  let fn: VariableFn | null = null
  try {
    fn = await loadCustomVariable(name, functionsDir)
  } catch (err) {
    errors.push({
      variable: name,
      args,
      reason: 'throw',
      message: `loader: ${err instanceof Error ? err.message : String(err)}`,
    })
    return `[erreur: chargement ${name}]`
  }

  if (fn && builtinRegistry.has(name)) {
    warnOverrideOnce(name)
  }

  // 2) Fallback builtin
  if (!fn) {
    const builtin = builtinRegistry.get(name)
    fn = builtin?.fn ?? null
  }

  // 3) Unknown → passthrough (option D)
  if (!fn) {
    errors.push({ variable: name, args, reason: 'unknown', message: 'variable non définie' })
    return raw
  }

  // 4) Execute with timeout
  try {
    const result = await Promise.race<string>([
      Promise.resolve(fn(args, ctx)).then(v => String(v)),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`timeout ${timeoutMs}ms`)), timeoutMs)
      ),
    ])
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const reason: ResolutionReport['errors'][0]['reason'] =
      message.startsWith('timeout') ? 'timeout' : 'throw'
    errors.push({ variable: name, args, reason, message })
    return `[erreur: ${name} — ${message}]`
  }
}

export async function resolveVariablesWithReport(
  prompt: string,
  ctx: ResolverCtx,
  opts: ResolveOpts = {}
): Promise<ResolutionReport> {
  const tokens = tokenize(prompt)
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const errors: ResolutionReport['errors'] = []

  const parts = await Promise.all(
    tokens.map(t =>
      t.type === 'lit'
        ? Promise.resolve(t.value)
        : resolveOne(t.name, t.args, t.raw, ctx, timeoutMs, opts.functionsDir, errors)
    )
  )
  return { resolved: parts.join(''), errors }
}

export async function listVariables(
  opts: { functionsDir?: string } = {}
): Promise<VariableInfo[]> {
  const customNames = await listCustomVariables(opts.functionsDir)
  const metadataEntries = await Promise.all(
    customNames.map(async name => [
      name,
      await readCustomVariableMetadata(name, opts.functionsDir),
    ] as const)
  )
  const customMetadata = new Map(metadataEntries)
  const out: VariableInfo[] = []

  for (const spec of builtinRegistry.values()) {
    const customMeta = customMetadata.get(spec.name)
    out.push({
      name: spec.name,
      description: customMeta?.description ?? spec.description,
      argsHint: customMeta?.argsHint ?? spec.argsHint,
      source: customMeta !== undefined ? 'custom' : 'builtin',
    })
  }
  for (const [name, meta] of customMetadata) {
    if (!builtinRegistry.has(name)) {
      out.push({
        name,
        description: meta.description ?? '(custom function)',
        argsHint: meta.argsHint,
        source: 'custom',
      })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
