const SHORT_WINDOW_MS = 60_000          // 1 min
const SHORT_LIMIT = 5                   // max failures per minute
const LONG_BAN_THRESHOLD = 20           // failures within 15 min
const LONG_BAN_MS = 15 * 60 * 1000

interface IpRecord {
  failures: number
  firstFailureAt: number
  bannedUntil: number
}

interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds?: number
}

export interface RateLimiter {
  check(ip: string): RateLimitResult
  recordAttempt(ip: string, success: boolean): void
}

function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip
}

export function createRateLimiter(): RateLimiter {
  const records = new Map<string, IpRecord>()

  function prune(now: number): void {
    for (const [ip, rec] of records) {
      if (rec.bannedUntil > now) continue
      if (now - rec.firstFailureAt > LONG_BAN_MS) records.delete(ip)
    }
  }

  return {
    check(ip) {
      const key = normalizeIp(ip)
      const now = Date.now()
      prune(now)
      const rec = records.get(key)
      if (!rec) return { allowed: true }
      if (rec.bannedUntil > now) {
        return { allowed: false, retryAfterSeconds: Math.ceil((rec.bannedUntil - now) / 1000) }
      }
      return { allowed: true }
    },
    recordAttempt(ip, success) {
      const key = normalizeIp(ip)
      const now = Date.now()
      if (success) {
        records.delete(key)
        return
      }
      const existing = records.get(key)
      if (!existing) {
        records.set(key, { failures: 1, firstFailureAt: now, bannedUntil: 0 })
        return
      }
      existing.failures += 1
      if (existing.failures >= LONG_BAN_THRESHOLD) {
        existing.bannedUntil = now + LONG_BAN_MS
      } else if (existing.failures >= SHORT_LIMIT) {
        existing.bannedUntil = now + SHORT_WINDOW_MS
      }
    },
  }
}
