import type { WalletHistoryPage,CashHistoryPage } from './domain'
type Cell=string|number|null
function cell(v:Cell){const text=v===null?'':typeof v==='string'&&/^\s*[=+@-]/.test(v)?`'${v}`:String(v);return `"${text.replaceAll('"','""')}"`}
function csv(headers:string[],rows:Cell[][]){return '\uFEFF'+[headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n'}
export function walletHistoryCsv(report:WalletHistoryPage){return csv(
 ['Ledger ID','Reference','Created at (ISO)','Entry type','Reason','Amount (KRW)','Balance before (KRW)','Balance after (KRW)','Operator','Notes'],
 report.rows.map(r=>[r.ledger_id,r.reference_number,r.created_at,r.entry_type,r.reason_code,r.amount_won,r.balance_before_won,r.balance_after_won,r.actor_name,r.notes]))}
export function cashHistoryCsv(report:CashHistoryPage){return csv(
 ['Shift ID','Terminal ID','Terminal label','Opened at (ISO)','Closed at (ISO)','Opened by','Closed by','Opening float (KRW)','Cash sales (KRW)','Refund payouts (KRW)','Funding in (KRW)','Funding out (KRW)','Expected (KRW)','Counted (KRW)','Variance (KRW)','Review required','Approved by','Close notes','Review notes'],
 report.rows.map(({shift:r,...names})=>[r.shift_id,r.terminal_id,r.terminal_label,r.opened_at,r.closed_at,names.opened_by_name,names.closed_by_name,r.opening_float_won,r.cash_sales_won,r.cash_payouts_won,r.funding_in_won,r.funding_out_won,r.expected_won,r.counted_won,r.variance_won,r.review_required?'Yes':'No',names.approved_by_name,r.close_notes,r.approval_notes]))}
