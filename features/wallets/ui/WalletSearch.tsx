'use client'

import { useEffect, useState } from 'react'
import { searchWallets } from '@/features/wallets/client'
import type { StudentWalletSummary } from '@/features/wallets/domain'
import { formatWon } from '@/lib/format/currency'

export function WalletSearch({onSelect}:{onSelect?(student:StudentWalletSummary):void}){const[q,setQ]=useState('');const[rows,setRows]=useState<StudentWalletSummary[]>([])
 useEffect(()=>{const t=setTimeout(()=>void searchWallets(q).then(setRows).catch(()=>setRows([])),250);return()=>clearTimeout(t)},[q])
 return <section className="panel table-panel"><div className="panel-heading"><div><p className="eyebrow">Read-only balances</p><h2>Student wallets</h2></div><input className="search-input" placeholder="Search name or ID" value={q} onChange={e=>setQ(e.target.value)}/></div><div className="table-scroll"><table><thead><tr><th>Student</th><th>Balance</th><th>Debt</th><th>Card</th></tr></thead><tbody>{rows.map(r=><tr key={r.student_id} onClick={()=>onSelect?.(r)}><td><strong>{r.display_name}</strong><small>{r.student_code}</small></td><td>{formatWon(r.balance_won)}</td><td>{formatWon(r.debt_won)}</td><td>{r.card_active?'Active':'Missing'}</td></tr>)}</tbody></table></div></section>}
