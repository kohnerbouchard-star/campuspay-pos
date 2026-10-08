import 'server-only'
import { z } from 'zod'
import type { SessionContext } from '@/features/auth/domain'
import { requireCapability } from '@/features/auth/server/capability-guard'
import { callApiRpc } from '@/lib/db/rpc'
import { ApiError } from '@/lib/api/errors'
import { photoConfig } from './config'
import { photoStorage } from './storage'

const CleanupObject = z.object({ asset_id: z.uuid(), product_id: z.uuid(), namespace: z.string(), origin: z.string(), token: z.uuid() })
const CleanupResult = z.object({ objects: z.array(CleanupObject).max(5) })
export async function cleanupPhotos(session: SessionContext) {
  requireCapability(session, 'inventory.product.manage')
  const config = photoConfig()
  const run = (assetId: string | null, token: string | null) => callApiRpc('product_photo_cleanup', {
    p_session_id: session.session_id, p_namespace: config.namespace, p_origin: config.origin,
    p_asset_id: assetId, p_token: token,
  }, z.array(z.object({ result: CleanupResult })).length(1).transform(([row]) => row.result))
  const claimed = await run(null, null)
  let deleted = 0; let deferred = 0
  // At most five assets / ten generated keys; no scheduler, list-all or browser paths.
  for (const object of claimed.objects) {
    if (object.namespace !== config.namespace || object.origin !== config.origin)
      throw new ApiError(503, 'CONNECTION_NOT_CONFIGURED', 'Cleanup store identity does not match.')
    try {
      await photoStorage(config).remove(object.product_id, object.asset_id)
      await run(object.asset_id, object.token)
      deleted++
    } catch { deferred++ }
  }
  return { claimed: claimed.objects.length, deleted, deferred }
}
