export class ClientApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message)
  }
}

export async function apiFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  })
  const payload = await response.json() as
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string } }

  if (!response.ok || !payload.ok) {
    const failure = payload as { ok: false; error: { code: string; message: string } }
    throw new ClientApiError(failure.error.code, failure.error.message, response.status)
  }
  return payload.data
}
