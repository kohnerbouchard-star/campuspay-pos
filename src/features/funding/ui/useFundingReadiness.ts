'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api/client'
import { FundingReadinessSchema, type FundingReadiness } from '../domain'

type ReadinessState = {
  studentId: string; revision: number; status: 'loading' | 'ready' | 'error'
  data: FundingReadiness | null; error: string
}

/** A retry is a single, read-only request. Old identities/revisions cannot enable funding. */
export function useFundingReadiness(studentId: string | undefined, revision: number) {
  const [state, setState] = useState<ReadinessState | null>(null)
  const flight = useRef<{ studentId: string; revision: number; controller: AbortController } | null>(null)
  const retry = useCallback(async () => {
    if (!studentId) return
    if (flight.current?.studentId === studentId && flight.current.revision === revision) return
    flight.current?.controller.abort()
    const request = { studentId, revision, controller: new AbortController() }
    flight.current = request
    setState({ studentId, revision, status: 'loading', data: null, error: '' })
    try {
      const raw = await apiFetch<unknown>(`/api/students/${studentId}/funding`, { signal: request.controller.signal })
      const data = FundingReadinessSchema.parse(raw)
      if (flight.current === request && !request.controller.signal.aborted) {
        setState({ studentId, revision, status: 'ready', data, error: '' })
      }
    } catch (error) {
      if (flight.current === request && !request.controller.signal.aborted) {
        setState({ studentId, revision, status: 'error', data: null,
          error: error instanceof Error ? error.message : 'Funding readiness is unavailable.' })
      }
    } finally {
      if (flight.current === request) flight.current = null
    }
  }, [studentId, revision])
  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => { if (active) void retry() })
    return () => { active = false; flight.current?.controller.abort(); flight.current = null }
  }, [retry])
  // Identity checking also covers the render before the effect cleans up the old request.
  const current = state && state.studentId === studentId && state.revision === revision ? state : null
  return { data: current?.status === 'ready' ? current.data : null,
    loading: Boolean(studentId && (!current || current.status === 'loading')),
    error: current?.status === 'error' ? current.error : '', retry }
}
