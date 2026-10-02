import { z } from 'zod'
import { ApiError } from './errors'
import { randomUUID } from 'node:crypto'
import { failure, assertMutationOrigin } from './response'
import { requestContext } from './request-context'

/** Route templates are constants supplied by code. Never log URLs, query strings,
 * bodies, cookies, exception messages, or database error objects.
 */
export function withApiRoute<Args extends unknown[]>(route: string, handler: (request: Request, ...args: Args) => Promise<Response>) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    const incoming = request.headers.get('x-request-id')
    const requestId = incoming && /^[0-9a-f-]{36}$/.test(incoming) ? incoming : randomUUID()
    const started = performance.now()
    return requestContext.run({ requestId }, async () => {
      let response: Response
      try {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) assertMutationOrigin(request)
        const keys = [...route.matchAll(/\[([A-Za-z]+Id)\]/g)].map(match => match[1])
        if (keys.length) {
          const context = args[0] as { params?: Promise<Record<string, string>> } | undefined
          const params = await context?.params
          if (keys.some(key => !z.string().uuid().safeParse(params?.[key]).success)) {
            throw new ApiError(400, 'BAD_REQUEST', 'Choose a valid record identifier')
          }
        }
        response = await handler(request, ...args)
      } catch (error) { response = failure(error) }
      response.headers.set('X-Request-ID', requestId)
      console.info(JSON.stringify({
        event: 'api_request', request_id: requestId, timestamp: new Date().toISOString(),
        route, method: request.method, status: response.status,
        code: requestContext.getStore()?.errorCode ?? (response.ok ? 'OK' : 'HTTP_ERROR'),
        surface: route.startsWith('/api/store/') ? 'STORE' : 'STAFF',
        duration_ms: Math.round(performance.now() - started),
      }))
      return response
    })
  }
}
