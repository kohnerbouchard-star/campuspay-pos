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
