'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api/client'
import { CashReadinessSchema, CASH_READINESS_MESSAGES, type CashReadiness } from '../cash-readiness'

export function useCashReadiness(kind: 'saleId' | 'refundId', id: string, required: boolean) {
  const query = `${kind}=${encodeURIComponent(id)}`
  const [result, setResult] = useState<{ query: string; value: CashReadiness; expires: number } | null>(null)
  const [error, setError] = useState(false)
  const generation = useRef({ value: 0 })
  const expiry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const check = useCallback(async () => {
    if (!required) return true
    const current = ++generation.current.value
    clearTimeout(expiry.current); setResult(null); setError(false)
    try {
      const value = CashReadinessSchema.parse(await apiFetch<unknown>(`/api/refunds/cash-readiness?${query}`))
      if ((kind === 'refundId' ? value.refund_id : value.sale_id) !== id) throw new Error('Readiness identity mismatch')
      if (current !== generation.current.value) return false
      setResult({ query, value, expires: Date.now() + 30_000 })
      expiry.current = setTimeout(() => setResult(null), 30_000)
      return value.state === 'READY' || value.state === 'NO_CASH_DUE'
    } catch { if (current === generation.current.value) { setResult(null); setError(true) }; return false }
  }, [id, kind, query, required])
  useEffect(() => {
    const requests = generation.current
    const timer = setTimeout(() => void check(), 0)
    return () => { clearTimeout(timer); clearTimeout(expiry.current); requests.value++ }
  }, [check])
  const current = result?.query === query ? result.value : null
  return { check, isCurrent: () => !required || Boolean(result?.query === query && result.expires > Date.now() && ['READY','NO_CASH_DUE'].includes(result.value.state)), allowed: !required || Boolean(current && ['READY','NO_CASH_DUE'].includes(current.state)),
    message: error ? 'Cash readiness could not be confirmed. Refresh before proceeding; do not hand over cash.'
      : current ? CASH_READINESS_MESSAGES[current.state] : 'Confirm current cash readiness before proceeding.',
    handoff: current?.handoff ?? false }
}
