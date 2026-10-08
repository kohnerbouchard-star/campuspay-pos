import { z } from 'zod'
import { PRESETS,CAPABILITY_NAMES } from '@/features/auth/capabilities'
const text = (max: number) => z.string().trim().min(1).max(max).refine(value => [...value].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127))
const Role = z.enum(['cashier','inventory_admin','accountant','super_admin'])
const Pin = z.string().regex(/^\d{4,16}$/)
const Common = { requestKey: z.string().uuid(), adminPin: Pin, notes: text(500).min(10), verified: z.literal(true) }
const Change = z.discriminatedUnion('action', [
 z.object({ ...Common, action: z.literal('CREATE_STAFF'), preset:z.enum(PRESETS), employeeCode: z.string().regex(/^[A-Za-z0-9_-]{2,32}$/), displayName: text(120), role: Role, newPin: Pin, confirmationPin: Pin }).strict(),
 z.object({ ...Common, action: z.literal('UPDATE_STAFF'), targetId: z.string().uuid(), displayName: text(120), role: Role, active: z.boolean(), expectedUpdatedAt: z.string().datetime({offset:true}) }).strict(),
 z.object({ ...Common, action: z.literal('RESET_STAFF_PIN'), targetId: z.string().uuid(), newPin: Pin, confirmationPin: Pin }).strict(),
 z.object({ ...Common, action: z.literal('REVOKE_STAFF_SESSIONS'), targetId: z.string().uuid() }).strict(),
 z.object({ ...Common, action: z.literal('UPDATE_TERMINAL'), targetId: z.string().uuid(), label: text(120), active: z.boolean(), expectedActive: z.boolean(), expectedLabel: z.string().nullable() }).strict(),
 z.object({ ...Common, action: z.literal('REVOKE_TERMINAL_SESSIONS'), targetId: z.string().uuid() }).strict(),
])
export const AdministrationChangeSchema = Change.refine(v => !('newPin' in v) || v.newPin === v.confirmationPin, {message:'PIN entries do not match'})
export type AdministrationChange = z.infer<typeof AdministrationChangeSchema>
export const AdministrationRecoverySchema = z.object({requestKey:z.string().uuid()}).strict()
export const StaffRecordSchema = z.object({user_id:z.string().uuid(),employee_code:z.string(),display_name:z.string(),role:Role,active:z.boolean(),updated_at:z.string(),has_pin:z.boolean(),preset:z.enum(PRESETS),permissions:z.array(z.enum(CAPABILITY_NAMES)),revision:z.number().int().positive()})
export const TerminalRecordSchema = z.object({terminal_id:z.string().uuid(),label:z.string().nullable(),active:z.boolean(),created_at:z.string(),last_seen_at:z.string(),has_open_shift:z.boolean()})
export const AdministrationSnapshotSchema = z.object({enabled:z.boolean(),current_terminal_id:z.string().uuid(),staff_total:z.number().int().nonnegative(),terminal_total:z.number().int().nonnegative(),staff:z.array(StaffRecordSchema),terminals:z.array(TerminalRecordSchema)})
export const AdministrationResultSchema = z.object({outcome:z.enum(['COMPLETED','CLOSED','AUTH_FAILED']),target_id:z.string().uuid().optional(),sessions_revoked:z.number().int().nonnegative().optional(),audit_reference:z.string().optional()})
export type AdministrationSnapshot = z.infer<typeof AdministrationSnapshotSchema>
export type StaffRecord = z.infer<typeof StaffRecordSchema>
export type TerminalRecord = z.infer<typeof TerminalRecordSchema>
export type AdministrationResult = z.infer<typeof AdministrationResultSchema>
