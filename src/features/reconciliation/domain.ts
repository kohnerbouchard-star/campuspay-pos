import { z } from 'zod'
export const ReconciliationDateSchema=z.string().date().refine(v=>v>='2000-01-01'&&v<='2200-12-31')
export const ReconciliationSchema=z.object({
 business_date:ReconciliationDateSchema,timezone:z.literal('Asia/Seoul'),generated_at:z.string(),activity_count:z.number().int().safe().nonnegative(),
 status:z.enum(['DISCREPANCIES','NO_POSTED_ACTIVITY','CHECKS_CLEAR']),
 metrics:z.array(z.object({section:z.string(),key:z.string(),label:z.string(),value:z.number().int().safe(),unit:z.enum(['KRW','COUNT']),scope:z.enum(['DAY','AT_START','AT_END','CURRENT'])})),
 checks:z.array(z.object({code:z.string(),label:z.string(),checked_count:z.number().int().safe().nonnegative(),discrepancies:z.number().int().safe().nonnegative()})),
}).refine(v=>v.checks.length>0&&new Set(v.checks.map(c=>c.code)).size===v.checks.length&&v.checks.every(c=>c.discrepancies<=c.checked_count))
 .refine(v=>new Set(v.metrics.map(m=>m.key)).size===v.metrics.length)
 .refine(v=>v.status===(v.checks.some(c=>c.discrepancies>0)?'DISCREPANCIES':v.activity_count===0?'NO_POSTED_ACTIVITY':'CHECKS_CLEAR'))
export type Reconciliation=z.infer<typeof ReconciliationSchema>
export const SCOPE_LABELS={DAY:'Selected day',AT_START:'Start of day (journal basis)',AT_END:'End of day (journal basis)',CURRENT:'Current state at report generation'} as const
export const SECTION_ORDER=['Sales and refunds','Wallet journals','Physical cash','Drawer closes','Inventory journal','Orders','Unresolved operations']
export function reconciliationCsv(data:Reconciliation):string{
 const quote=(value:string|number)=>{const text=typeof value==='string'&&/^\s*[=+@-]/.test(value)?`'${value}`:String(value);return `"${text.replaceAll('"','""')}"`}
 const rows:(string|number)[][]=[['Business date','Generated at','Section','Metric','Scope','Unit','Value','Checked records'],
 ...data.metrics.map(m=>[data.business_date,data.generated_at,m.section,m.label,SCOPE_LABELS[m.scope],m.unit,m.value,'']),
 ...data.checks.map(c=>[data.business_date,data.generated_at,'Current reconciliation checks',c.label,SCOPE_LABELS.CURRENT,'Discrepancies',c.discrepancies,c.checked_count])]
 return '\uFEFF'+rows.map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n'
}
