import { z } from 'zod'
export const RemovalKindSchema=z.enum(['PRODUCT','STUDENT','STAFF','TERMINAL','COUPON'])
export type RemovalKind=z.infer<typeof RemovalKindSchema>
export const removalLabels:Record<RemovalKind,string>={PRODUCT:'product',STUDENT:'student',STAFF:'staff account',TERMINAL:'register',COUPON:'coupon'}
export const RemovalQuerySchema=z.object({kind:z.enum(['ALL',...RemovalKindSchema.options]).default('ALL'),targetId:z.string().uuid().nullable().default(null),offset:z.coerce.number().int().min(0).max(1000000).default(0)}).strict()
export const RemovalSnapshotSchema=z.object({kind:RemovalKindSchema,target_id:z.string().uuid(),name:z.string(),code:z.string(),active:z.boolean(),deleted:z.boolean(),deleted_at:z.string().nullable(),restore_active:z.boolean().nullable(),blocker:z.string().nullable(),version:z.string().regex(/^[0-9a-f]{64}$/)})
export type RemovalSnapshot=z.infer<typeof RemovalSnapshotSchema>
export const RemovalDirectorySchema=z.object({enabled:z.boolean(),total:z.number().int().nonnegative(),records:z.array(RemovalSnapshotSchema)})
export const RemovalChangeSchema=z.object({kind:RemovalKindSchema,action:z.enum(['DELETE','RESTORE']),targetId:z.string().uuid(),expectedVersion:z.string().regex(/^[0-9a-f]{64}$/),requestKey:z.string().uuid(),adminPin:z.string().regex(/^[0-9]{4,16}$/),reason:z.string().trim().min(10).max(500).refine(v=>!/[\u0000-\u001f\u007f]/.test(v)),verified:z.literal(true)}).strict()
export type RemovalChange=z.infer<typeof RemovalChangeSchema>
export const RemovalRecoverySchema=z.object({kind:RemovalKindSchema,requestKey:z.string().uuid()}).strict()
export const RemovalResultSchema=z.discriminatedUnion('outcome',[
 z.object({outcome:z.literal('COMPLETED'),kind:RemovalKindSchema,target_id:z.string().uuid(),deleted:z.boolean(),audit_reference:z.string().min(1)}),
 z.object({outcome:z.literal('CLOSED')}),z.object({outcome:z.literal('AUTH_FAILED')}),
])
export type RemovalResult=z.infer<typeof RemovalResultSchema>
