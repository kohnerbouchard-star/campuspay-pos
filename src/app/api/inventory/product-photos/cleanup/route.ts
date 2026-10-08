import { z } from 'zod'
import { withApiRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { authorizeRequest } from '@/features/auth/server/session'
import { photoJson } from '@/features/product-photos/body'
import { cleanupPhotos } from '@/features/product-photos/cleanup'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60
export const POST = withApiRoute('/api/inventory/product-photos/cleanup', async (request: Request) => {
  const session = await authorizeRequest('inventory.product.manage')
  await photoJson(request, z.object({}).strict())
  return ok(await cleanupPhotos(session))
})
