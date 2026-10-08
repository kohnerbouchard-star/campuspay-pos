import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { requirePagePermission } from '@/features/auth/server/page-guard'
import { FundingScreen } from '@/features/funding/ui/FundingScreen'
import { fundingEnabled } from '@/features/funding/server'
export const dynamic='force-dynamic'
export default async function Page(){const s=await requirePagePermission('cash.movement.record');return <WorkspaceFrame session={s} title="Cash movements"><FundingScreen enabled={fundingEnabled()} permissions={s.permissions} cashOnly/></WorkspaceFrame>}
