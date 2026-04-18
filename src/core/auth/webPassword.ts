import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'crypto'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64
const SALT_BYTES = 16
const SESSION_SECRET_BYTES = 32
const MIN_PASSWORD_LENGTH = 8

export interface SettingsPort {
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
}

export interface WebPasswordService {
  setPassword(plaintext: string): Promise<void>
  clearPassword(): Promise<void>
  verifyPassword(plaintext: string): Promise<boolean>
  isPasswordSet(): boolean
  issueCookie(rememberMe: boolean): string
  validateCookie(cookieValue: string): boolean
  getSessionDurationDays(): number
  setSessionDurationDays(days: number): void
  getRememberDurationDays(): number
  setRememberDurationDays(days: number): void
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function formatPhc(salt: Buffer, hash: Buffer): string {
  return `$scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`
}

function parsePhc(phc: string): { N: number; r: number; p: number; salt: Buffer; hash: Buffer } | null {
  const m = phc.match(/^\$scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/=_-]+)\$([A-Za-z0-9+/=_-]+)$/)
  if (!m) return null
  return {
    N: parseInt(m[1], 10),
    r: parseInt(m[2], 10),
    p: parseInt(m[3], 10),
    salt: b64urlDecode(m[4]),
    hash: b64urlDecode(m[5]),
  }
}

export function createWebPasswordService(settings: SettingsPort): WebPasswordService {
  function getDurationDays(key: string, fallback: number): number {
    const raw = settings.get(key)
    if (!raw) return fallback
    const n = parseInt(raw, 10)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }

  return {
    async setPassword(plaintext: string): Promise<void> {
      if (typeof plaintext !== 'string' || plaintext.length < MIN_PASSWORD_LENGTH) {
        throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      }
      const salt = randomBytes(SALT_BYTES)
      const hash = scryptSync(plaintext, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
      settings.set('server_passwordHash', formatPhc(salt, hash))
      settings.set('server_sessionSecret', randomBytes(SESSION_SECRET_BYTES).toString('hex'))
    },

    async clearPassword(): Promise<void> {
      settings.delete('server_passwordHash')
      settings.delete('server_sessionSecret')
    },

    async verifyPassword(plaintext: string): Promise<boolean> {
      const stored = settings.get('server_passwordHash')
      if (!stored || typeof plaintext !== 'string') return false
      const parsed = parsePhc(stored)
      if (!parsed) return false
      const candidate = scryptSync(plaintext, parsed.salt, parsed.hash.length, { N: parsed.N, r: parsed.r, p: parsed.p })
      if (candidate.length !== parsed.hash.length) return false
      return timingSafeEqual(candidate, parsed.hash)
    },

    isPasswordSet(): boolean {
      return !!settings.get('server_passwordHash')
    },

    issueCookie(_rememberMe: boolean): string {
      throw new Error('not implemented yet')
    },
    validateCookie(_cookieValue: string): boolean {
      throw new Error('not implemented yet')
    },
    getSessionDurationDays(): number { return getDurationDays('server_sessionDurationDays', 7) },
    setSessionDurationDays(days: number): void { settings.set('server_sessionDurationDays', String(days)) },
    getRememberDurationDays(): number { return getDurationDays('server_rememberDurationDays', 30) },
    setRememberDurationDays(days: number): void { settings.set('server_rememberDurationDays', String(days)) },
  }
}
