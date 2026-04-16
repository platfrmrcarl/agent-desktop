# Variables dans les prompts des tâches planifiées — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre l'injection de variables (`{today_date}`, `{last_commit:--short}`, custom `.ts`) dans le prompt des tâches planifiées, résolues à l'exécution, aussi bien en Electron qu'en headless.

**Architecture:** Nouveau module `src/core/services/variableResolver/` (5 fichiers), point d'injection unique à `core/services/taskExecutor.ts:55`. Kit built-in (12 variables : temps, task ctx, git, fs, db). Extensions utilisateur via `~/.agent-desktop/functions/*.ts` transpilés avec `typescript.transpileModule` et cachés par mtime.

**Tech Stack:** TypeScript, `typescript` (runtime transpile), `node:fs/promises`, `node:child_process`, Vitest. DB via `SqlJsAdapter` (API better-sqlite3-compatible). Pas de nouvelle dépendance runtime (hors promotion de `typescript`).

---

## File Structure

**Créer :**
- `src/core/services/variableResolver/types.ts` — interfaces `ResolverCtx`, `VariableFn`, `BuiltinSpec`, `ResolutionReport`
- `src/core/services/variableResolver/syntax.ts` — `tokenize(input): Token[]`
- `src/core/services/variableResolver/builtins.ts` — `BUILTINS[]` + `builtinRegistry: Map`
- `src/core/services/variableResolver/customLoader.ts` — `loadCustomVariable`, `listCustomVariables`
- `src/core/services/variableResolver/index.ts` — API publique : `resolveVariables`, `resolveVariablesWithReport`, `listVariables`
- Tests colocalisés : `syntax.test.ts`, `builtins.test.ts`, `customLoader.test.ts`, `index.test.ts`
- `types/functions.d.ts` — déclaration `VariableFn` ré-exposée pour les users écrivant des `.ts` custom

**Modifier :**
- `src/core/services/taskExecutor.ts` — ajouter `db` et `resolveVariables` à `TaskRunContext`, appeler `resolveVariablesWithReport` en ligne 55
- `src/main/services/scheduler.ts:40-82` — ajouter `db` et `resolveVariables` dans `createElectronContext`
- `src/headless/taskRunner.ts:59-86` — ajouter `db` et `resolveVariables` dans `createCoreContext`
- `src/core/services/taskExecutor.test.ts` — mettre à jour le mock ctx
- `package.json` — promouvoir `typescript` de `devDependencies` vers `dependencies`

---

## Task 1 : Scaffold du module + types

**Files:**
- Create: `src/core/services/variableResolver/types.ts`
- Create: `src/core/services/variableResolver/index.ts` (squelette — impl. en Task 8)

- [ ] **Step 1.1 : Créer le répertoire et `types.ts`**

Écrire `src/core/services/variableResolver/types.ts` :

```ts
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
```

- [ ] **Step 1.2 : Squelette `index.ts` (API à remplir en Task 8)**

Écrire `src/core/services/variableResolver/index.ts` :

```ts
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
```

- [ ] **Step 1.3 : Vérifier que TypeScript compile**

Run: `npm run build`
Expected: Aucune erreur. Les `index.ts` exporte des stubs. Pas de test pour l'instant (code non appelé).

- [ ] **Step 1.4 : Commit**

```bash
git add src/core/services/variableResolver/types.ts src/core/services/variableResolver/index.ts
git commit -m "feat(variableResolver): scaffold module and types"
```

---

## Task 2 : Tokenizer (`syntax.ts`) + tests

**Files:**
- Create: `src/core/services/variableResolver/syntax.ts`
- Create: `src/core/services/variableResolver/syntax.test.ts`

- [ ] **Step 2.1 : Écrire les tests d'abord (TDD)**

Écrire `src/core/services/variableResolver/syntax.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { tokenize } from './syntax'

describe('tokenize', () => {
  it('returns a single lit token for plain text', () => {
    expect(tokenize('hello world')).toEqual([
      { type: 'lit', value: 'hello world' },
    ])
  })

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([])
  })

  it('tokenizes a single variable without args', () => {
    expect(tokenize('{name}')).toEqual([
      { type: 'var', name: 'name', args: [], raw: '{name}' },
    ])
  })

  it('tokenizes a variable surrounded by text', () => {
    expect(tokenize('Hello {name}!')).toEqual([
      { type: 'lit', value: 'Hello ' },
      { type: 'var', name: 'name', args: [], raw: '{name}' },
      { type: 'lit', value: '!' },
    ])
  })

  it('tokenizes a variable with one argument', () => {
    expect(tokenize('{today_date:DD/MM}')).toEqual([
      { type: 'var', name: 'today_date', args: ['DD/MM'], raw: '{today_date:DD/MM}' },
    ])
  })

  it('tokenizes a variable with multiple arguments', () => {
    expect(tokenize('{random:1:100}')).toEqual([
      { type: 'var', name: 'random', args: ['1', '100'], raw: '{random:1:100}' },
    ])
  })

  it('tokenizes empty args explicitly', () => {
    expect(tokenize('{x:}')).toEqual([
      { type: 'var', name: 'x', args: [''], raw: '{x:}' },
    ])
  })

  it('tokenizes two adjacent variables', () => {
    expect(tokenize('{a}{b}')).toEqual([
      { type: 'var', name: 'a', args: [], raw: '{a}' },
      { type: 'var', name: 'b', args: [], raw: '{b}' },
    ])
  })

  it('does not match names with spaces', () => {
    expect(tokenize('{ foo }')).toEqual([
      { type: 'lit', value: '{ foo }' },
    ])
  })

  it('does not match names starting with digit', () => {
    expect(tokenize('{1foo}')).toEqual([
      { type: 'lit', value: '{1foo}' },
    ])
  })

  it('supports underscore and digits in names', () => {
    expect(tokenize('{today_date_2}')).toEqual([
      { type: 'var', name: 'today_date_2', args: [], raw: '{today_date_2}' },
    ])
  })

  it('keeps literal text between variables', () => {
    expect(tokenize('A{x}B{y}C')).toEqual([
      { type: 'lit', value: 'A' },
      { type: 'var', name: 'x', args: [], raw: '{x}' },
      { type: 'lit', value: 'B' },
      { type: 'var', name: 'y', args: [], raw: '{y}' },
      { type: 'lit', value: 'C' },
    ])
  })

  it('accepts accented characters and symbols inside args', () => {
    expect(tokenize('{weather:Paris é}')).toEqual([
      { type: 'var', name: 'weather', args: ['Paris é'], raw: '{weather:Paris é}' },
    ])
  })

  it('preserves lone closing brace as literal', () => {
    expect(tokenize('text}more')).toEqual([
      { type: 'lit', value: 'text}more' },
    ])
  })

  it('handles mix of invalid and valid patterns', () => {
    expect(tokenize('{ foo }{bar}')).toEqual([
      { type: 'lit', value: '{ foo }' },
      { type: 'var', name: 'bar', args: [], raw: '{bar}' },
    ])
  })

  it('handles variable at end of string', () => {
    expect(tokenize('hello {name}')).toEqual([
      { type: 'lit', value: 'hello ' },
      { type: 'var', name: 'name', args: [], raw: '{name}' },
    ])
  })
})
```

- [ ] **Step 2.2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run src/core/services/variableResolver/syntax.test.ts`
Expected: FAIL — `syntax.ts` n'existe pas encore.

- [ ] **Step 2.3 : Implémenter `syntax.ts`**

Écrire `src/core/services/variableResolver/syntax.ts` :

```ts
export type Token =
  | { type: 'lit'; value: string }
  | { type: 'var'; name: string; args: string[]; raw: string }

const VAR_PATTERN = /\{([a-zA-Z_][a-zA-Z0-9_]*)((?::[^:}]*)*)\}/g

/**
 * Parse a prompt into literal and variable tokens.
 * - `{name}` → VAR with empty args
 * - `{name:a}` → VAR with args = ['a']
 * - `{name:a:b}` → VAR with args = ['a', 'b']
 * - `{name:}` → VAR with args = [''] (explicit empty arg)
 * - Anything that does not match → LIT
 */
export function tokenize(input: string): Token[] {
  if (input.length === 0) return []
  const tokens: Token[] = []
  let lastIndex = 0
  for (const m of input.matchAll(VAR_PATTERN)) {
    const start = m.index!
    if (start > lastIndex) {
      tokens.push({ type: 'lit', value: input.slice(lastIndex, start) })
    }
    const [raw, name, argPart] = m
    const args = argPart.length > 0 ? argPart.slice(1).split(':') : []
    tokens.push({ type: 'var', name, args, raw })
    lastIndex = start + raw.length
  }
  if (lastIndex < input.length) {
    tokens.push({ type: 'lit', value: input.slice(lastIndex) })
  }
  return tokens
}
```

- [ ] **Step 2.4 : Vérifier que les tests passent**

Run: `npx vitest run src/core/services/variableResolver/syntax.test.ts`
Expected: PASS — 16 tests verts.

- [ ] **Step 2.5 : Commit**

```bash
git add src/core/services/variableResolver/syntax.ts src/core/services/variableResolver/syntax.test.ts
git commit -m "feat(variableResolver): tokenizer for {name} and {name:arg:arg}"
```

---

## Task 3 : Built-ins synchrones (date/time/random)

**Files:**
- Create: `src/core/services/variableResolver/builtins.ts`
- Create: `src/core/services/variableResolver/builtins.test.ts`

- [ ] **Step 3.1 : Tests pour les built-ins de date/time/random**

Écrire `src/core/services/variableResolver/builtins.test.ts` :

```ts
import { describe, it, expect, vi } from 'vitest'
import { builtinRegistry } from './builtins'
import type { ResolverCtx } from './types'

function makeCtx(overrides: Partial<ResolverCtx> = {}): ResolverCtx {
  return {
    task: {
      id: 1, name: 'test-task', prompt: '', conversation_id: 1,
      enabled: true, interval_value: 1, interval_unit: 'hours',
      schedule_time: null, catch_up: false, max_runs: null,
      last_run_at: null, next_run_at: null, last_status: null,
      last_error: null, run_count: 0, notify_desktop: false, notify_voice: false,
    } as any,
    cwd: '/tmp',
    db: {} as any,
    now: new Date('2026-04-16T12:34:56.000Z'),
    ...overrides,
  }
}

describe('builtins — date/time', () => {
  it('today_date returns ISO date by default', () => {
    const fn = builtinRegistry.get('today_date')!.fn
    expect(fn([], makeCtx())).toBe('2026-04-16')
  })

  it('today_date formats with DD/MM/YYYY', () => {
    const fn = builtinRegistry.get('today_date')!.fn
    expect(fn(['DD/MM/YYYY'], makeCtx())).toBe('16/04/2026')
  })

  it('today_date respects HH:mm:ss tokens', () => {
    const fn = builtinRegistry.get('today_date')!.fn
    // UTC time 12:34:56 — local time depends on TZ, we use a local Date
    const localNow = new Date(2026, 3, 16, 9, 5, 7)   // month is 0-indexed (april = 3)
    expect(fn(['HH:mm:ss'], makeCtx({ now: localNow }))).toBe('09:05:07')
  })

  it('now returns ISO string', () => {
    const fn = builtinRegistry.get('now')!.fn
    expect(fn([], makeCtx())).toBe('2026-04-16T12:34:56.000Z')
  })

  it('time returns local HH:mm', () => {
    const fn = builtinRegistry.get('time')!.fn
    const localNow = new Date(2026, 3, 16, 14, 30)
    expect(fn([], makeCtx({ now: localNow }))).toBe('14:30')
  })

  it('timestamp returns unix seconds', () => {
    const fn = builtinRegistry.get('timestamp')!.fn
    expect(fn([], makeCtx())).toBe(String(Math.floor(new Date('2026-04-16T12:34:56.000Z').getTime() / 1000)))
  })

  it('day_of_week returns French weekday', () => {
    const fn = builtinRegistry.get('day_of_week')!.fn
    // 2026-04-16 is a Thursday → jeudi
    const thu = new Date(2026, 3, 16)
    expect(fn([], makeCtx({ now: thu }))).toBe('jeudi')
  })
})

describe('builtins — random', () => {
  it('random returns integer in default range 0-100', () => {
    const fn = builtinRegistry.get('random')!.fn
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(fn([], makeCtx())).toBe('50')
    vi.restoreAllMocks()
  })

  it('random respects custom min and max', () => {
    const fn = builtinRegistry.get('random')!.fn
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(fn(['10', '20'], makeCtx())).toBe('10')
    vi.spyOn(Math, 'random').mockReturnValue(0.999999)
    expect(fn(['10', '20'], makeCtx())).toBe('20')
    vi.restoreAllMocks()
  })

  it('random throws on non-numeric args', () => {
    const fn = builtinRegistry.get('random')!.fn
    expect(() => fn(['abc', '10'], makeCtx())).toThrow(/args invalides/)
  })
})
```

- [ ] **Step 3.2 : Vérifier que les tests échouent**

Run: `npx vitest run src/core/services/variableResolver/builtins.test.ts`
Expected: FAIL — `builtins.ts` n'existe pas.

- [ ] **Step 3.3 : Implémenter les built-ins synchrones**

Écrire `src/core/services/variableResolver/builtins.ts` (version partielle — les built-ins async sont ajoutés en Task 5/6) :

```ts
import type { BuiltinSpec } from './types'

// ─── Helpers ────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Minimal date formatter. Tokens: YYYY, MM, DD, HH, mm, ss.
 * Kept inline (no date-fns dep) — 6 tokens suffice for our use cases.
 */
function formatDate(d: Date, fmt?: string): string {
  if (!fmt) return d.toISOString().slice(0, 10)
  return fmt
    .replace(/YYYY/g, String(d.getFullYear()))
    .replace(/MM/g, pad(d.getMonth() + 1))
    .replace(/DD/g, pad(d.getDate()))
    .replace(/HH/g, pad(d.getHours()))
    .replace(/mm/g, pad(d.getMinutes()))
    .replace(/ss/g, pad(d.getSeconds()))
}

const WEEKDAYS_FR = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi']

// ─── Built-ins (sync) ──────────────────────────────────────

export const BUILTINS: BuiltinSpec[] = [
  {
    name: 'today_date',
    description: "Date du jour. Arg: format (DD/MM/YYYY, YYYY-MM-DD...). Par défaut ISO YYYY-MM-DD.",
    argsHint: 'FORMAT?',
    fn: (args, ctx) => formatDate(ctx.now, args[0]),
  },
  {
    name: 'now',
    description: "Timestamp ISO complet avec timezone",
    fn: (_args, ctx) => ctx.now.toISOString(),
  },
  {
    name: 'time',
    description: "Heure courante en HH:mm (local)",
    fn: (_args, ctx) => formatDate(ctx.now, 'HH:mm'),
  },
  {
    name: 'timestamp',
    description: "Unix timestamp en secondes",
    fn: (_args, ctx) => String(Math.floor(ctx.now.getTime() / 1000)),
  },
  {
    name: 'day_of_week',
    description: "Jour de la semaine en français (lundi, mardi...)",
    fn: (_args, ctx) => WEEKDAYS_FR[ctx.now.getDay()],
  },
  {
    name: 'random',
    description: "Entier aléatoire entre min et max inclus. Défaut: 0:100.",
    argsHint: 'min:max?',
    fn: (args) => {
      const minRaw = args[0]
      const maxRaw = args[1]
      const min = minRaw !== undefined && minRaw !== '' ? Number(minRaw) : 0
      const max = maxRaw !== undefined && maxRaw !== '' ? Number(maxRaw) : 100
      if (Number.isNaN(min) || Number.isNaN(max)) {
        throw new Error(`random: args invalides "${args.join(':')}"`)
      }
      return String(Math.floor(Math.random() * (max - min + 1)) + min)
    },
  },
  // Task-context + async added in tasks 4-6
]

export const builtinRegistry = new Map<string, BuiltinSpec>(
  BUILTINS.map(b => [b.name, b])
)
```

- [ ] **Step 3.4 : Vérifier que les tests passent**

Run: `npx vitest run src/core/services/variableResolver/builtins.test.ts`
Expected: PASS — 9 tests verts.

- [ ] **Step 3.5 : Commit**

```bash
git add src/core/services/variableResolver/builtins.ts src/core/services/variableResolver/builtins.test.ts
git commit -m "feat(variableResolver): sync builtins (date/time/random)"
```

---

## Task 4 : Built-ins task-context (sync + ctx)

**Files:**
- Modify: `src/core/services/variableResolver/builtins.ts`
- Modify: `src/core/services/variableResolver/builtins.test.ts`

- [ ] **Step 4.1 : Ajouter les tests pour les built-ins task**

Append dans `src/core/services/variableResolver/builtins.test.ts` :

```ts
describe('builtins — task context', () => {
  it('task_name returns ctx.task.name', () => {
    const fn = builtinRegistry.get('task_name')!.fn
    const ctx = makeCtx({ task: { ...makeCtx().task, name: 'Daily report' } as any })
    expect(fn([], ctx)).toBe('Daily report')
  })

  it('task_run_count returns run_count + 1 (1-indexed)', () => {
    const fn = builtinRegistry.get('task_run_count')!.fn
    const ctx = makeCtx({ task: { ...makeCtx().task, run_count: 5 } as any })
    expect(fn([], ctx)).toBe('6')
  })

  it('task_run_count returns 1 when run_count is 0', () => {
    const fn = builtinRegistry.get('task_run_count')!.fn
    expect(fn([], makeCtx())).toBe('1')
  })

  it('last_run_at returns empty string on first run', () => {
    const fn = builtinRegistry.get('last_run_at')!.fn
    expect(fn([], makeCtx())).toBe('')
  })

  it('last_run_at formats the previous run timestamp', () => {
    const fn = builtinRegistry.get('last_run_at')!.fn
    const ctx = makeCtx({
      task: { ...makeCtx().task, last_run_at: '2026-04-15T10:00:00.000Z' } as any,
    })
    expect(fn(['YYYY-MM-DD'], ctx)).toBe('2026-04-15')
  })

  it('last_run_at uses ISO date by default', () => {
    const fn = builtinRegistry.get('last_run_at')!.fn
    const ctx = makeCtx({
      task: { ...makeCtx().task, last_run_at: '2026-04-15T10:00:00.000Z' } as any,
    })
    expect(fn([], ctx)).toBe('2026-04-15')
  })
})
```

- [ ] **Step 4.2 : Vérifier que les nouveaux tests échouent**

Run: `npx vitest run src/core/services/variableResolver/builtins.test.ts`
Expected: 6 nouveaux tests en FAIL (built-ins inexistants).

- [ ] **Step 4.3 : Ajouter les built-ins task à `builtins.ts`**

Dans `src/core/services/variableResolver/builtins.ts`, ajouter avant le commentaire `// Task-context + async added in tasks 4-6` (et supprimer ce commentaire) :

```ts
  {
    name: 'task_name',
    description: "Nom de la tâche planifiée en cours d'exécution",
    fn: (_args, ctx) => ctx.task.name,
  },
  {
    name: 'task_run_count',
    description: "Numéro d'exécution en cours (1 pour la première, 2 pour la deuxième...)",
    fn: (_args, ctx) => String((ctx.task.run_count ?? 0) + 1),
  },
  {
    name: 'last_run_at',
    description: "Date de la dernière exécution. Arg: format. Vide si première exécution.",
    argsHint: 'FORMAT?',
    fn: (args, ctx) => {
      if (!ctx.task.last_run_at) return ''
      return formatDate(new Date(ctx.task.last_run_at), args[0])
    },
  },
```

- [ ] **Step 4.4 : Vérifier tous les tests passent**

Run: `npx vitest run src/core/services/variableResolver/builtins.test.ts`
Expected: PASS — 15 tests verts.

- [ ] **Step 4.5 : Commit**

```bash
git add src/core/services/variableResolver/builtins.ts src/core/services/variableResolver/builtins.test.ts
git commit -m "feat(variableResolver): task-context builtins (task_name, task_run_count, last_run_at)"
```

---

## Task 5 : Built-ins async (last_commit, file_contents)

**Files:**
- Modify: `src/core/services/variableResolver/builtins.ts`
- Modify: `src/core/services/variableResolver/builtins.test.ts`

- [ ] **Step 5.1 : Tests pour `last_commit` et `file_contents`**

Append dans `builtins.test.ts` :

```ts
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

describe('builtins — async git/fs', () => {
  it('last_commit returns short hash and subject from git log in cwd', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'varres-git-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: repo })
      execFileSync('git', ['config', 'user.email', 't@t.test'], { cwd: repo })
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo })
      writeFileSync(join(repo, 'a.txt'), 'hello')
      execFileSync('git', ['add', '.'], { cwd: repo })
      execFileSync('git', ['commit', '-q', '-m', 'initial commit'], { cwd: repo })

      const fn = builtinRegistry.get('last_commit')!.fn
      const out = await fn([], makeCtx({ cwd: repo }))
      expect(out).toMatch(/^[a-f0-9]{7,} initial commit$/)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  }, 10000)

  it('file_contents reads a file relative to cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'varres-fs-'))
    try {
      writeFileSync(join(dir, 'greeting.txt'), 'bonjour')
      const fn = builtinRegistry.get('file_contents')!.fn
      const out = await fn(['greeting.txt'], makeCtx({ cwd: dir }))
      expect(out).toBe('bonjour')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('file_contents accepts absolute paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'varres-fs-'))
    try {
      const abs = join(dir, 'abs.txt')
      writeFileSync(abs, 'absolute content')
      const fn = builtinRegistry.get('file_contents')!.fn
      const out = await fn([abs], makeCtx({ cwd: '/somewhere/else' }))
      expect(out).toBe('absolute content')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('file_contents throws when path arg is missing', async () => {
    const fn = builtinRegistry.get('file_contents')!.fn
    await expect(fn([], makeCtx())).rejects.toThrow(/chemin requis/)
  })
})
```

- [ ] **Step 5.2 : Vérifier que les tests échouent**

Run: `npx vitest run src/core/services/variableResolver/builtins.test.ts`
Expected: 4 nouveaux tests en FAIL.

- [ ] **Step 5.3 : Ajouter les built-ins async à `builtins.ts`**

En haut du fichier, ajouter les imports :

```ts
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { isAbsolute, resolve as pathResolve } from 'node:path'
```

Puis au-dessus de la const `BUILTINS`, ajouter :

```ts
const execFileAsync = promisify(execFile)
```

Enfin, dans le tableau `BUILTINS`, ajouter après `last_run_at` :

```ts
  {
    name: 'last_commit',
    description: "Dernier commit git (hash court + sujet) dans le cwd. Args: flags git log additionnels.",
    argsHint: 'FLAGS?',
    fn: async (args, ctx) => {
      const extra = args.filter(a => a.length > 0)
      const { stdout } = await execFileAsync(
        'git',
        ['log', '-1', '--pretty=format:%h %s', ...extra],
        { cwd: ctx.cwd, timeout: 4000 }
      )
      return stdout.trim()
    },
  },
  {
    name: 'file_contents',
    description: "Contenu d'un fichier en UTF-8. Arg: chemin (relatif au cwd ou absolu).",
    argsHint: 'PATH',
    fn: async (args, ctx) => {
      const path = args[0]
      if (!path) throw new Error('file_contents: chemin requis')
      const abs = isAbsolute(path) ? path : pathResolve(ctx.cwd, path)
      return await readFile(abs, 'utf-8')
    },
  },
```

- [ ] **Step 5.4 : Vérifier que les tests passent**

Run: `npx vitest run src/core/services/variableResolver/builtins.test.ts`
Expected: PASS — 19 tests verts.

Si le test `last_commit` échoue sur un runner CI sans `git` dans le PATH, l'envelopper dans `it.skipIf(!hasGit)` après détection. Sur un poste dev avec git installé → OK.

- [ ] **Step 5.5 : Commit**

```bash
git add src/core/services/variableResolver/builtins.ts src/core/services/variableResolver/builtins.test.ts
git commit -m "feat(variableResolver): async builtins (last_commit, file_contents)"
```

---

## Task 6 : Built-in `previous_output` (DB)

**Files:**
- Modify: `src/core/services/variableResolver/builtins.ts`
- Modify: `src/core/services/variableResolver/builtins.test.ts`

- [ ] **Step 6.1 : Tests pour `previous_output`**

Append dans `builtins.test.ts` :

```ts
describe('builtins — db', () => {
  function makeFakeDb(rows: Array<{ content: string }>) {
    return {
      prepare: (_sql: string) => ({
        get: (_convId: number) => rows[0],
      }),
    } as any
  }

  it('previous_output returns last assistant message content', () => {
    const fn = builtinRegistry.get('previous_output')!.fn
    const db = makeFakeDb([{ content: 'Previous assistant response' }])
    const result = fn([], makeCtx({ db }))
    expect(result).toBe('Previous assistant response')
  })

  it('previous_output returns empty string when no row exists', () => {
    const fn = builtinRegistry.get('previous_output')!.fn
    const db = { prepare: () => ({ get: () => undefined }) } as any
    expect(fn([], makeCtx({ db }))).toBe('')
  })

  it('previous_output truncates to default 2000 chars', () => {
    const fn = builtinRegistry.get('previous_output')!.fn
    const long = 'x'.repeat(3000)
    const db = makeFakeDb([{ content: long }])
    const result = fn([], makeCtx({ db })) as string
    expect(result.length).toBe(2001) // 2000 + '…'
    expect(result.endsWith('…')).toBe(true)
  })

  it('previous_output accepts custom max chars', () => {
    const fn = builtinRegistry.get('previous_output')!.fn
    const db = makeFakeDb([{ content: 'abcdefghij' }])
    expect(fn(['5'], makeCtx({ db }))).toBe('abcde…')
  })

  it('previous_output does not add ellipsis if content fits', () => {
    const fn = builtinRegistry.get('previous_output')!.fn
    const db = makeFakeDb([{ content: 'short' }])
    expect(fn(['10'], makeCtx({ db }))).toBe('short')
  })
})
```

- [ ] **Step 6.2 : Vérifier les nouveaux tests échouent**

Run: `npx vitest run src/core/services/variableResolver/builtins.test.ts`
Expected: 5 nouveaux tests FAIL.

- [ ] **Step 6.3 : Ajouter `previous_output` à `builtins.ts`**

Dans le tableau `BUILTINS`, ajouter après `file_contents` :

```ts
  {
    name: 'previous_output',
    description: "Dernier message assistant de la conversation de la tâche. Arg: max chars (défaut 2000).",
    argsHint: 'MAX_CHARS?',
    fn: (args, ctx) => {
      const maxChars = args[0] ? Number(args[0]) : 2000
      if (Number.isNaN(maxChars) || maxChars <= 0) {
        throw new Error(`previous_output: max_chars invalide "${args[0]}"`)
      }
      const row = ctx.db.prepare(
        `SELECT content FROM messages
         WHERE conversation_id = ? AND role = 'assistant'
         ORDER BY id DESC LIMIT 1`
      ).get(ctx.task.conversation_id) as { content?: string } | undefined
      const content = row?.content ?? ''
      return content.length > maxChars ? content.slice(0, maxChars) + '…' : content
    },
  },
```

- [ ] **Step 6.4 : Vérifier les tests passent**

Run: `npx vitest run src/core/services/variableResolver/builtins.test.ts`
Expected: PASS — 24 tests verts.

- [ ] **Step 6.5 : Commit**

```bash
git add src/core/services/variableResolver/builtins.ts src/core/services/variableResolver/builtins.test.ts
git commit -m "feat(variableResolver): previous_output builtin (reads messages table)"
```

---

## Task 7 : Custom loader (transpile + cache + hot-reload)

**Files:**
- Create: `src/core/services/variableResolver/customLoader.ts`
- Create: `src/core/services/variableResolver/customLoader.test.ts`

**Prérequis :** `typescript` doit être résolvable à l'exécution. Il est en `devDependencies` pour l'instant — ça fonctionne en dev/test. La promotion en `dependencies` est gérée en Task 11.

- [ ] **Step 7.1 : Tests pour le loader**

Écrire `src/core/services/variableResolver/customLoader.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadCustomVariable, listCustomVariables, _resetCacheForTests } from './customLoader'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'varres-custom-'))
  _resetCacheForTests()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('loadCustomVariable', () => {
  it('returns null when no .ts file exists for the name', async () => {
    const fn = await loadCustomVariable('nope', dir)
    expect(fn).toBeNull()
  })

  it('loads a sync default-exported function', async () => {
    writeFileSync(
      join(dir, 'greet.ts'),
      `export default (args: string[]) => 'hello ' + (args[0] ?? 'world')`
    )
    const fn = await loadCustomVariable('greet', dir)
    expect(fn).not.toBeNull()
    expect(await fn!(['laurent'], {} as any)).toBe('hello laurent')
  })

  it('loads an async default-exported function', async () => {
    writeFileSync(
      join(dir, 'async.ts'),
      `export default async (_args: string[]) => 'deferred'`
    )
    const fn = await loadCustomVariable('async', dir)
    expect(await fn!([], {} as any)).toBe('deferred')
  })

  it('rejects when export default is not a function', async () => {
    writeFileSync(join(dir, 'bad.ts'), `export default 42`)
    await expect(loadCustomVariable('bad', dir)).rejects.toThrow(/doit être une fonction/)
  })

  it('retranspile when mtime changes (hot-reload)', async () => {
    const file = join(dir, 'hot.ts')
    writeFileSync(file, `export default () => 'v1'`)
    const fn1 = await loadCustomVariable('hot', dir)
    expect(await fn1!([], {} as any)).toBe('v1')

    // Rewrite with a new mtime (1 second later)
    writeFileSync(file, `export default () => 'v2'`)
    const future = Date.now() / 1000 + 10
    utimesSync(file, future, future)

    const fn2 = await loadCustomVariable('hot', dir)
    expect(await fn2!([], {} as any)).toBe('v2')
  })

  it('serves from cache when mtime unchanged', async () => {
    const file = join(dir, 'cached.ts')
    writeFileSync(file, `export default () => 'cached'`)
    const fn1 = await loadCustomVariable('cached', dir)
    const fn2 = await loadCustomVariable('cached', dir)
    expect(fn1).toBe(fn2) // same reference → no retranspile
  })
})

describe('listCustomVariables', () => {
  it('returns empty array when directory does not exist', async () => {
    expect(await listCustomVariables(join(dir, 'missing'))).toEqual([])
  })

  it('returns basenames of .ts files (no extension)', async () => {
    writeFileSync(join(dir, 'weather.ts'), `export default () => ''`)
    writeFileSync(join(dir, 'holiday.ts'), `export default () => ''`)
    writeFileSync(join(dir, 'README.md'), `not a function`)
    const list = await listCustomVariables(dir)
    expect(list.sort()).toEqual(['holiday', 'weather'])
  })
})
```

- [ ] **Step 7.2 : Vérifier que les tests échouent**

Run: `npx vitest run src/core/services/variableResolver/customLoader.test.ts`
Expected: FAIL — module inexistant.

- [ ] **Step 7.3 : Implémenter `customLoader.ts`**

Écrire `src/core/services/variableResolver/customLoader.ts` :

```ts
import { readdir, readFile, mkdir, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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
 * Load a custom variable function.
 * - Returns null if no <name>.ts file exists in functionsDir.
 * - Transpiles TypeScript → ESM via ts.transpileModule.
 * - Caches by mtime: retranspiles only when the source file changed.
 * - Imports the transpiled .mjs via dynamic import.
 */
export async function loadCustomVariable(
  name: string,
  functionsDir: string = DEFAULT_DIR
): Promise<VariableFn | null> {
  const srcPath = join(functionsDir, `${name}.ts`)
  if (!existsSync(srcPath)) return null

  const srcStat = await stat(srcPath)
  const cached = moduleCache.get(`${functionsDir}::${name}`)
  if (cached && cached.mtimeMs === srcStat.mtimeMs) {
    return cached.fn
  }

  const cacheDir = join(functionsDir, CACHE_SUBDIR)
  await mkdir(cacheDir, { recursive: true })

  const source = await readFile(srcPath, 'utf-8')

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      isolatedModules: true,
    },
    fileName: srcPath,
  })

  // Use mtime in filename to force module graph freshness in Node's import cache.
  const cacheFile = join(cacheDir, `${name}-${srcStat.mtimeMs}.mjs`)
  await writeFile(cacheFile, outputText, 'utf-8')

  const mod = await import(pathToFileURL(cacheFile).href)
  const fn = (mod.default ?? mod) as unknown

  if (typeof fn !== 'function') {
    throw new Error(`${name}.ts: export default doit être une fonction`)
  }

  const typedFn = fn as VariableFn
  moduleCache.set(`${functionsDir}::${name}`, { mtimeMs: srcStat.mtimeMs, fn: typedFn })
  return typedFn
}

/** List basenames of .ts files in functionsDir (no extension, no .cache contents). */
export async function listCustomVariables(
  functionsDir: string = DEFAULT_DIR
): Promise<string[]> {
  if (!existsSync(functionsDir)) return []
  const entries = await readdir(functionsDir)
  return entries
    .filter(f => extname(f) === '.ts')
    .map(f => basename(f, '.ts'))
}
```

- [ ] **Step 7.4 : Vérifier que les tests passent**

Run: `npx vitest run src/core/services/variableResolver/customLoader.test.ts`
Expected: PASS — 8 tests verts.

- [ ] **Step 7.5 : Commit**

```bash
git add src/core/services/variableResolver/customLoader.ts src/core/services/variableResolver/customLoader.test.ts
git commit -m "feat(variableResolver): custom .ts loader with mtime-based cache and hot-reload"
```

---

## Task 8 : Orchestration (`index.ts`) + tests

**Files:**
- Modify: `src/core/services/variableResolver/index.ts`
- Create: `src/core/services/variableResolver/index.test.ts`

- [ ] **Step 8.1 : Tests d'orchestration**

Écrire `src/core/services/variableResolver/index.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveVariables, resolveVariablesWithReport, listVariables } from './index'
import { _resetCacheForTests } from './customLoader'
import type { ResolverCtx } from './types'

function ctx(overrides: Partial<ResolverCtx> = {}): ResolverCtx {
  return {
    task: {
      id: 1, name: 'T', prompt: '', conversation_id: 1,
      enabled: true, interval_value: 1, interval_unit: 'hours',
      schedule_time: null, catch_up: false, max_runs: null,
      last_run_at: null, next_run_at: null, last_status: null,
      last_error: null, run_count: 0, notify_desktop: false, notify_voice: false,
    } as any,
    cwd: '/tmp',
    db: {} as any,
    now: new Date('2026-04-16T12:00:00.000Z'),
    ...overrides,
  }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'varres-index-'))
  _resetCacheForTests()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('resolveVariables', () => {
  it('returns input unchanged when no variables are present', async () => {
    expect(await resolveVariables('hello world', ctx())).toBe('hello world')
  })

  it('resolves a single builtin', async () => {
    expect(await resolveVariables('today is {today_date}', ctx())).toBe('today is 2026-04-16')
  })

  it('resolves multiple builtins in one prompt', async () => {
    const out = await resolveVariables('task {task_name} runs {task_run_count} times', ctx())
    expect(out).toBe('task T runs 1 times')
  })

  it('leaves unknown variables as passthrough (option D)', async () => {
    const out = await resolveVariables('{unknown_var} + {today_date}', ctx(), { functionsDir: dir })
    expect(out).toBe('{unknown_var} + 2026-04-16')
  })

  it('replaces thrown errors with [erreur: ...] marker', async () => {
    const out = await resolveVariables('x = {random:abc}', ctx())
    expect(out).toMatch(/^x = \[erreur: random — /)
  })

  it('replaces timeouts with [erreur: ... timeout ...] marker', async () => {
    writeFileSync(
      join(dir, 'slow.ts'),
      `export default () => new Promise((r) => setTimeout(() => r('never'), 1000))`
    )
    const out = await resolveVariables('result: {slow}', ctx(), {
      functionsDir: dir,
      timeoutMs: 50,
    })
    expect(out).toMatch(/^result: \[erreur: slow — timeout 50ms\]$/)
  })

  it('resolves custom variables from functionsDir', async () => {
    writeFileSync(
      join(dir, 'hello.ts'),
      `export default (args: string[]) => 'hi ' + (args[0] ?? 'world')`
    )
    const out = await resolveVariables('{hello:laurent}', ctx(), { functionsDir: dir })
    expect(out).toBe('hi laurent')
  })

  it('custom overrides builtin with the same name', async () => {
    writeFileSync(
      join(dir, 'today_date.ts'),
      `export default () => 'CUSTOM_DATE'`
    )
    const out = await resolveVariables('{today_date}', ctx(), { functionsDir: dir })
    expect(out).toBe('CUSTOM_DATE')
  })

  it('resolves variables in parallel (runs concurrently)', async () => {
    writeFileSync(
      join(dir, 'slow1.ts'),
      `export default () => new Promise((r) => setTimeout(() => r('A'), 80))`
    )
    writeFileSync(
      join(dir, 'slow2.ts'),
      `export default () => new Promise((r) => setTimeout(() => r('B'), 80))`
    )
    const start = Date.now()
    const out = await resolveVariables('{slow1}+{slow2}', ctx(), {
      functionsDir: dir,
      timeoutMs: 500,
    })
    const duration = Date.now() - start
    expect(out).toBe('A+B')
    expect(duration).toBeLessThan(200) // ≈ 80ms in parallel, not 160ms sequential
  })
})

describe('resolveVariablesWithReport', () => {
  it('reports unknown variables with reason "unknown"', async () => {
    const report = await resolveVariablesWithReport('{nope}', ctx(), { functionsDir: dir })
    expect(report.resolved).toBe('{nope}')
    expect(report.errors).toHaveLength(1)
    expect(report.errors[0]).toMatchObject({ variable: 'nope', reason: 'unknown' })
  })

  it('reports throws with reason "throw"', async () => {
    const report = await resolveVariablesWithReport('{random:nope}', ctx())
    expect(report.errors[0]).toMatchObject({ variable: 'random', reason: 'throw' })
  })

  it('has empty errors array on clean resolution', async () => {
    const report = await resolveVariablesWithReport('{today_date}', ctx())
    expect(report.errors).toEqual([])
  })
})

describe('listVariables', () => {
  it('includes all builtins', async () => {
    const list = await listVariables({ functionsDir: dir })
    const names = list.map(v => v.name)
    expect(names).toContain('today_date')
    expect(names).toContain('task_name')
    expect(names).toContain('previous_output')
  })

  it('marks custom overrides of builtins as source: custom', async () => {
    writeFileSync(join(dir, 'today_date.ts'), `export default () => ''`)
    const list = await listVariables({ functionsDir: dir })
    const td = list.find(v => v.name === 'today_date')
    expect(td?.source).toBe('custom')
  })

  it('includes custom-only variables', async () => {
    writeFileSync(join(dir, 'weather.ts'), `export default () => ''`)
    const list = await listVariables({ functionsDir: dir })
    expect(list.find(v => v.name === 'weather')?.source).toBe('custom')
  })
})
```

- [ ] **Step 8.2 : Vérifier que les tests échouent**

Run: `npx vitest run src/core/services/variableResolver/index.test.ts`
Expected: FAIL — les stubs throw `Not implemented yet`.

- [ ] **Step 8.3 : Implémenter `index.ts`**

Remplacer tout le contenu de `src/core/services/variableResolver/index.ts` par :

```ts
import { tokenize } from './syntax'
import { builtinRegistry } from './builtins'
import { loadCustomVariable, listCustomVariables, warnOverrideOnce } from './customLoader'
import type { ResolverCtx, ResolutionReport, VariableFn } from './types'

export type { ResolverCtx, VariableFn, BuiltinSpec, ResolutionReport } from './types'

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

/** Full report API — returns resolved string plus per-variable errors. */
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

/** Simple API — drops the error report. */
export async function resolveVariables(
  prompt: string,
  ctx: ResolverCtx,
  opts?: ResolveOpts
): Promise<string> {
  const { resolved } = await resolveVariablesWithReport(prompt, ctx, opts)
  return resolved
}

/** For UI autocomplete / docs. Lists builtins + custom files, custom override marked. */
export async function listVariables(
  opts: { functionsDir?: string } = {}
): Promise<Array<{
  name: string
  description: string
  source: 'builtin' | 'custom'
  argsHint?: string
}>> {
  const customNames = new Set(await listCustomVariables(opts.functionsDir))
  const out: Array<{ name: string; description: string; source: 'builtin' | 'custom'; argsHint?: string }> = []

  for (const spec of builtinRegistry.values()) {
    out.push({
      name: spec.name,
      description: spec.description,
      argsHint: spec.argsHint,
      source: customNames.has(spec.name) ? 'custom' : 'builtin',
    })
  }
  for (const name of customNames) {
    if (!builtinRegistry.has(name)) {
      out.push({ name, description: '(custom function)', source: 'custom' })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
```

- [ ] **Step 8.4 : Vérifier que tous les tests passent**

Run: `npx vitest run src/core/services/variableResolver/`
Expected: PASS — tous les fichiers (syntax, builtins, customLoader, index) verts.

- [ ] **Step 8.5 : Commit**

```bash
git add src/core/services/variableResolver/index.ts src/core/services/variableResolver/index.test.ts
git commit -m "feat(variableResolver): orchestration — parallel resolution, timeout, override, passthrough"
```

---

## Task 9 : Intégration dans `taskExecutor.ts`

**Files:**
- Modify: `src/core/services/taskExecutor.ts:15` (interface `TaskRunContext`)
- Modify: `src/core/services/taskExecutor.ts:55` (appel saveMessage)
- Modify: `src/core/services/taskExecutor.test.ts` (mise à jour du mock ctx)
- Modify: `src/core/index.ts` (ré-exporter le resolver)

- [ ] **Step 9.1 : Ajouter un test d'intégration à `taskExecutor.test.ts`**

Lire `src/core/services/taskExecutor.test.ts` pour voir le pattern du mock ctx (ligne 55 mentionne `[K in keyof TaskRunContext]`). Ajouter dans le `describe('executeTask', ...)` :

```ts
it('resolves variables in task.prompt before saving the user message', async () => {
  const task = {
    id: 1, name: 'DailyReport', prompt: 'Hello {task_name}!', conversation_id: 1,
    enabled: true, interval_value: 1, interval_unit: 'hours',
    schedule_time: null, catch_up: false, max_runs: null,
    last_run_at: null, next_run_at: null, last_status: null,
    last_error: null, run_count: 0, notify_desktop: false, notify_voice: false,
  } as any

  await executeTask(scheduler as unknown as SchedulerService, ctx, task)

  // saveMessage should have been called with the resolved prompt (not the raw one)
  const calls = (ctx.saveMessage as any).mock.calls
  const userCall = calls.find((c: any) => c[1] === 'user')
  expect(userCall).toBeDefined()
  expect(userCall[2]).toBe('Hello DailyReport!')
})
```

Pour que ce test passe, le mock `ctx` doit exposer un `db` (`{} as any` suffit : aucun built-in DB n'est appelé ici) et le mock `ensureConversation` doit renvoyer la task inchangée (c'est déjà le cas dans les autres tests).

- [ ] **Step 9.2 : Mettre à jour `TaskRunContext` dans `taskExecutor.ts`**

Dans `src/core/services/taskExecutor.ts`, modifier l'interface (ligne 15) :

```ts
import type { ScheduledTask, ToolCall } from '../types'
import type { AISettings } from './streaming'
import type { SchedulerService } from './scheduler'
import type { Database } from 'better-sqlite3'
import { resolveVariablesWithReport } from './variableResolver'

// ─── TaskRunContext (injected by Electron or headless) ─────

export interface StreamResult {
  content: string
  toolCalls: ToolCall[]
  aborted: boolean
  sessionId: string | null
  error?: string
}

export interface TaskRunContext {
  buildHistory(conversationId: number): Array<{ role: 'user' | 'assistant'; content: string }>
  getAISettings(conversationId: number): AISettings
  getSystemPrompt(conversationId: number, cwd: string): Promise<string>
  streamMessage(
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    systemPrompt: string,
    aiSettings: AISettings,
    conversationId: number
  ): Promise<StreamResult>
  saveMessage(conversationId: number, role: string, content: string, attachments?: unknown[], toolCalls?: ToolCall[]): void
  notify(title: string, body: string): Promise<void>
  onTaskUpdate(task: ScheduledTask): void
  onConversationsRefresh(): void
  /** Read-only DB handle — used by variableResolver builtins (previous_output, etc.). */
  db: Database
}
```

- [ ] **Step 9.3 : Remplacer l'appel `saveMessage` par la résolution puis save**

Dans `src/core/services/taskExecutor.ts`, remplacer les lignes 54-55 :

```ts
    // Save user message (the scheduled prompt)
    ctx.saveMessage(task.conversation_id, 'user', task.prompt)
```

par :

```ts
    // Resolve variables in the prompt ({today_date}, {task_name}, custom .ts, ...)
    const aiSettingsForResolve = ctx.getAISettings(task.conversation_id)
    const { resolved, errors } = await resolveVariablesWithReport(task.prompt, {
      task,
      cwd: aiSettingsForResolve.cwd || process.cwd(),
      db: ctx.db,
      now: new Date(),
    })
    if (errors.length > 0) {
      console.warn(`[scheduler] Task "${task.name}" (id=${task.id}) variable errors:`, errors)
    }
    // Save user message (resolved prompt)
    ctx.saveMessage(task.conversation_id, 'user', resolved)
```

Note : `ctx.getAISettings` est déjà appelé plus bas (ligne 59 avant modif). On le duplique ici pour obtenir `cwd` tôt. Pour éviter la double lecture : sortir la déclaration de `aiSettings` au début du `try` et réutiliser. Diff final plus propre :

```ts
  try {
    // Verify conversation still exists — recreate if deleted
    const originalConvId = task.conversation_id
    task = scheduler.ensureConversation(task)
    if (task.conversation_id !== originalConvId) {
      ctx.onConversationsRefresh()
    }

    // Load AI settings early — cwd needed for variable resolution
    const aiSettings = ctx.getAISettings(task.conversation_id)

    // Resolve variables in the prompt before persisting the user message
    const { resolved, errors } = await resolveVariablesWithReport(task.prompt, {
      task,
      cwd: aiSettings.cwd || process.cwd(),
      db: ctx.db,
      now: new Date(),
    })
    if (errors.length > 0) {
      console.warn(`[scheduler] Task "${task.name}" (id=${task.id}) variable errors:`, errors)
    }
    ctx.saveMessage(task.conversation_id, 'user', resolved)

    // Build context — same flow as messages:send
    const history = ctx.buildHistory(task.conversation_id)

    // Force bypass for unattended execution
    aiSettings.permissionMode = 'bypassPermissions'

    // Prevent recursive task creation
    delete aiSettings.mcpServers?.['agent_scheduler']

    const systemPrompt = await ctx.getSystemPrompt(task.conversation_id, aiSettings.cwd!)

    const { content, toolCalls, error } = await ctx.streamMessage(
      history, systemPrompt, aiSettings, task.conversation_id
    )
    // ... reste inchangé
```

Supprimer la deuxième déclaration `const aiSettings = ctx.getAISettings(...)` (elle devient doublon).

- [ ] **Step 9.4 : Ré-exporter le resolver depuis `core/index.ts`**

Dans `src/core/index.ts`, après les exports existants de `taskExecutor`, ajouter :

```ts
export { resolveVariables, resolveVariablesWithReport, listVariables } from './services/variableResolver'
export type { ResolverCtx, VariableFn, BuiltinSpec, ResolutionReport } from './services/variableResolver'
```

- [ ] **Step 9.5 : Mettre à jour tous les mocks existants de `TaskRunContext`**

Dans `src/core/services/taskExecutor.test.ts`, le mock `ctx` doit inclure `db: {}` (ou un mock minimal). Trouver la création du ctx (ligne ~55-68 d'après la grep précédente) et ajouter `db: {} as any` au bon endroit.

Même opération pour les éventuels autres fichiers qui créent un `TaskRunContext` inline :
- `src/main/services/scheduler.test.ts`
- `src/main/services/schedulerBridge.ts` (si crée un ctx)

Si un test échoue au typecheck avec "Property 'db' is missing" — ajouter `db: {} as any` au littéral.

- [ ] **Step 9.6 : Lancer TOUS les tests**

Run: `npm test`
Expected: PASS — 1917 tests existants + nouveaux tests du resolver. Le nouveau test d'intégration dans `taskExecutor.test.ts` passe aussi.

- [ ] **Step 9.7 : Commit**

```bash
git add src/core/services/taskExecutor.ts src/core/services/taskExecutor.test.ts src/core/index.ts
git commit -m "feat(taskExecutor): resolve variables in task.prompt before sending to LLM"
```

---

## Task 10 : Fournir `ctx.db` depuis les deux contextes

**Files:**
- Modify: `src/main/services/scheduler.ts:40-82` (createElectronContext)
- Modify: `src/headless/taskRunner.ts:59-86` (createCoreContext)

- [ ] **Step 10.1 : Ajouter `db` à `createElectronContext`**

Dans `src/main/services/scheduler.ts`, dans `createElectronContext(db)` retourner l'objet avec `db` ajouté :

```ts
function createElectronContext(db: Database.Database): TaskRunContext {
  return {
    // ... tous les champs existants inchangés
    onConversationsRefresh() {
      notifyRenderer('conversations:refresh', undefined)
    },
    db,   // NEW
  }
}
```

- [ ] **Step 10.2 : Ajouter `db` à `createCoreContext` (headless)**

Dans `src/headless/taskRunner.ts`, dans `createCoreContext(db)` retourner l'objet avec `db` ajouté :

```ts
function createCoreContext(db: any): TaskRunContext {
  const sessionsBase = getSessionsBase()
  const knowledgesDir = getKnowledgesDir()
  return {
    // ... tous les champs existants inchangés
    onConversationsRefresh() {},
    db,   // NEW
  }
}
```

- [ ] **Step 10.3 : Build + tests globaux**

Run: `npm run build && npm test`
Expected: PASS — 0 erreur TS, tous les tests verts.

- [ ] **Step 10.4 : Lancement manuel rapide du scheduler**

Créer une tâche test via l'UI ou via le CLI headless, avec prompt `Bonjour {task_name}, on est le {today_date}`. Déclencher une exécution (tick rapide ou run manuel). Vérifier dans `~/.config/agent-desktop/agent_scheduler.log` que le message user enregistré est `Bonjour <name>, on est le 2026-04-16`.

Alternative sans scheduler réel : écrire un petit test d'intégration avec le scheduler en mémoire. Skippable si le test d'integration dans Task 9.1 + les tests unitaires couvrent suffisamment.

- [ ] **Step 10.5 : Commit**

```bash
git add src/main/services/scheduler.ts src/headless/taskRunner.ts
git commit -m "feat(scheduler): expose db in TaskRunContext for variable resolver"
```

---

## Task 11 : Promouvoir `typescript` + vérifier bundle headless

**Files:**
- Modify: `package.json`

- [ ] **Step 11.1 : Déplacer `typescript` de `devDependencies` à `dependencies`**

Éditer `package.json` :
- Supprimer `"typescript": "^5.7.3"` de `devDependencies`
- Ajouter `"typescript": "^5.7.3"` dans `dependencies` (après `sql.js` par ordre alphabétique)

Attention : `sql.js` est avant `three` dans l'ordre actuel. L'ordre alphabétique place `typescript` après `three`.

- [ ] **Step 11.2 : Réinstaller les dépendances**

Run: `npm install`
Expected: `typescript` devient une `dependency`, `package-lock.json` mis à jour.

- [ ] **Step 11.3 : Build headless**

Run: `npm run build:headless`
Expected:
- Génère `out/headless/index.js`
- `typescript` est bundlé dans le fichier de sortie (pas marqué `--external`)
- Aucune erreur

Vérification taille : `ls -lh out/headless/index.js` — attendu ≈ +5-10 MB à cause de `typescript` bundlé.

- [ ] **Step 11.4 : Smoke test du headless**

Créer un fichier de fonction custom pour tester chaud :
```bash
mkdir -p ~/.agent-desktop/functions
cat > ~/.agent-desktop/functions/hello.ts <<'EOF'
export default (args: string[]) => `bonjour ${args[0] ?? 'monde'}`
EOF
```

Puis lancer `node out/headless/index.js --server --port 9999` (si le scheduler tick est intégré) et vérifier qu'une tâche avec prompt `{hello:laurent}` résout vers `bonjour laurent`. Peut aussi être vérifié via un test d'intégration existant.

- [ ] **Step 11.5 : Build Electron complet**

Run: `npm run build`
Expected: 0 erreur.

- [ ] **Step 11.6 : Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: promote typescript to runtime dependency (needed by variableResolver)"
```

---

## Task 12 : Types d'aide pour les fichiers custom utilisateur

**Files:**
- Create: `types/functions.d.ts`

- [ ] **Step 12.1 : Créer la déclaration de types**

Écrire `types/functions.d.ts` :

```ts
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
```

- [ ] **Step 12.2 : Commit**

```bash
git add types/functions.d.ts
git commit -m "docs: publish VariableFn types for custom scheduler function authors"
```

---

## Récapitulatif final

- [ ] **Run complet des tests**

Run: `npm test`
Expected: tous verts, couverture ≥ 70% lignes / 60% branches sur le nouveau module.

- [ ] **Build complet**

Run: `npm run build && npm run build:headless`
Expected: 0 erreur, 0 warning TS.

- [ ] **Vérification manuelle end-to-end**

1. Lancer l'app Electron (`npm run dev`)
2. Créer une tâche planifiée avec prompt :
   `Résumé du {task_name} ({today_date:DD/MM/YYYY}). Dernière sortie : {previous_output:300}`
3. Lancer la tâche manuellement
4. Vérifier dans la conversation que le message user persisté correspond au prompt résolu
5. Éditer `~/.agent-desktop/functions/hello.ts`, relancer la tâche → nouvelle valeur reflétée (hot-reload)

---

## Self-review (avant implémentation)

**Couverture spec :** Chaque section numérotée du spec (2 à 9) est implémentée par au moins une tâche :
- §2 Syntaxe → Task 2
- §3 Architecture + §4 Interfaces → Task 1, Task 9
- §5 Built-ins → Tasks 3, 4, 5, 6
- §6 Custom → Task 7
- §7 Erreurs → Task 8 (resolveOne) + Task 2 (passthrough en tokenization)
- §8 Parallélisme → Task 8 (Promise.all)
- §9 Dépendances → Task 11
- §10 Tests → intégrés partout
- §11 Volume → ok, ~880 lignes attendues

**Pas de placeholder :** Chaque step contient du code ou une commande concrète. Les imports et signatures sont cohérents entre tasks (p.ex. `VariableFn` importé depuis `./types` partout).

**Cohérence des types :**
- `VariableFn` est défini Task 1, utilisé Tasks 3-8
- `ResolverCtx` défini Task 1, utilisé Tasks 3-8
- `ResolutionReport.errors[0].reason` = `'timeout' | 'throw' | 'bad_args' | 'unknown'` — utilisé seulement avec `'throw'`, `'timeout'`, `'unknown'` en Task 8 (`'bad_args'` prévu pour usage futur, acceptable)
- `TaskRunContext.db: Database` ajouté Task 9, fourni Task 10 dans les deux providers

**Gaps potentiels :** Aucun. Le plan couvre la totalité du design validé.

---

**Plan terminé.** Deux options d'exécution :

1. **Subagent-Driven (recommandé)** — un subagent frais par task, review entre chaque, itération rapide
2. **Inline Execution** — exécution séquentielle dans cette session avec checkpoints

Quelle approche ?
