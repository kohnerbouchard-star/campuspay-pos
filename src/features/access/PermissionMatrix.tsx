'use client'
import { CAPABILITIES, setCapability, type Capability, type Workspace } from '@/features/auth/capabilities'
const workspaces:Workspace[]=['Register','Students','Inventory','Finance','Admin']
const columns=['View','Operate','Manage','Approve'] as const
export function PermissionMatrix({permissions,disabled,onChange,onExplain}:{permissions:readonly Capability[];disabled:boolean;onChange(v:Capability[]):void;onExplain(message:string):void}){
 function select(name:Capability,checked:boolean){const next=setCapability(permissions,name,checked);onChange(next.permissions);onExplain(next.prerequisites.length?`Required access enabled: ${next.prerequisites.map(n=>CAPABILITIES.find(c=>c.name===n)?.label).join('; ')}.`:checked?'':'Dependent access has also been removed where required.')}
 return <div className="access-matrix">{workspaces.map(workspace=>{
  const definitions=CAPABILITIES.filter(c=>c.workspace===workspace),areas=[...new Set(definitions.map(c=>c.area))]
  return <details key={workspace} open><summary>{workspace}</summary><div className="matrix-table"><table><caption>{workspace} capabilities</caption><thead><tr><th>Area</th>{columns.map(column=><th key={column}>{column}</th>)}</tr></thead><tbody>{areas.map(area=><tr key={area}><th scope="row">{area}</th>{columns.map(column=>{const c=definitions.find(c=>c.area===area&&c.column===column);return <td key={column}>{c?<label title={c.label}><input aria-label={`${area} → ${column}`} type="checkbox" checked={permissions.includes(c.name)} disabled={disabled} onChange={e=>select(c.name,e.target.checked)}/><span className="matrix-cell-label">{c.label}</span></label>:<span aria-label="Not applicable">—</span>}</td>})}</tr>)}</tbody></table></div></details>
 })}</div>
}
