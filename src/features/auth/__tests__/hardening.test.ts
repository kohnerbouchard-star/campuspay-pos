import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REPORT_PERMISSIONS, WORKSPACE_LINKS, canAccessWorkspace } from '../navigation'
import { ROLE_PERMISSIONS } from '../permissions'
import { STAFF_INACTIVITY_MS, STAFF_ABSOLUTE_MS, SESSION_HEARTBEAT_MS, WorkstationActivity } from '@/features/terminal/inactivity'

describe('equal-cost authentication structure', () => {
  const sql = readFileSync('database/schema/020_auth_session_hardening.sql', 'utf8')
  it('uses a fixed bcrypt-12 dummy and exactly one crypt call in the shared verifier', () => {
    expect(sql).toContain('$2a$12$')
    expect(sql).not.toContain('gen_salt')
    expect(sql.match(/extensions\.crypt\(/g)).toHaveLength(1)
    expect(sql).toContain('coalesce(p_hash, private.dummy_pin_hash())')
  })
  it.each(['private.verify_staff_pin', 'api.create_customer_session'])('%s always verifies before an account-specific failure', name => {
    const body = sql.slice(sql.indexOf(`create or replace function ${name}(`)).split('$$;')[0]
    expect(body.match(/private\.verify_pin_proof\(/g)).toHaveLength(1)
    expect(body.slice(0, body.indexOf('private.verify_pin_proof('))).not.toMatch(/if not found then (?:return|raise)/)
    expect(body.indexOf('private.verify_pin_proof(')).toBeLessThan(body.indexOf('if v_credential.locked_until'))
  })
})
describe('staff workspace policy and least-privilege reports', () => {
  it('keeps long forms active beyond two minutes but expires at fifteen idle minutes', () => {
    const timer = new WorkstationActivity(0, STAFF_INACTIVITY_MS)
    expect(timer.snapshot(180000).locked).toBe(false)
    timer.activity(180000)
    expect(timer.snapshot(1079999).locked).toBe(false)
    expect(timer.snapshot(1080000).locked).toBe(true)
    expect(STAFF_ABSOLUTE_MS).toBe(28800000)
    expect(SESSION_HEARTBEAT_MS).toBe(60000)
  })
  it('allows any report permission without adding permissions to a role', () => {
    const reports = WORKSPACE_LINKS.find(link => link.href === '/reports')!
    for (const permission of REPORT_PERMISSIONS) expect(canAccessWorkspace([permission], reports)).toBe(true)
    expect(canAccessWorkspace(ROLE_PERMISSIONS.inventory_admin, reports)).toBe(true)
    expect(canAccessWorkspace(ROLE_PERMISSIONS.cashier, reports)).toBe(false)
    expect(ROLE_PERMISSIONS.inventory_admin).not.toContain('reports.sales')
    expect(ROLE_PERMISSIONS.accountant).not.toContain('inventory.receive')
  })
})
