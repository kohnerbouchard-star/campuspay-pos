import { withApiRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { authorizeRequest } from '@/features/auth/server/session'
import { photoId, photoJson } from '@/features/product-photos/body'
import { PhotoRequestSchema } from '@/features/product-photos/domain'
import { changePhoto } from '@/features/product-photos/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60
export const POST = withApiRoute('/api/inventory/products/[productId]/photo/cancel', async (request: Request, context: { params: Promise<{ productId: string }> }) => {
  const session = await authorizeRequest('inventory.product.manage')
  const { requestId } = await photoJson(request, PhotoRequestSchema)
  return ok(await changePhoto(session, photoId((await context.params).productId), requestId, 'CANCEL'))
})
