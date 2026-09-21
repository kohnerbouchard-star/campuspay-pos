import { describe,it,expect } from 'vitest'
import { HistoryFiltersSchema,emptyHistoryFilters,historyParams } from '../domain'
describe('complete history filters',()=>{
 it('allows all history and Korea date ranges',()=>{expect(HistoryFiltersSchema.safeParse(emptyHistoryFilters).success).toBe(true);expect(HistoryFiltersSchema.safeParse({...emptyHistoryFilters,from:'2026-09-21',to:'2026-09-21'}).success).toBe(true)})
 it.each([{from:'2026-09-21'},{offset:-1},{offset:1.5},{offset:2147483648},{from:'2026-02-30',to:'2026-03-01'},{from:'2026-09-22',to:'2026-09-21'},{from:'2025-01-01',to:'2026-09-21'},{query:'bad\nfilter'},{query:'x'.repeat(121)},{rawSql:'select 1'}])('rejects invalid filter %#',v=>expect(HistoryFiltersSchema.safeParse({...emptyHistoryFilters,...v}).success).toBe(false))
 it('encodes filters rather than appending untrusted query syntax',()=>{const q=new URLSearchParams(historyParams({...emptyHistoryFilters,query:'name&offset=999',offset:50}));expect(q.get('q')).toBe('name&offset=999');expect(q.get('offset')).toBe('50');expect(q.has('from')).toBe(false)})
})
