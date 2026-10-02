/** A failed transport is not proof that a financial mutation was rejected. */
export class ClientApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly requestId: string | null = null,
    public readonly outcome: 'rejected' | 'unknown' = 'rejected',
  ) {
    super(message)
    this.name = 'ClientApiError'
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function apiFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    // Deliberately no automatic retry: a lost response may hide a committed write.
    response = await fetch(input, { ...init, headers, cache: 'no-store' })
  } catch {
    throw new ClientApiError('NETWORK_ERROR', 'The service could not be reached. The result is unknown; recover any pending operation before trying it again.', 0, null, 'unknown')
  }
  const candidate = response.headers.get('x-request-id')
  const requestId = candidate && /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : null
  const unreadable = () => new ClientApiError(
    'INVALID_RESPONSE',
    `The service returned an unreadable response (HTTP ${response.status}). The result is unknown; recover any pending operation before trying it again.${requestId ? ` Request: ${requestId}` : ''}`,
    response.status, requestId, 'unknown',
  )
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if (contentType !== 'application/json') throw unreadable()
  let payload: unknown
  try { payload = await response.json() } catch { throw unreadable() }
  if (!object(payload)) throw unreadable()
  if (response.ok && payload.ok === true) return payload.data as T
  if (!response.ok && payload.ok === false && object(payload.error)
    && typeof payload.error.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(payload.error.code)
    && typeof payload.error.message === 'string' && payload.error.message.length <= 2000) {
    throw new ClientApiError(payload.error.code, payload.error.message, response.status, requestId, response.status >= 500 ? 'unknown' : 'rejected')
  }
  // Do not display upstream HTML, plaintext, arbitrary JSON or response bodies.
  throw unreadable()
}
