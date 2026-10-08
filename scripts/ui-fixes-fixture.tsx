// Browser-only fixture. Never imported by an application route or deployed server.
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { StudentsScreen } from '../src/features/students/ui/StudentsScreen'
import { AdministrationScreen } from '../src/features/administration/ui/AdministrationScreen'
import { FundingScreen } from '../src/features/funding/ui/FundingScreen'
import { PRESET_DEFAULTS } from '../src/features/auth/capabilities'
import type { ManagedStudent } from '../src/features/students/domain'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const student = (n: number): ManagedStudent => ({ student_id: id(n), student_code: `UI-${n}`,
  display_name: `Synthetic Student ${n}`, active: true, card_active: true, pin_set: true,
  balance_won: 0, pin_locked_until: null, created_at: '2026-01-01T00:00:00Z', audit_reference: null })
function Fixture() {
  const query = new URLSearchParams(location.search), screen = query.get('screen')
  const [selected, setSelected] = useState(student(1))
  if (screen === 'funding') return <><button onClick={() => setSelected(student(1))}>Select fixture student A</button><button onClick={() => setSelected(student(2))}>Select fixture student B</button><FundingScreen enabled permissions={PRESET_DEFAULTS.super_admin} student={selected}/></>
  if (screen === 'administration') return <AdministrationScreen enabled userId={id(9001)} preset="super_admin" permissions={PRESET_DEFAULTS.super_admin}/>
  return <StudentsScreen userId={id(9001)} fundingEnabled permissions={query.has('readonly') ? ['students.read'] : PRESET_DEFAULTS.super_admin}/>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
