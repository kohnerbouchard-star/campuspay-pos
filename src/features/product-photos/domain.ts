import { z } from 'zod'

export const MAX_PHOTO_BYTES = 4_000_000
export const PhotoSchema = z.object({
  asset_id: z.uuid(), url: z.url(), thumbnail_url: z.url(),
  width: z.number().int().min(1).max(1280), height: z.number().int().min(1).max(1280),
  thumbnail_width: z.number().int().min(1).max(384), thumbnail_height: z.number().int().min(1).max(384),
  content_type: z.literal('image/webp'),
})
export type ProductPhoto = z.infer<typeof PhotoSchema>
export const PhotoSnapshotSchema = z.object({
  product_id: z.uuid(), revision: z.number().int().nonnegative(), photo: PhotoSchema.nullable(),
  operation: z.object({
    request_id: z.uuid(), state: z.enum(['UPLOADING', 'READY', 'SAVED', 'CANCELLED', 'CONFLICT']),
    saved_revision: z.number().int().nullable(), photo: PhotoSchema.nullable(),
  }).nullable(),
})
export type PhotoSnapshot = z.infer<typeof PhotoSnapshotSchema>
export const PhotoCropSchema = z.object({
  mode: z.enum(['fit', 'square']), x: z.number().min(0).max(100), y: z.number().min(0).max(100),
}).strict()
export type PhotoCrop = z.infer<typeof PhotoCropSchema>
export const PhotoEditSchema = z.object({
  requestId: z.uuid(), revision: z.number().int().min(0).max(2_147_483_646),
  reason: z.string().trim().min(10).max(500).regex(/^[^\u0000-\u001f\u007f]+$/),
}).strict()
export const PhotoRequestSchema = z.object({ requestId: z.uuid() }).strict()
export function unresolvedPhoto(snapshot: PhotoSnapshot | null): boolean {
  return snapshot?.operation?.state === 'UPLOADING' || snapshot?.operation?.state === 'READY'
}
