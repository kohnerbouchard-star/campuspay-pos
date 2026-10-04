import type { AdministrationChange, StaffRecord, TerminalRecord } from './domain'
export const ROLE_DESCRIPTIONS = {
  cashier:'Take sales, prepare online orders and operate permitted cash-drawer tasks when activated. No product management, user management or wallet corrections.',
  inventory_admin:'Manage products, stock and coupons; prepare online orders; request PIN/card assistance with Super Admin approval. No wallet adjustments.',
  accountant:'Review wallets, reports, refunds and reconciliation; perform authorized wallet operations. Refund posting requires Super Admin. No product or user management; no credential approval.',
  super_admin:'All workspaces, staff management, student enrollment and access approval. Sensitive changes still require fresh authorization and safety checks.',
} as const
export function administrationReview(change:AdministrationChange, previous?:StaffRecord|TerminalRecord) {
  const code=previous&&'employee_code' in previous?previous.employee_code:previous&&'terminal_id' in previous?previous.terminal_id:''
  switch(change.action){
    case 'CREATE_STAFF':return {label:'Create staff account',destructive:false,token:undefined,description:`Create ${change.displayName} (${change.employeeCode}) as ${change.role.replaceAll('_',' ')}. This creates staff access, not a student wallet.`}
    case 'UPDATE_STAFF':return {label:change.active?'Save staff access':'Deactivate staff account',destructive:!change.active||!!(previous&&'role' in previous&&previous.role!==change.role),token:code,description:`${change.displayName} (${code}) will be ${change.active?'active':'inactive'} with role ${change.role.replaceAll('_',' ')}. Their sessions will end. Staff identity and transaction history remain. Your own account and the last administrator are protected.`}
    case 'RESET_STAFF_PIN':return {label:'Reset staff PIN',destructive:true,token:code,description:`The previous PIN for ${code} will stop working and their sessions will end. Hand the new PIN only to the verified staff member. No student credentials change.`}
    case 'REVOKE_STAFF_SESSIONS':return {label:'Sign out staff sessions',destructive:true,token:code,description:`End the current sessions for ${code}. Their account and PIN remain active, so they can sign in again. No transaction history is removed.`}
    case 'UPDATE_TERMINAL':return {label:change.active?'Save register settings':'Deactivate register',destructive:!change.active,token:change.active?undefined:code,description:`Set the register label to ${change.label} and access to ${change.active?'active':'inactive'}. Deactivation requires any open cash drawer to be closed. Register history is preserved.`}
    case 'REVOKE_TERMINAL_SESSIONS':return {label:'Sign out register sessions',destructive:true,token:code,description:'End the sessions attached to this registered browser. This is not a physical-device ban. The register and its cash history remain recorded.'}
  }
}
