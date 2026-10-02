import 'server-only'
import { z } from 'zod'
import { callApiRpc } from '@/lib/db/rpc'
import type { SessionContext } from '@/features/auth/domain'
import { CAPABILITIES, ReadinessDatabaseSchema, capabilityStatus } from './domain'
export async function operatorReadiness(session: SessionContext) {
  const data = await callApiRpc('operator_readiness', { p_session_id: session.session_id }, z.array(z.object({ result: ReadinessDatabaseSchema })).length(1).transform(([row]) => row.result))
  const enabled = (key: string) => {
    const capability = CAPABILITIES.find(row => row.key === key)
    return !!capability && process.env[capability.environmentKey] === 'true' && data.database_flags[capability.key]
  }
  return { ...data, rosterIssuance: process.env.ROSTER_ISSUANCE_ENABLED === 'true', capabilities: CAPABILITIES.map(row => {
    const application = process.env[row.environmentKey] === 'true', database = data.database_flags[row.key]
    return { ...row, application, database, status: capabilityStatus(application, database, row.dependencies.every(enabled)) }
  }) }
}
