import { describe, expect, it } from 'vitest'
import { readPendingAdjustment, savePendingAdjustment, clearPendingAdjustment, withAdjustmentStorageLock } from '../adjustment-storage'
const owner = '01234567-1234-4234-8234-0123456789ab', first = '01234567-1234-4234-8234-0123456789ac', second = '01234567-1234-4234-8234-0123456789ad'
function memory() { const data = new Map<string,string>(); return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } } }
describe('durable stock-removal reference', () => {
  it('survives reload and cannot be replaced by a new request', () => {
    const storage = memory(); savePendingAdjustment(storage, owner, first)
    expect(readPendingAdjustment(storage, owner)).toBe(first)
    expect([...storage.data.values()]).toEqual([first])
    expect(() => savePendingAdjustment(storage, owner, second)).toThrow()
    expect(() => clearPendingAdjustment(storage, owner, second)).toThrow()
    expect(readPendingAdjustment(storage, owner)).toBe(first)
    clearPendingAdjustment(storage, owner, first); expect(readPendingAdjustment(storage, owner)).toBeNull()
  })
  it('fails closed rather than forgetting an invalid stored reference', () => {
    const storage = memory(); savePendingAdjustment(storage, owner, first)
    const key = [...storage.data.keys()][0]; storage.data.set(key, 'corrupt')
    expect(() => readPendingAdjustment(storage, owner)).toThrow(); expect(storage.data.get(key)).toBe('corrupt')
  })
  it('requires working persistent storage before a request can be sent', () => {
    expect(() => savePendingAdjustment({ getItem: () => null, setItem: () => {}, removeItem: () => {} }, owner, first)).toThrow()
  })
})

it('serializes concurrent tabs so a second request cannot overwrite a saved recovery reference', async () => {
  const storage = memory()
  let queue = Promise.resolve<unknown>(undefined)
  const locks = { request: (_name: string, action: () => unknown) => {
    const result = queue.then(action)
    queue = result.catch(() => undefined)
    return result
  } } as unknown as LockManager
  const results = await Promise.allSettled([
    withAdjustmentStorageLock(owner, () => savePendingAdjustment(storage, owner, first), locks),
    withAdjustmentStorageLock(owner, () => savePendingAdjustment(storage, owner, second), locks),
  ])
  expect(results.map(row => row.status)).toEqual(['fulfilled', 'rejected'])
  expect(readPendingAdjustment(storage, owner)).toBe(first)
  await expect(withAdjustmentStorageLock(owner, () => clearPendingAdjustment(storage, owner, second), locks)).rejects.toThrow()
  expect(readPendingAdjustment(storage, owner)).toBe(first)
  await withAdjustmentStorageLock(owner, () => clearPendingAdjustment(storage, owner, first), locks)
  expect(readPendingAdjustment(storage, owner)).toBeNull()
})
it('does not run a storage mutation without cross-tab locking support', async () => {
  const storage = memory()
  await expect(withAdjustmentStorageLock(owner, () => savePendingAdjustment(storage, owner, first), undefined)).rejects.toThrow()
  expect(storage.data.size).toBe(0)
})
