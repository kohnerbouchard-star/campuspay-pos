/** Client-safe projections of request-validation failures. Never return a raw
 * Zod issue, submitted value, regex, unknown property name, or arbitrary message.
 * The schema, not the request, determines which field paths may be disclosed.
 */
export type FieldError = { field: string; message: string }
export type ValidationOptions = { allowedCustomMessages?: readonly string[] }
type Issue = { code: string; path: readonly PropertyKey[]; message?: string; expected?: unknown; minimum?: unknown; maximum?: unknown; inclusive?: unknown; origin?: unknown; format?: unknown }
const MAX_ERRORS = 8
const hiddenKeys = new Set(['__proto__', 'prototype', 'constructor'])

function definition(schema: unknown): Record<string, unknown> | null {
  if (!schema || typeof schema !== 'object' || !('_zod' in schema)) return null
  const internals = schema._zod as { def?: Record<string, unknown> } | undefined
  return internals?.def ?? null
}

// Zod 4's input-side schema definition. Unrecognized/future schema kinds fall
// back to a request-level error rather than reflecting an untrusted field name.
function declaredPath(schema: unknown, path: readonly PropertyKey[], depth = 0): boolean {
  const def = definition(schema)
  if (!def || depth > 20) return false
  if (!path.length) return true
  if (['optional', 'nullable', 'default', 'prefault', 'catch', 'readonly', 'nonoptional'].includes(String(def.type))) {
    return declaredPath(def.innerType, path, depth + 1)
  }
  if (def.type === 'pipe') return declaredPath(def.in, path, depth + 1)
  if (def.type === 'union' && Array.isArray(def.options)) return def.options.some(option => declaredPath(option, path, depth + 1))
  const [key, ...rest] = path
  if (def.type === 'array') {
    return typeof key === 'number' && Number.isSafeInteger(key) && key >= 0 && key <= 1_000_000 && declaredPath(def.element, rest, depth + 1)
  }
  if (def.type === 'object' && def.shape && typeof def.shape === 'object') {
    if (typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || hiddenKeys.has(key) || !Object.hasOwn(def.shape, key)) return false
    return declaredPath((def.shape as Record<string, unknown>)[key], rest, depth + 1)
  }
  return false
}

function bound(value: unknown): string | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= 1_000_000_000_000 ? String(value) : null
}
function issueMessage(issue: Issue, options: ValidationOptions): string {
  if (issue.code === 'custom' && typeof issue.message === 'string' && issue.message.length <= 240 && options.allowedCustomMessages?.includes(issue.message)) return issue.message
  if (issue.code === 'invalid_type') {
    if (issue.expected === 'int') return 'Enter a whole number.'
    if (issue.expected === 'number') return 'Enter a valid number.'
    if (issue.expected === 'string') return 'Enter text in this field.'
    if (issue.expected === 'boolean') return 'Choose true or false.'
    if (issue.expected === 'array') return 'Provide a list of items.'
    return 'Provide a value of the required type.'
  }
  if (issue.code === 'too_small' || issue.code === 'too_big') {
    const small = issue.code === 'too_small', limit = bound(small ? issue.minimum : issue.maximum)
    if (limit !== null) {
      const relation = small ? (issue.inclusive === false ? 'more than' : 'at least') : (issue.inclusive === false ? 'less than' : 'at most')
      if (issue.origin === 'string') return `Use ${relation} ${limit} characters.`
      if (issue.origin === 'array') return `Include ${relation} ${limit} items.`
      if (issue.origin === 'number') return `Enter a number ${relation} ${limit}.`
    }
    return 'Enter a value within the allowed range.'
  }
  if (issue.code === 'invalid_format') {
    if (issue.format === 'uuid') return 'Use a valid record reference.'
    if (issue.format === 'date') return 'Use a valid date in YYYY-MM-DD format.'
    if (issue.format === 'datetime') return 'Use a valid date and time with a timezone.'
    if (issue.format === 'email') return 'Use a valid email address.'
    return 'Use the required format.'
  }
  if (issue.code === 'invalid_value' || issue.code === 'invalid_union') return 'Select a permitted value and complete its required fields.'
  if (issue.code === 'unrecognized_keys') return 'Remove unexpected fields from this request.'
  return 'Check this value before submitting.'
}
function label(field: string): string {
  if (field === 'request') return 'Request'
  const names: Record<string, string> = { endsAt: 'Event end time (KST)', eventName: 'Event name', supplierInvoice: 'Supplier invoice', supplierName: 'Supplier', purchaseUnitCostWon: 'Purchase cost per unit (won)' }
  return field.split('.').map(part => /^\d+$/.test(part) ? `item ${Number(part) + 1}` : names[part] ?? part.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')).join(' / ')
}
export function validationFeedback(schema: unknown, issues: readonly Issue[], options: ValidationOptions = {}): { message: string; fieldErrors: FieldError[] } {
  const fieldErrors: FieldError[] = []
  for (const issue of issues) {
    if (fieldErrors.length >= MAX_ERRORS) break
    const path = Array.isArray(issue.path) ? issue.path : []
    const candidate = path.length && path.length <= 12 && declaredPath(schema, path) ? path.join('.') : 'request'
    const field = candidate.length <= 160 ? candidate : 'request'
    if (fieldErrors.some(error => error.field === field)) continue
    fieldErrors.push({ field, message: issueMessage(issue, options) })
  }
  return { message: fieldErrors.length ? fieldErrors.slice(0, 3).map(error => `${label(error.field)}: ${error.message}`).join(' ').slice(0, 950) : 'Request validation failed', fieldErrors }
}
