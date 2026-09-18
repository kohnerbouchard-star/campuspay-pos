const numericKeys = new Set([
  'stock_on_hand', 'quantity', 'quantity_received', 'quantity_remaining',
  'quantity_on_hand', 'reorder_level', 'redemption_count', 'discount_value',
  'percentage_bps', 'total_redemption_limit', 'per_student_limit', 'total_quantity',
  'year_group', 'total_count', 'total_closed',
])

function shouldBeNumber(key: string): boolean {
  return key.endsWith('_won') || numericKeys.has(key)
}

export function normalizeDatabaseValue(value: unknown, key = ''): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((entry) => normalizeDatabaseValue(entry))
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        normalizeDatabaseValue(childValue, childKey),
      ]),
    )
  }
  if (typeof value === 'bigint') {
    const number = Number(value)
    if (!Number.isSafeInteger(number)) throw new Error(`Database integer exceeds JavaScript safe range: ${key}`)
    return number
  }
  if (typeof value === 'string' && shouldBeNumber(key) && /^-?\d+(?:\.0+)?$/.test(value)) {
    const number = Number(value)
    if (!Number.isSafeInteger(number)) throw new Error(`Database integer exceeds JavaScript safe range: ${key}`)
    return number
  }
  return value
}
