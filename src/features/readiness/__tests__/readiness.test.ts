import { describe, expect, it } from 'vitest'
import { capabilityStatus } from '../domain'
import { WORKSPACE_LINKS, workspaceIsCurrent } from '@/features/auth/navigation'
describe('operator status and navigation', () => {
  it.each([[false,false,true,'Disabled in application and database'],[true,false,true,'Disabled in database'],[false,true,true,'Disabled in application'],[true,true,false,'Required dependency is disabled'],[true,true,true,'Enabled — operation-specific checks still apply']])('reports each layer', (application, database, dependency, expected) => {
    expect(capabilityStatus(Boolean(application),Boolean(database),Boolean(dependency))).toBe(expected)
  })
  it.each([['Complete enrollment','/students'],['Cash-close history','/cash'],['Item refunds and returns','/refunds']])('keeps parent context for %s', (title, parent) => {
    expect(WORKSPACE_LINKS.filter(link => workspaceIsCurrent(link,title,parent)).map(link => link.href)).toEqual([parent])
  })
})
