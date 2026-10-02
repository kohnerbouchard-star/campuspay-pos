/** Only a validated application rejection is a ClientApiError. Transport errors
 * must remain distinct: a failed response does not prove a mutation rolled back. */
export class ClientApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number, public readonly requestId: string | null = null) {
    super(message)
    this.name = 'ClientApiError'
  }
}

export class TransportApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number, public readonly requestId: string | null = null) {
    super(message)
    this.name = 'TransportApiError'
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function apiFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  let response: Response
  try { response = await fetch(input, { ...init, headers, cache: 'no-store' }) }
  catch {
    throw new TransportApiError('NETWORK_ERROR', 'The connection was interrupted. The result is not confirmed; recover any pending operation before trying a new request.', 0)
  }
  const trace = response.headers.get('x-request-id')
  const requestId = trace && /^[a-zA-Z0-9:_-]{1,128}$/.test(trace) ? trace : null
  const invalid = () => new TransportApiError('INVALID_RESPONSE',
    `The server returned an unrecognized response (HTTP ${response.status}). The result is not confirmed.${requestId ? ` Request ID: ${requestId}.` : ''}`, response.status, requestId)
  let payload: unknown
  try { payload = await response.json() } catch { throw invalid() }
  if (!object(payload)) throw invalid()
  if (response.ok && payload.ok === true && Object.hasOwn(payload, 'data')) return payload.data as T
  if (!response.ok && payload.ok === false && object(payload.error) &&
      typeof payload.error.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(payload.error.code) &&
      typeof payload.error.message === 'string' && payload.error.message.length > 0 && payload.error.message.length <= 1000) {
    throw new ClientApiError(payload.error.code, payload.error.message, response.status, requestId)
  }
  throw invalid()
}
