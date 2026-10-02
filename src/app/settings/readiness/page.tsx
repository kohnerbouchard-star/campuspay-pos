import { requirePagePermission } from '@/features/auth/server/page-guard'
import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { operatorReadiness } from '@/features/readiness/server'
export const dynamic = 'force-dynamic'
export default async function Page() {
  const session = await requirePagePermission('security.staff.manage')
  let data: Awaited<ReturnType<typeof operatorReadiness>> | undefined
  let error: string | undefined
  try { data = await operatorReadiness(session) } catch { error = 'Readiness could not be checked. Verify the application migration and database connection; no settings were changed.' }
  return <WorkspaceFrame session={session} title="Operational readiness"><main className="workspace">
    <header className="workspace-header"><div><p className="eyebrow">Read-only configuration</p><h1>Operational readiness</h1><p>Permission to open a screen does not activate its financial operations.</p></div></header>
    {error && <p className="error-message" role="alert">{error}</p>}
    {data && <section className="panel"><p>Database: {data.database_name} · Schema: {data.schema_version}</p>
      <div className="table-scroll" role="region" tabIndex={0} aria-label="Capability readiness"><table><thead><tr><th>Capability</th><th>Application switch</th><th>Database switch</th><th>Status</th></tr></thead><tbody>{data.capabilities.map(row => <tr key={row.key}><th>{row.label}<small>{row.environmentKey}</small></th><td>{row.application ? 'Enabled' : 'Disabled'}</td><td>{row.database ? 'Enabled' : 'Disabled'}</td><td>{row.status}</td></tr>)}</tbody></table></div>
      <p>Initial roster issuance: {data.rosterIssuance ? 'Enabled' : 'Disabled'}.</p><p>Mandatory funding workflow: {data.funding_required ? 'Adopted' : 'Not adopted; legacy wallet adjustment policy remains in effect'}.</p>
      <p className="notice">This page changes nothing. New posting requires the matching application and database switches. A cash operation can additionally require an open drawer and an enabled terminal cash event. Recovery and closing remain subject to their existing safety checks.</p>
    </section>}
  </main></WorkspaceFrame>
}
