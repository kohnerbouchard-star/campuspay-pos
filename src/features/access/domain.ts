import { z } from 'zod'
import { CAPABILITY_NAMES, PRESETS, validCapabilities } from '@/features/auth/capabilities'
export const AccessPermissionsSchema=z.array(z.enum(CAPABILITY_NAMES)).max(CAPABILITY_NAMES.length).refine(validCapabilities,{message:'Resolve permission prerequisites before saving'})
export const AccessSnapshotSchema=z.object({user_id:z.string().uuid(),employee_code:z.string(),display_name:z.string(),active:z.boolean(),preset:z.enum(PRESETS),permissions:AccessPermissionsSchema,defaults:AccessPermissionsSchema,revision:z.number().int().positive(),updated_at:z.string(),history:z.array(z.object({previous_preset:z.enum(PRESETS),new_preset:z.enum(PRESETS),previous_permissions:AccessPermissionsSchema,new_permissions:AccessPermissionsSchema,reason:z.string(),reference_number:z.string(),sessions_revoked:z.number().int(),created_at:z.string(),actor_name:z.string()}))})
export type AccessSnapshot=z.infer<typeof AccessSnapshotSchema>
export const AccessChangeSchema=z.object({requestKey:z.string().uuid(),targetId:z.string().uuid(),expectedRevision:z.number().int().positive(),previousPreset:z.enum(PRESETS),previousPermissions:AccessPermissionsSchema,newPreset:z.enum(PRESETS),permissions:AccessPermissionsSchema,adminPin:z.string().regex(/^\d{4,16}$/),reason:z.string().trim().min(10).max(500).refine(v=>![...v].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)),confirmed:z.literal(true)}).strict()
export type AccessChange=z.infer<typeof AccessChangeSchema>
export const AccessResultSchema=z.object({outcome:z.enum(['COMPLETED','CLOSED','AUTH_FAILED']),audit_reference:z.string().optional(),sessions_revoked:z.number().int().nonnegative().optional()})
export const AccessRecoverySchema=z.object({requestKey:z.string().uuid()}).strict()
export const PresetDefaultsSchema=z.array(z.object({preset:z.enum(PRESETS),permissions:AccessPermissionsSchema})).length(4)
