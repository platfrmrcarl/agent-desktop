interface ScrubRule {
  name: string
  regex: RegExp
  replacement: string
}

const RULES: ScrubRule[] = [
  { name: 'homeDirPath', regex: /\/home\/[A-Za-z0-9_-]+/g, replacement: '~' },
  { name: 'windowsUserPath', regex: /C:\\Users\\[^\\]+/g, replacement: 'C:\\Users\\~' },
  { name: 'emailAddress', regex: /[\w.+-]+@[\w-]+\.[\w.-]+/g, replacement: '<email>' },
  {
    name: 'apiKeyLike',
    regex: /\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    replacement: '<redacted-key>',
  },
  { name: 'bearerToken', regex: /Bearer\s+[A-Za-z0-9._-]{20,}/g, replacement: 'Bearer <redacted>' },
]

export function scrub(text: string): string {
  let out = text
  for (const rule of RULES) {
    out = out.replace(rule.regex, rule.replacement)
  }
  return out
}
