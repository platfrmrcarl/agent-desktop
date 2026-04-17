const TZ_SUFFIX = /(Z|[+-]\d{2}:?\d{2})$/

export function parseDbTimestamp(value: string): Date {
  if (TZ_SUFFIX.test(value)) return new Date(value)
  return new Date(`${value.replace(' ', 'T')}Z`)
}
