// Types pour les fichiers custom ~/.agent-desktop/functions/*.ts.
// Les utilisateurs peuvent référencer ces types pour l'auto-complétion :
//
//   /// <reference types="agent-desktop/functions" />
//   import type { VariableFn } from 'agent-desktop/functions'
//
//   const today: VariableFn = (args, ctx) => new Date().toISOString()
//   export default today

declare module 'agent-desktop/functions' {
  export interface ResolverCtx {
    task: {
      id: number
      name: string
      prompt: string
      conversation_id: number
      run_count: number
      last_run_at: string | null
      next_run_at: string | null
      last_status: 'running' | 'success' | 'error' | null
    }
    cwd: string
    db: {
      prepare(sql: string): {
        get(...params: unknown[]): Record<string, unknown> | undefined
        all(...params: unknown[]): Record<string, unknown>[]
      }
    }
    now: Date
  }

  export type VariableFn = (
    args: string[],
    ctx: ResolverCtx
  ) => string | Promise<string>
}
