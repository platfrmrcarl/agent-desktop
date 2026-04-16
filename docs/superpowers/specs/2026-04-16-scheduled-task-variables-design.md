# Variables dans les prompts des tâches planifiées

**Date :** 2026-04-16
**Statut :** Spec validée — prêt pour implémentation
**Auteur :** Laurent Baaziz

---

## 1. Contexte et problème

Les tâches planifiées (`scheduled_tasks`) stockent aujourd'hui un `prompt` brut (TEXT, DB) envoyé tel quel au LLM à chaque exécution. Il n'y a aucun moyen d'injecter la date du jour, le nom de la tâche, le résultat d'une commande système, ou toute autre valeur dynamique dans le prompt.

Objectif : permettre à l'utilisateur d'insérer des variables dans le prompt (ex : `{today_date}`, `{last_commit:--short}`) qui sont résolues à l'exécution. Livrer un **kit built-in** et un **mécanisme d'extension** via fichiers TypeScript utilisateur dans `~/.agent-desktop/functions/*.ts`.

### Contraintes

- La résolution doit fonctionner identiquement en **Electron** et en **headless** (web server, Discord bot)
- Le point d'exécution est unique : `core/services/taskExecutor.ts:55` (`ctx.saveMessage(task.conversation_id, 'user', task.prompt)`)
- Pas de duplication entre les deux contextes — le code vit dans `core/`
- Les fichiers `.ts` custom doivent être rechargés à chaud (édition = effet immédiat, sans redémarrer l'app)

---

## 2. Syntaxe

```
{name}                 → variable simple
{name:arg}             → variable avec un argument
{name:arg1:arg2}       → variable avec plusieurs arguments
```

**Règles :**

- `name` : identifiant `[a-zA-Z_][a-zA-Z0-9_]*` (casse sensible)
- `arg` : tout caractère sauf `:` et `}`
- Séparateur d'arguments figé : `:`
- Aucune séquence d'échappement en v1 (limite acceptée, documentée)

**Regex :** `/\{([a-zA-Z_][a-zA-Z0-9_]*)((?::[^:}]*)*)\}/g`

**Cas limites :**

| Input | Comportement |
|---|---|
| `"{ foo }"` | Non matché (espaces) — laissé littéral |
| `"{a}{b}"` | Deux variables matchées |
| `"{made_up}"` (non définie) | Passthrough — laissée telle quelle dans le prompt final |
| `"{random:abc}"` (args invalides) | Remplacée par `[erreur: random — ...]` |

---

## 3. Architecture

### 3.1 Nouveau module `src/core/services/variableResolver/`

```
variableResolver/
├── index.ts          # API publique : resolveVariables, resolveVariablesWithReport, listVariables
├── syntax.ts         # tokenize(input: string): Token[]
├── builtins.ts       # BUILTINS[] + builtinRegistry Map
├── customLoader.ts   # loadCustomVariable, listCustomVariables, pruneCache
└── types.ts          # ResolverCtx, VariableFn, BuiltinSpec, ResolutionReport
```

### 3.2 Flux d'exécution

```
task.prompt
    ↓ tokenize()
Token[] (lit | var)
    ↓ Promise.all sur les VAR
    ↓   - loadCustomVariable(name) → si trouvé, exécute
    ↓   - sinon builtinRegistry.get(name) → exécute
    ↓   - sinon passthrough (laisse {name})
    ↓ chaque appel sous Promise.race(fn, timeout 5000ms)
    ↓ erreurs → "[erreur: name — message]"
resolved string
    ↓ ctx.saveMessage(conversation_id, 'user', resolved)
```

### 3.3 Point d'injection unique

Modification dans `core/services/taskExecutor.ts` :

```ts
// AVANT (ligne 55)
ctx.saveMessage(task.conversation_id, 'user', task.prompt)

// APRÈS
const { resolved, errors } = await resolveVariablesWithReport(task.prompt, {
  task,
  cwd: aiSettings.cwd,
  db: ctx.db,
  now: new Date(),
})
if (errors.length > 0) {
  console.warn(`[scheduler] Task "${task.name}" variable errors:`, errors)
}
ctx.saveMessage(task.conversation_id, 'user', resolved)
```

### 3.4 Extension de `TaskRunContext`

Ajout d'un seul champ à l'interface existante :

```ts
export interface TaskRunContext {
  // ... champs existants (saveMessage, buildHistory, getAISettings, ...)
  db: Database   // NEW — lecture pour previous_output et futures built-ins
}
```

Les deux contextes fournissent déjà `db` :
- `src/main/services/scheduler.ts:40` → `createElectronContext` passe `schedulerDb` (une ligne ajoutée)
- `src/headless/taskRunner.ts:59` → `createCoreContext` passe le `db` reçu en paramètre (une ligne ajoutée)

---

## 4. Interfaces et types

```ts
// types.ts

export interface ResolverCtx {
  task: ScheduledTask
  cwd: string
  db: Database
  now: Date    // instant stable pour toute une résolution
}

export type VariableFn = (
  args: string[],
  ctx: ResolverCtx
) => string | Promise<string>

export interface BuiltinSpec {
  name: string
  description: string
  argsHint?: string
  fn: VariableFn
}

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

**API publique** (`index.ts`) :

```ts
export async function resolveVariables(
  prompt: string,
  ctx: ResolverCtx,
  opts?: { timeoutMs?: number; functionsDir?: string }
): Promise<string>

export async function resolveVariablesWithReport(
  prompt: string,
  ctx: ResolverCtx,
  opts?: { timeoutMs?: number; functionsDir?: string }
): Promise<ResolutionReport>

export async function listVariables(
  opts?: { functionsDir?: string }
): Promise<Array<{
  name: string
  description: string
  source: 'builtin' | 'custom'
  argsHint?: string
}>>
```

---

## 5. Built-ins v1

| Variable | Args | Type | Description |
|---|---|---|---|
| `today_date` | FORMAT? | sync | Date du jour (ISO par défaut). Formats : DD, MM, YYYY, HH, mm, ss |
| `now` | — | sync | Timestamp ISO complet avec TZ |
| `time` | — | sync | Heure HH:mm |
| `timestamp` | — | sync | Unix timestamp en secondes |
| `day_of_week` | — | sync | Jour de la semaine en français |
| `random` | min:max? | sync | Entier aléatoire (défaut 0:100) |
| `task_name` | — | sync + ctx | Nom de la tâche en cours |
| `task_run_count` | — | sync + ctx | Numéro d'exécution (1-indexed) |
| `last_run_at` | FORMAT? | sync + ctx | Date de la dernière exécution (vide si première) |
| `last_commit` | FLAGS? | async + ctx | `git log -1 --pretty=format:%h %s [FLAGS]` dans `ctx.cwd` |
| `file_contents` | PATH | async + ctx | Lecture FS (chemin relatif à `ctx.cwd` ou absolu) |
| `previous_output` | MAX_CHARS? | sync + ctx | Dernier message assistant de la conversation (troncature, défaut 2000) |

**Formatter de date** : implémentation minimale inline (pas de dépendance date-fns/dayjs). Tokens supportés : `YYYY`, `MM`, `DD`, `HH`, `mm`, `ss`.

**`ctx.now` stable** : la même instance `Date` est utilisée pour toutes les variables d'une même résolution → pas de dérive si `{today_date}` et `{timestamp}` sont résolus à 800ms d'intervalle.

**Git et fs async** : `execFile` avec `cwd: ctx.cwd`, timeout de 4000ms au niveau process (distinct du timeout global de 5000ms sur la fonction).

**SQL `previous_output`** : utilise `ctx.db.prepare().get()`. Le runtime DB est un `SqlJsAdapter` (`src/core/db/sqljs-adapter.ts`) qui normalise l'API sql.js pour qu'elle corresponde à celle de better-sqlite3 (`.prepare(sql).get(...params)` renvoie un `Record<string, unknown> | undefined`). Le code utilise le type `Database` importé depuis `better-sqlite3` uniquement comme signature TypeScript — c'est déjà la convention dans `main/services/scheduler.ts`.

---

## 6. Système custom

### 6.1 Format du fichier utilisateur

`~/.agent-desktop/functions/weather.ts` :

```ts
import type { VariableFn } from 'agent-desktop/functions'  // types optionnels

const weather: VariableFn = async (args, ctx) => {
  const city = args[0] ?? 'Paris'
  const resp = await fetch(`https://wttr.in/${city}?format=%t+%C`)
  if (!resp.ok) throw new Error(`wttr.in: ${resp.status}`)
  return (await resp.text()).trim()
}

export default weather
```

### 6.2 Transpilation et cache

**Mécanisme :** `typescript.transpileModule()` au premier appel (ou mtime changé), résultat écrit dans `~/.agent-desktop/functions/.cache/<name>-<mtime>.mjs`, importé dynamiquement via `import(pathToFileURL(cacheFile).href)`.

**Pourquoi `typescript` et pas `esbuild`** : `esbuild` est un binaire natif Go, non bundlable dans `out/headless/index.js` (le bundle esbuild du headless). `typescript` est pur JS, bundlable, déjà en devDependencies (à promouvoir en dependencies).

**Compiler options** (identiques pour tous les fichiers custom) :

```ts
{
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  esModuleInterop: true,
  isolatedModules: true,     // garantit un transpile fidèle sans cross-file type-checking
}
```

**Cache invalidation** : `fs.stat()` au début de chaque `loadCustomVariable()`. Si `mtimeMs` a changé depuis le dernier chargement, retranspile. Coût : un `stat()` par appel (≈ microsecondes).

**Hot-reload** : implicite via mtime. L'utilisateur édite, sauvegarde, la prochaine exécution voit le nouveau code. Pas de watcher fs nécessaire.

**`pruneCache()`** : utilitaire optionnel appelé au démarrage du scheduler. Garde le plus récent `.mjs` par nom de variable, supprime les anciens.

### 6.3 Override built-in ↔ custom

Si `~/.agent-desktop/functions/today_date.ts` existe, il **remplace** le built-in `today_date`. Permet à l'utilisateur de personnaliser les comportements par défaut (ex : un autre formatter de date).

Un `console.warn` est émis au premier chargement d'un override, pour la traçabilité.

### 6.4 Sécurité

Les fichiers custom s'exécutent **avec les mêmes privilèges que l'app** (accès fs, network, `child_process`, etc.). Pas de sandbox.

Rationale :
- Cohérence avec les hooks Claude Code (même modèle de confiance : fichiers dans `$HOME`, utilisateur qui les écrit)
- Une sandbox (`worker_threads` + `vm`) bloquerait `fetch`/`fs`/`child_process` — précisément ce que les custom voudront faire

Documentation explicite requise : "ces fichiers s'exécutent avec vos privilèges utilisateur — ne collez pas du code que vous ne comprenez pas".

---

## 7. Gestion d'erreurs

**Politique** : inconnue = passthrough ; throw / timeout = marqueur d'erreur dans le prompt ; la tâche **continue toujours** (pas d'échec global pour cause de variable).

| Scénario | Résultat dans le prompt | Loggé dans `errors[]` |
|---|---|---|
| Variable inconnue `{made_up}` | `{made_up}` (passthrough) | `reason: 'unknown'` |
| Function throw | `[erreur: name — message]` | `reason: 'throw'` |
| Function timeout (> 5000ms) | `[erreur: name — timeout 5000ms]` | `reason: 'timeout'` |
| Arguments invalides (throw dans fn) | `[erreur: name — message]` | `reason: 'throw'` |
| `loadCustomVariable` throw (ex : TS invalide) | `[erreur: chargement name]` | `reason: 'throw'` |

**Timeout** : `Promise.race(fn(args, ctx), setTimeout(5000ms))`. Configurable via `opts.timeoutMs`.

**Logging** : le scheduler loggue `console.warn('[scheduler] Task "<name>" variable errors:', errors)` quand `errors.length > 0`. Visible dans `~/.config/agent-desktop/agent_scheduler.log`.

---

## 8. Parallélisme

Tous les tokens `VAR` d'un même prompt sont résolus **en parallèle** via `Promise.all`. Pour un prompt avec 3 variables async (timeout 5s chacune), le pire cas est **5s**, pas **15s**.

```ts
const resolved = await Promise.all(
  tokens.map(t =>
    t.type === 'lit'
      ? Promise.resolve(t.value)
      : resolveOne(t.name, t.args, t.raw, ctx, timeoutMs, opts.functionsDir, errors)
  )
)
return resolved.join('')
```

---

## 9. Dépendances

| Package | Action | Justification |
|---|---|---|
| `typescript` | Promouvoir `devDep` → `dep` | Runtime transpile des custom `.ts` |

Vérifier que `build:headless` bundle `typescript` proprement (pas de `--external` nécessaire — pur JS sans binaire).

---

## 10. Tests

```
src/core/services/variableResolver/
  syntax.test.ts          ~50 lignes — tokenizer, 15+ cas edge
  builtins.test.ts        ~180 lignes — chaque built-in (sync, async, ctx, erreurs)
  customLoader.test.ts    ~100 lignes — transpile, cache mtime, hot-reload via fixture fs
  index.test.ts           ~120 lignes — intégration, passthrough, timeout, override
```

**Tests d'intégration :**
- `scheduler.test.ts` : nouveau cas "prompt avec `{today_date}` → résolu avant `saveMessage`"
- `taskExecutor.test.ts` : mock `ctx.db`, stub la résolution, vérifier que `saveMessage` reçoit la string résolue

---

## 11. Volume de code estimé

| Fichier | Lignes |
|---|---|
| `types.ts` | ~35 |
| `syntax.ts` | ~40 |
| `builtins.ts` | ~140 |
| `customLoader.ts` | ~100 |
| `index.ts` | ~100 |
| Tests | ~450 |
| Modifs `taskExecutor.ts` + `main/scheduler.ts` + `headless/taskRunner.ts` | ~15 |
| **Total** | **~880 lignes** |

---

## 12. Hors scope v1 (reporté)

- UI d'autocomplete dans le formulaire de tâche (`listVariables()` est exposée, l'UI viendra dans une itération suivante)
- Escape syntax (`\{literal}`)
- Variables à portée de folder / settings cascadés
- Sandbox d'exécution pour les custom
- Watcher fs (`fs.watch`) — l'invalidation mtime suffit
- Tooltip / doc inline des built-ins dans la TaskFormModal

---

## 13. Ordre d'implémentation suggéré

1. `types.ts` — fondations
2. `syntax.ts` + tests — tokenizer isolé
3. `builtins.ts` + tests — tous les built-ins (sync d'abord, async ensuite)
4. `customLoader.ts` + tests — transpile, cache, hot-reload
5. `index.ts` + tests — API publique, orchestration, timeout, parallélisme
6. Intégration : modifier `TaskRunContext` (ajout `db`), `taskExecutor.ts:55`, `main/scheduler.ts`, `headless/taskRunner.ts`
7. Tests d'intégration : `scheduler.test.ts`, `taskExecutor.test.ts`
8. Promouvoir `typescript` en dependencies, vérifier bundle headless
9. Documentation utilisateur : section README ou docs/ sur la syntaxe et les customs
