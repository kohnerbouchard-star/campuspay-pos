import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'
const m = vi.hoisted(() => ({ auth:vi.fn(),post:vi.fn(),snapshot:vi.fn(),student:vi.fn(),rpc:vi.fn() }))
vi.mock('@/features/auth/server/session',() => ({ authorizeRequest:m.auth }))
vi.mock('@/features/refunds/partial-server',() => ({ postPartialRefund:m.post,partialRefundSnapshot:m.snapshot }))
vi.mock('@/features/store/server/session',() => ({ authorizeCustomerSession:m.student }))
vi.mock('@/lib/db/rpc',() => ({ callApiRpc:m.rpc }))
import { POST } from '@/app/api/refunds/items/route'
import { GET } from '@/app/api/store/orders/[orderId]/refunds/route'
const id='80000000-0000-4000-8000-000000000001'
const input={saleId:id,idempotencyKey:id,expectedRefundCount:0,reasonCode:'OTHER',notes:'Synthetic inspected source lot',verified:true,items:[{original_allocation_id:id,restock_quantity:1,write_off_quantity:0}]}
const request=(body:unknown=input,origin='http://localhost') => new Request('http://localhost/api/refunds/items',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)})
beforeEach(() => vi.resetAllMocks())
describe('item refund boundary',() => {
 it('does not call posting before authorization',async()=>{m.auth.mockRejectedValue(new ApiError(401,'UNAUTHENTICATED','Authentication required'));expect((await POST(request())).status).toBe(401);expect(m.post).not.toHaveBeenCalled()})
 it('rejects wrong origin before authorization',async()=>{expect((await POST(request(input,'https://untrusted.example'))).status).toBe(403);expect(m.auth).not.toHaveBeenCalled()})
 it('rejects client-specified money',async()=>{m.auth.mockResolvedValue({session_id:id});expect((await POST(request({...input,refundWon:10}))).status).toBe(400);expect(m.post).not.toHaveBeenCalled()})
 it('requires customer authentication before querying refund history',async()=>{m.student.mockRejectedValue(new ApiError(401,'UNAUTHENTICATED','Student required'));expect((await GET(new Request('http://localhost/api/store/orders/'+id+'/refunds'),{params:Promise.resolve({orderId:id})})).status).toBe(401);expect(m.rpc).not.toHaveBeenCalled()})
})
