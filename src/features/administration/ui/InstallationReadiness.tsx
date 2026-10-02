'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/client'
import type { InstallationReadiness as Readiness } from '../readiness'
export function InstallationReadiness() {
  const [data, setData] = useState<Readiness | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    apiFetch<Readiness>('/api/administration/readiness').then(result => { if (active) { setData(result); setError('') } }).catch(() => { if (active) { setData(null); setError('Readiness could not be checked. Review the deployment and database migration before enabling operations.') } })
    return () => { active = false }
  }, [refresh])
  return <section className="panel" aria-labelledby="installation-readiness-title">
    <div className="panel-heading"><h2 id="installation-readiness-title">Installation readiness</h2><button className="secondary-action" onClick={() => setRefresh(n => n + 1)}>Refresh readiness</button></div>
    <p className="muted">Read-only diagnostics. A feature needs both switches and its prerequisites. This panel never changes accounts, balances, or activation.</p>
    {error && <p className="error-message" role="alert">{error}</p>}
    {!data && !error && <p role="status">Checking application and database settings…</p>}
    {data && <><div className="table-scroll"><table><thead><tr><th>Feature</th><th>Application</th><th>Database</th><th>Effective</th></tr></thead><tbody>{data.features.map(row => <tr key={row.name}><td>{row.name.replaceAll('_', ' ')}</td><td>{row.application ? 'On' : 'Off'}</td><td>{row.database ? 'On' : 'Off'}</td><td>{row.effective ? 'Enabled' : 'Disabled'}</td></tr>)}</tbody></table></div>
      <p>Active cards missing a PIN record: <strong>{data.active_card_missing_pin}</strong>. Use the existing student account’s authorized PIN reset; do not enroll a duplicate.</p>
      <p>Stock receipts with header/line cost differences: <strong>{data.receipt_cost_mismatches}</strong>. Investigate and approve a correction separately; historical records are not rewritten here.</p></>}
  </section>
}
