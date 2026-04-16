import { readdir, readFile, mkdir, writeFile, stat } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import ts from 'typescript'
import type { VariableFn } from './types'

const DEFAULT_DIR = join(homedir(), '.agent-desktop', 'functions')
const CACHE_SUBDIR = '.cache'

interface CacheEntry {
  mtimeMs: number
  fn: VariableFn
}

const moduleCache = new Map<string, CacheEntry>()
const overrideWarnedFor = new Set<string>()

/** Reset internal caches — exported for tests only. */
export function _resetCacheForTests(): void {
  moduleCache.clear()
  overrideWarnedFor.clear()
}

/** Emit one warn line per custom override (first load only). */
export function warnOverrideOnce(name: string): void {
  if (overrideWarnedFor.has(name)) return
  overrideWarnedFor.add(name)
  console.warn(`[variableResolver] custom override for builtin "${name}"`)
}

/**
 * Load a custom variable function from <functionsDir>/<name>.ts.
 * - Returns null if no file exists
 * - Transpiles TS → ESM via ts.transpileModule
 * - Caches by mtime: retranspiles only when source changed
 * - Imports the transpiled .mjs via dynamic import
 */
export async function loadCustomVariable(
  name: string,
  functionsDir: string = DEFAULT_DIR
): Promise<VariableFn | null> {
  const srcPath = join(functionsDir, `${name}.ts`)
  const srcStat = await stat(srcPath).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null
    throw e
  })
  if (!srcStat) return null
  const cacheKey = `${functionsDir}::${name}`
  const cached = moduleCache.get(cacheKey)
  if (cached && cached.mtimeMs === srcStat.mtimeMs) {
    return cached.fn
  }

  const cacheDir = join(functionsDir, CACHE_SUBDIR)
  await mkdir(cacheDir, { recursive: true })

  const source = await readFile(srcPath, 'utf-8')

  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      isolatedModules: true,
    },
    fileName: srcPath,
    reportDiagnostics: true,
  })

  const errorDiagnostics = (result.diagnostics ?? []).filter(
    d => d.category === ts.DiagnosticCategory.Error
  )
  if (errorDiagnostics.length > 0) {
    const messages = errorDiagnostics
      .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      .join('; ')
    throw new Error(`${name}.ts: erreur de transpilation — ${messages}`)
  }

  const { outputText } = result

  const cacheFile = join(cacheDir, `${name}-${srcStat.mtimeMs}.mjs`)
  await writeFile(cacheFile, outputText, 'utf-8')

  const mod = await import(pathToFileURL(cacheFile).href)
  const fn = (mod.default ?? mod) as unknown

  if (typeof fn !== 'function') {
    throw new Error(`${name}.ts: export default doit être une fonction`)
  }

  const typedFn = fn as VariableFn
  moduleCache.set(cacheKey, { mtimeMs: srcStat.mtimeMs, fn: typedFn })
  return typedFn
}

/** List basenames of .ts files in functionsDir (no extension, ignores .cache contents). */
export async function listCustomVariables(
  functionsDir: string = DEFAULT_DIR
): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(functionsDir)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
  return entries
    .filter(f => extname(f) === '.ts')
    .map(f => basename(f, '.ts'))
}
