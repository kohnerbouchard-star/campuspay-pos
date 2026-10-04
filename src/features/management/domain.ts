import { z } from 'zod'
const text = (max: number) => z.string().trim().min(1).max(max).refine(v => !/[\u0000-\u001f\u007f]/.test(v))
export const RecordKindSchema = z.enum(['PRODUCT', 'STUDENT'])
export type RecordKind = z.infer<typeof RecordKindSchema>
export const RecordQuerySchema = z.object({kind: RecordKindSchema, query: z.string().trim().max(120).default(''),
  status: z.enum(['ALL','ACTIVE','INACTIVE']).default('ACTIVE'), offset: z.coerce.number().int().min(0).max(1000000).default(0),
  targetId: z.string().uuid().nullable().default(null)}).strict()
const common = {requestKey: z.string().uuid(), reason: text(500).min(10), verified: z.literal(true)}
const existing = {targetId: z.string().uuid(), expectedUpdatedAt: z.string().datetime({offset:true})}
export const RecordChangeSchema = z.discriminatedUnion('action', [
  z.object({...common,kind:z.literal('PRODUCT'),action:z.literal('CREATE_PRODUCT'),sku:text(40),name:text(120),category:text(80),sellingPriceWon:z.number().int().min(0).max(10000000),reorderLevel:z.number().int().min(0).max(1000000)}).strict(),
  z.object({...common,...existing,kind:z.literal('PRODUCT'),action:z.literal('UPDATE_PRODUCT'),name:text(120),category:text(80),reorderLevel:z.number().int().min(0).max(1000000)}).strict(),
  z.object({...common,...existing,kind:z.literal('PRODUCT'),action:z.literal('CHANGE_PRODUCT_PRICE'),sellingPriceWon:z.number().int().min(0).max(10000000)}).strict(),
  z.object({...common,...existing,kind:z.literal('PRODUCT'),action:z.literal('ARCHIVE_PRODUCT')}).strict(),
  z.object({...common,...existing,kind:z.literal('PRODUCT'),action:z.literal('RESTORE_PRODUCT')}).strict(),
  z.object({...common,...existing,kind:z.literal('STUDENT'),action:z.literal('DEACTIVATE_STUDENT'),adminPin:z.string().regex(/^\d{4,16}$/)}).strict(),
  z.object({...common,...existing,kind:z.literal('STUDENT'),action:z.literal('REACTIVATE_STUDENT'),adminPin:z.string().regex(/^\d{4,16}$/)}).strict(),
])
export type RecordChange = z.infer<typeof RecordChangeSchema>
export const RecordRecoverySchema = z.object({kind:RecordKindSchema,requestKey:z.string().uuid()}).strict()
export const ManagedRecordSchema = z.object({id:z.string().uuid(),code:z.string(),name:z.string(),active:z.boolean(),updated_at:z.string().datetime({offset:true}),
  quantity_or_balance:z.number().int(),selling_price_won:z.number().int().nullable(),category:z.string().nullable(),reorder_level:z.number().int().nullable(),blocker:z.string().nullable()})
export type ManagedRecord = z.infer<typeof ManagedRecordSchema>
export const RecordDirectorySchema = z.object({kind:RecordKindSchema,total:z.number().int().nonnegative(),records:z.array(ManagedRecordSchema)})
export type RecordDirectory = z.infer<typeof RecordDirectorySchema>
export const RecordOutcomeSchema = z.discriminatedUnion('outcome', [
  z.object({outcome:z.literal('COMPLETED'),target_id:z.string().uuid(),audit_reference:z.string().min(1)}),
  z.object({outcome:z.literal('CLOSED')}), z.object({outcome:z.literal('AUTH_FAILED')}),
])
export type RecordOutcome = z.infer<typeof RecordOutcomeSchema>
