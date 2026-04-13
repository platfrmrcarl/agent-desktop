export function validateString(value: unknown, name: string, maxLength = 10000): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`)
  if (value.length > maxLength) throw new Error(`${name} exceeds max length (${maxLength})`)
  return value
}

export function validatePositiveInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}
