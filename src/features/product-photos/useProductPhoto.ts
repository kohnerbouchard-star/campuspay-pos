"use client"
import { useCallback, useEffect, useRef, useState } from 'react'
import { requestPhoto, uploadPhoto } from './client'
import type { PhotoCrop, PhotoSnapshot } from './domain'

type Busy = 'loading' | 'uploading' | 'saving' | 'removing' | 'cancelling' | null
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function useProductPhoto(productId: string, userId: string, onChanged?: () => void) {
  const storageKey = `campuspay:product-photo:${userId}:${productId}`
  const [snapshot, setSnapshot] = useState<PhotoSnapshot | null>(null)
  const [reference, setReference] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy>('loading')
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [progress, setProgress] = useState(0), [disabled, setDisabled] = useState(false)
  const [blocked, setBlocked] = useState(false), [uncertain, setUncertain] = useState(false)
  const latest = useRef<PhotoSnapshot | null>(null), pending = useRef<string | null>(null)
  const epoch = useRef(0), gate = useRef(false), alive = useRef(false)
  const abortUpload = useRef<(() => void) | null>(null)
  const changed = useRef(onChanged)
  useEffect(() => { changed.current = onChanged }, [onChanged])
  const adopt = useCallback((result: PhotoSnapshot | 'disabled', requestId: string | null) => {
    if (result === 'disabled') { setDisabled(true); return }
    if (result.product_id !== productId || (requestId && result.operation && result.operation.request_id !== requestId)
      || (latest.current && result.revision < latest.current.revision)) throw new Error('Outdated photo status was rejected. Check photo status again.')
    latest.current = result; setSnapshot(result); setDisabled(false); setUncertain(false)
    const state = result.operation?.state
    if (state === 'SAVED' || state === 'CANCELLED' || state === 'CONFLICT') {
      // A confirmed outcome is never relabelled a failed save by a refresh error.
      setNotice(state === 'SAVED' ? result.operation?.saved_revision === result.revision ? 'Photo change saved.' : 'Your change was saved. A newer photo change is now current.'
        : state === 'CONFLICT' ? 'Another editor changed this photo. The current photo was kept. Review it before trying again.' : 'Pending photo change cancelled. The current photo was kept.')
      try {
        if (sessionStorage.getItem(storageKey) === requestId) sessionStorage.removeItem(storageKey)
        pending.current = null; setReference(null)
      } catch { setBlocked(true); setError('The result is confirmed, but this browser could not clear its recovery reference. New photo changes are blocked.') }
      if (state === 'SAVED') Promise.resolve().then(() => changed.current?.()).catch(() => { /* Catalog refresh does not undo a saved photo. */ })
    } else if (state === 'READY') setNotice('New photo uploaded and validated. Review it, then save to replace the current photo.')
    else if (requestId) setNotice(state === 'UPLOADING' ? 'The original upload is still pending. Check status or cancel it; do not start a replacement request.' : 'The request is not recorded yet. Cancel it to prevent a delayed upload or save before trying again.')
  }, [productId, storageKey])
  const run = useCallback(async (label: Busy, action: () => Promise<PhotoSnapshot | 'disabled'>, requestId: string | null, interruptUpload = false) => {
    if (gate.current && !interruptUpload) return
    gate.current = true
    const attempt = ++epoch.current
    if (interruptUpload) abortUpload.current?.()
    setBusy(label); setError(''); setNotice('')
    try {
      const result = await action()
      if (alive.current && attempt === epoch.current) adopt(result, requestId)
    } catch (caught) {
      if (alive.current && attempt === epoch.current) {
        setError(caught instanceof Error ? caught.message : 'The photo result could not be confirmed.')
        setUncertain(!!requestId)
      }
    } finally {
      if (alive.current && attempt === epoch.current) { gate.current = false; setBusy(null); abortUpload.current = null }
    }
  }, [adopt])
  const check = useCallback(() => run('loading', () => requestPhoto(productId, 'GET', pending.current ?? undefined), pending.current), [productId, run])
  const invalidate = useCallback(() => { alive.current = false; epoch.current++; gate.current = false; abortUpload.current?.() }, [])
  useEffect(() => {
    alive.current = true
    void Promise.resolve().then(() => {
      if (!alive.current) return
      try {
        const saved = sessionStorage.getItem(storageKey)
        if (saved && !UUID.test(saved)) throw new Error('Invalid recovery reference')
        pending.current = saved; setReference(saved)
      } catch { setBlocked(true); setError('Safe photo recovery storage is unavailable. Photo changes are blocked in this browser.'); setBusy(null); return }
      void check()
    })
    return invalidate
  }, [storageKey, check, invalidate])
  function reserveReference(): string | null {
    if (blocked || disabled || gate.current || pending.current || !latest.current) return null
    const requestId = crypto.randomUUID()
    try { sessionStorage.setItem(storageKey, requestId) }
    catch { setBlocked(true); setError('This browser could not preserve photo recovery. Nothing was submitted.'); return null }
    pending.current = requestId; setReference(requestId)
    return requestId
  }
  function upload(file: File, reason: string, crop: PhotoCrop) {
    const requestId = reserveReference(); if (!requestId || !latest.current) return
    const revision = latest.current.revision
    setProgress(0)
    void run('uploading', () => {
      const upload = uploadPhoto(productId, file, { requestId, revision, reason, crop }, setProgress)
      abortUpload.current = upload.abort
      return upload.promise
    }, requestId)
  }
  function save() {
    const requestId = pending.current
    if (!requestId || uncertain || snapshot?.operation?.state !== 'READY') return
    void run('saving', () => requestPhoto(productId, 'PUT', requestId), requestId)
  }
  function cancel() {
    const requestId = pending.current
    if (!requestId || (busy && busy !== 'uploading')) return
    void run('cancelling', () => requestPhoto(productId, 'CANCEL', requestId), requestId, busy === 'uploading')
  }
  function remove(reason: string) {
    const requestId = reserveReference(); if (!requestId || !latest.current) return
    const revision = latest.current.revision
    void run('removing', () => requestPhoto(productId, 'DELETE', requestId, { revision, reason }), requestId)
  }
  return { snapshot, reference, busy, error, notice, progress, disabled, blocked, uncertain, check, upload, save, cancel, remove }
}
