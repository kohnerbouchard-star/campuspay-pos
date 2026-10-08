import 'server-only'
import { z } from 'zod'
import { callApiRpc } from '@/lib/db/rpc'
import { photoConfig, photoKeys } from './config'
import { PhotoSchema, type ProductPhoto } from './domain'

/** Photo enrichment is separate from immutable prices, stock and transaction RPCs. */
export async function withProductPhotos<T extends { id: string }>(products: T[], sessionId: string, customer = false): Promise<(T & { photo?: ProductPhoto | null })[]> {
  if (!products.length) return products
  let config
  try { config = photoConfig() } catch { return products }
  const rows = await callApiRpc('product_photo_catalog', {
    p_session_id: customer ? null : sessionId, p_customer_session_id: customer ? sessionId : null,
    p_product_ids: products.map(product => product.id),
  }, z.array(z.object({ product_id: z.uuid(), photo: PhotoSchema })))
  const photos = new Map(rows.map(row => {
    const keys = photoKeys(config, row.product_id, row.photo.asset_id)
    const photo = row.photo.url === `${config.origin}/${keys.display}` && row.photo.thumbnail_url === `${config.origin}/${keys.thumbnail}`
      ? row.photo : null
    return [row.product_id, photo]
  }))
  return products.map(product => ({ ...product, photo: photos.get(product.id) ?? null }))
}
