import type { Database } from 'better-sqlite3'
import type { ScheduledTask } from '../../types/types'

/** Contexte passé à chaque fonction de résolution (built-in ou custom). */
export interface ResolverCtx {
  /** La tâche en cours d'exécution. */
  task: ScheduledTask
  /** Working directory résolu depuis aiSettings (chemin absolu). */
  cwd: string
  /** DB en lecture — runtime : SqlJsAdapter (API better-sqlite3-compatible). */
  db: Database
  /** Instant stable pour toute une résolution — cohérence inter-variables. */
  now: Date
}

/** Signature unifiée : un `.ts` custom OU un built-in la respecte. */
export type VariableFn = (
  args: string[],
  ctx: ResolverCtx
) => string | Promise<string>

/** Déclaration d'une variable built-in. */
export interface BuiltinSpec {
  name: string
  description: string
  /** Hint affiché dans l'UI / la doc ex: "FORMAT?", "min:max?". */
  argsHint?: string
  fn: VariableFn
}

/** Info publique sur une variable — retournée par listVariables() pour l'UI. */
export interface VariableInfo {
  name: string
  description: string
  source: 'builtin' | 'custom'
  argsHint?: string
}

/** Détail retourné par resolveVariablesWithReport pour observabilité. */
export interface ResolutionReport {
  resolved: string
  errors: Array<{
    variable: string
    args: string[]
    reason: 'timeout' | 'throw' | 'bad_args' | 'unknown'
    message: string
  }>
}
