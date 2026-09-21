import type { FundingReceipt } from './domain'
function cell(value:string|number|null){const text=value===null?'':typeof value==='string'&&/^\s*[=+@-]/.test(value)?`'${value}`:String(value);return `"${text.replaceAll('"','""')}"`}
export function fundingCsv(rows:FundingReceipt[]):string{
 const headers=['Reference','Created at (ISO)','Action','Student ID','Student','Wallet delta (KRW)','Cash delta (KRW)','Cash received (KRW)','Change (KRW)','Balance before (KRW)','Balance after (KRW)','Shift ID','Terminal','Operator','Approver','Source reference','Notes','Original receipt','Reversed by']
 return '\uFEFF'+[headers.map(cell).join(','),...rows.map(r=>[r.reference_number,r.created_at,r.action,r.student_code,r.student_name,r.wallet_delta_won,r.cash_delta_won,r.cash_received_won,r.change_won,r.balance_before_won,r.balance_after_won,r.shift_id,r.terminal_label??r.terminal_id,r.actor_name,r.approver_name,r.source_reference,r.notes,r.original_reference,r.reversed_by_reference].map(cell).join(','))].join('\r\n')+'\r\n'
}
