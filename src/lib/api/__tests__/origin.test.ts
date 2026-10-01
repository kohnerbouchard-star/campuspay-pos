import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { parseJson } from '@/lib/api/response'

afterEach(() => vi.unstubAllEnvs())

describe('mutation origin separation', () => {
  it('rejects a configured sibling store origin on the staff API', async () => {
    vi.stubEnv('STAFF_ORIGIN', 'https://pos.school.test'); vi.stubEnv('STORE_ORIGIN', 'https://store.school.test')
    const request = new Request('https://pos.school.test/api/students', { method: 'POST', headers: { origin: 'https://store.school.test', 'sec-fetch-site': 'same-site' }, body: '{}' })
    await expect(parseJson(request, z.object({}))).rejects.toMatchObject({ status: 403 })
  })
  it('allows the same local origin outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const request = new Request('http://localhost:3000/api/students', { method: 'POST', headers: { origin: 'http://localhost:3000' }, body: '{"value":1}' })
    await expect(parseJson(request, z.object({ value: z.number() }))).resolves.toEqual({ value: 1 })
  })
  it('requires exact configured production staff and store origins', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('STAFF_ORIGIN', 'https://pos.school.test')
    vi.stubEnv('STORE_ORIGIN', 'https://store.school.test')
    const good = new Request('https://pos.school.test/api/students', {
      method: 'POST', headers: { origin: 'https://pos.school.test', 'sec-fetch-site': 'same-origin' }, body: '{"value":1}',
    })
    await expect(parseJson(good, z.object({ value: z.number() }))).resolves.toEqual({ value: 1 })

    const wrongHost = new Request('https://other.school.test/api/students', {
      method: 'POST', headers: { origin: 'https://other.school.test', 'sec-fetch-site': 'same-origin' }, body: '{}',
    })
    await expect(parseJson(wrongHost, z.object({}))).rejects.toMatchObject({ status: 403 })
  })
  it('fails closed when production surface configuration is incomplete or collapsed', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('STAFF_ORIGIN', 'https://same.school.test')
    vi.stubEnv('STORE_ORIGIN', 'https://same.school.test')
    const request = new Request('https://same.school.test/api/students', {
      method: 'POST', headers: { origin: 'https://same.school.test', 'sec-fetch-site': 'same-origin' }, body: '{}',
    })
    await expect(parseJson(request, z.object({}))).rejects.toMatchObject({ status: 503 })
  })
})
