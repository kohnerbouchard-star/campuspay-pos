import { z } from 'zod'
import { withApiRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { authorizeRequest } from '@/features/auth/server/session'
import { callApiRpc } from '@/lib/db/rpc'
import { ReadinessDatabaseSchema, READINESS_FEATURES } from '@/features/administration/readiness'
export const dynamic = 'force-dynamic'
export const GET = withApiRoute('/api/administration/readiness', async () => {
  const session = await authorizeRequest('security.staff.manage')
  const [result] = await callApiRpc('installation_readiness', { p_session_id: session.session_id }, z.array(z.object({ readiness: ReadinessDatabaseSchema })).length(1))
  const data = result.readiness
  const flags = { refunds: process.env.REFUNDS_ENABLED === 'true', returns: process.env.RETURNS_ENABLED === 'true', cash_controls: process.env.CASH_CONTROLS_ENABLED === 'true', administration: process.env.ADMINISTRATION_ENABLED === 'true', partial_refund_preview: process.env.PARTIAL_REFUND_PREVIEW_ENABLED === 'true', partial_refunds: process.env.PARTIAL_REFUNDS_ENABLED === 'true', funding: process.env.FUNDING_ENABLED === 'true' }
  const refunds = flags.refunds && data.features.refunds
  return ok({
    features: READINESS_FEATURES.map(name => ({ name, application: flags[name], database: data.features[name], effective: flags[name] && data.features[name] && (!['returns', 'partial_refunds'].includes(name) || refunds) })),
    active_card_missing_pin: data.active_card_missing_pin,
    receipt_cost_mismatches: data.receipt_cost_mismatches,
  })
})
