import { requirePagePermission } from '@/features/auth/server/page-guard'
import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { PaymentSettings } from '@/features/pos/ui/PaymentSettings'
export const dynamic = 'force-dynamic'
export default async function PaymentSettingsPage() {
  const session = await requirePagePermission('security.staff.manage')
  return <WorkspaceFrame session={session} title="Payment settings"><main className="workspace"><header className="workspace-header"><div><p className="eyebrow">Super Admin</p><h1>Payment settings</h1><p>Control event cash acceptance on this register.</p></div></header><PaymentSettings /></main></WorkspaceFrame>
}
