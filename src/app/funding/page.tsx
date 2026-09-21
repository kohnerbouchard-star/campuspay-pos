import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { requireAnyPagePermission } from '@/features/auth/server/page-guard'
import { fundingEnabled } from '@/features/funding/server'
import { FundingScreen } from '@/features/funding/ui/FundingScreen'
export const dynamic='force-dynamic'
export default async function Page(){const s=await requireAnyPagePermission(['pos.checkout','wallet.adjust'],'/funding');return <WorkspaceFrame session={s} title="Funding and cash"><FundingScreen enabled={fundingEnabled()} role={s.role}/></WorkspaceFrame>}
