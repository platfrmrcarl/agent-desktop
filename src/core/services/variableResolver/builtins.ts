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
]

export const builtinRegistry = new Map<string, BuiltinSpec>(
  BUILTINS.map(b => [b.name, b])
)
