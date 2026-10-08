import 'server-only'
import { z } from 'zod'
import type { SessionContext } from '@/features/auth/domain'
import { requireCapability } from '@/features/auth/server/capability-guard'
import { callApiRpc } from '@/lib/db/rpc'
import { ApiError } from '@/lib/api/errors'
import { boundedBody, photoUploadMetadata } from './body'
import { photoConfig } from './config'
import { MAX_PHOTO_BYTES, PhotoSnapshotSchema, type PhotoSnapshot } from './domain'
import { processPhoto, type ProcessedImage } from './image'
import { photoStorage } from './storage'

const CommandResult = PhotoSnapshotSchema.extend({
  created: z.boolean(), upload: z.object({ asset_id: z.uuid(), namespace: z.string(), origin: z.string() }).nullable(),
})
type Action = 'READ' | 'RATE' | 'RESERVE' | 'READY' | 'COMMIT' | 'CANCEL' | 'REMOVE'
async function command(session: SessionContext, productId: string, requestId: string | null, action: Action, payload = {}) {
  requireCapability(session, 'inventory.product.manage')
  return callApiRpc('product_photo_command', {
    p_session_id: session.session_id, p_product_id: productId,
    p_request_id: requestId, p_action: action, p_payload: payload,
  }, z.array(z.object({ result: CommandResult })).length(1).transform(([row]) => row.result))
}
const publicResult = (result: z.infer<typeof CommandResult>) => PhotoSnapshotSchema.parse(result)
export async function readPhoto(session: SessionContext, productId: string, requestId: string | null) {
  requireCapability(session, 'inventory.product.manage')
  if (process.env.PRODUCT_PHOTOS_ENABLED !== 'true') return { disabled: true as const }
  photoConfig()
  return publicResult(await command(session, productId, requestId, 'READ'))
}

export async function stagePhoto(session: SessionContext, productId: string, request: Request): Promise<PhotoSnapshot> {
  requireCapability(session, 'inventory.product.manage')
  const config = photoConfig()
  const metadata = photoUploadMetadata(request)
  await command(session, productId, metadata.requestId, 'RATE')
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)])
  const processed = await processPhoto(await boundedBody(request, MAX_PHOTO_BYTES), metadata.crop, signal)
  const descriptor = (image: ProcessedImage) => ({ width: image.width, height: image.height, bytes: image.bytes, sha256: image.sha256 })
  const reserved = await command(session, productId, metadata.requestId, 'RESERVE', {
    revision: metadata.revision, reason: metadata.reason, namespace: config.namespace, origin: config.origin,
    display: descriptor(processed.display), thumbnail: descriptor(processed.thumbnail),
  })
  // Only the request which CREATED this reservation may PUT. Replays merely
  // return its state; they cannot overwrite an existing object or publish twice.
  if (!reserved.created || !reserved.upload) return publicResult(reserved)
  if (reserved.upload.namespace !== config.namespace || reserved.upload.origin !== config.origin)
    throw new ApiError(503, 'CONNECTION_NOT_CONFIGURED', 'The reserved photo does not match this application store.')
  try {
    signal.throwIfAborted()
    await photoStorage(config).store(productId, reserved.upload.asset_id, processed, signal)
    signal.throwIfAborted()
    return publicResult(await command(session, productId, metadata.requestId, 'READY'))
  } catch {
    // No immediate object deletion: a timed-out provider write may still finish.
    // The durable reservation and 24-hour grace make later bounded cleanup safe.
    try { await command(session, productId, metadata.requestId, 'CANCEL') } catch { /* Recovery remains explicit; cleanup sees the durable reservation. */ }
    throw new ApiError(503, 'INTERNAL_ERROR', 'The photo upload could not finish. Check photo status before retrying; the current photo was not replaced by this upload.')
  }
}
export async function changePhoto(session: SessionContext, productId: string, requestId: string,
  action: 'COMMIT' | 'CANCEL' | 'REMOVE', payload = {}) {
  requireCapability(session, 'inventory.product.manage')
  photoConfig()
  await command(session, productId, requestId, 'RATE')
  return publicResult(await command(session, productId, requestId, action, payload))
}
