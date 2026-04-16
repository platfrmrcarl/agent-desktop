import type { ResolverCtx, ResolutionReport } from './types'

export type { ResolverCtx, VariableFn, BuiltinSpec, ResolutionReport } from './types'

/** Implémentation en Task 8. */
export async function resolveVariables(
  _prompt: string,
  _ctx: ResolverCtx,
  _opts?: { timeoutMs?: number; functionsDir?: string }
): Promise<string> {
  throw new Error('Not implemented yet (Task 8)')
}

export async function resolveVariablesWithReport(
  _prompt: string,
  _ctx: ResolverCtx,
  _opts?: { timeoutMs?: number; functionsDir?: string }
): Promise<ResolutionReport> {
  throw new Error('Not implemented yet (Task 8)')
}

export async function listVariables(
  _opts?: { functionsDir?: string }
): Promise<Array<{
  name: string
  description: string
  source: 'builtin' | 'custom'
  argsHint?: string
}>> {
  throw new Error('Not implemented yet (Task 8)')
}
