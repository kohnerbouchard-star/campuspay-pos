export class ClientApiError extends Error {
  public readonly code: string
  public readonly status: number
  public readonly fieldErrors: readonly { field: string; message: string }[]

  constructor(code: string, message: string, status: number, fieldErrors: readonly { field: string; message: string }[] = []) {
    super(message)
    this.name = 'ClientApiError'
    this.code = code
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

/**
 * The server may have committed a mutation even when its response is unreadable.
 * This must NOT extend ClientApiError: checkout uses that class to distinguish
 * a confirmed rejection from a result that still needs transaction recovery.
 */
export class UnconfirmedApiResponseError extends Error {
  public readonly status: number

  constructor(status: number) {
    super(`CampusPay received an unexpected server response (HTTP ${status}). The result could not be confirmed. Check its status before repeating a payment or protected action.`)
    this.name = 'UnconfirmedApiResponseError'
    this.status = status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Optional validation metadata must not change rejection/recovery semantics.
function fieldErrorsFrom(details: unknown): { field: string; message: string }[] {
  if (!isRecord(details) || !Array.isArray(details.fieldErrors)) return []
  return details.fieldErrors.slice(0, 8).filter((value): value is { field: string; message: string } =>
    isRecord(value) && typeof value.field === 'string' && /^[A-Za-z_][A-Za-z0-9_.]{0,159}$/.test(value.field)
    && !value.field.split('.').some(part => ['__proto__', 'prototype', 'constructor'].includes(part))
    && typeof value.message === 'string' && value.message.trim().length > 0 && value.message.length <= 240
    && !/[\u0000-\u001f<>]/.test(value.message)
  ).map(({ field, message }) => ({ field, message }))
}

export async function apiFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  // HeadersInit also accepts Headers and tuple arrays. Object spreading silently
  // loses those values. Explicit init headers override Request headers as usual.
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  // Never retry a mutation or follow it to a login/deployment redirect. Transport
  // failures intentionally remain non-ClientApiError, preserving recovery state.
  const response = await fetch(input, { ...init, headers, cache: 'no-store', redirect: 'error' })
  if (response.redirected) throw new UnconfirmedApiResponseError(response.status)

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    // Do not expose proxy HTML, raw deployment errors, or parse exceptions.
    throw new UnconfirmedApiResponseError(response.status)
  }

  if (isRecord(payload)) {
    if (response.ok && payload.ok === true && Object.hasOwn(payload, 'data')) {
      return payload.data as T
    }
    if (!response.ok && response.status >= 400 && payload.ok === false && isRecord(payload.error)) {
      const { code, message } = payload.error
      if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(code) && typeof message === 'string' && message.trim() && message.length <= 1000) {
        throw new ClientApiError(code, message, response.status, response.status === 400 && code === 'BAD_REQUEST' ? fieldErrorsFrom(payload.error.details) : [])
      }
    }
  }
  throw new UnconfirmedApiResponseError(response.status)
}
