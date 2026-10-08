import { withApiRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { authorizeRequest } from '@/features/auth/server/session'
import { photoId, photoJson } from '@/features/product-photos/body'
import { PhotoEditSchema, PhotoRequestSchema } from '@/features/product-photos/domain'
import { changePhoto, readPhoto, stagePhoto } from '@/features/product-photos/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60
type Context = { params: Promise<{ productId: string }> }
const route = '/api/inventory/products/[productId]/photo'
export const GET = withApiRoute(route, async (request: Request, context: Context) => {
  const session = await authorizeRequest('inventory.product.manage')
  const productId = photoId((await context.params).productId)
  const reference = new URL(request.url).searchParams.get('requestId')
  return ok(await readPhoto(session, productId, reference === null ? null : photoId(reference)))
})
export const POST = withApiRoute(route, async (request: Request, context: Context) => {
  const session = await authorizeRequest('inventory.product.manage')
  return ok(await stagePhoto(session, photoId((await context.params).productId), request))
})
export const PUT = withApiRoute(route, async (request: Request, context: Context) => {
  const session = await authorizeRequest('inventory.product.manage')
  const { requestId } = await photoJson(request, PhotoRequestSchema)
  return ok(await changePhoto(session, photoId((await context.params).productId), requestId, 'COMMIT'))
})
export const DELETE = withApiRoute(route, async (request: Request, context: Context) => {
  const session = await authorizeRequest('inventory.product.manage')
  const { requestId, revision, reason } = await photoJson(request, PhotoEditSchema)
  return ok(await changePhoto(session, photoId((await context.params).productId), requestId, 'REMOVE', { revision, reason }))
})
