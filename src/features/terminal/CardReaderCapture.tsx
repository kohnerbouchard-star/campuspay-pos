'use client'

import { useEffect, useRef } from 'react'

export function CardReaderCapture({ active, onRead }: {
  active: boolean
  onRead(value: string): void
}) {
  const buffer = useRef('')
  const lastKeyAt = useRef(0)

  useEffect(() => {
    buffer.current = ''
    if (!active) return
    let consumed = false

    const deliver = (value: string) => {
      if (consumed || !/^[a-zA-Z0-9:-]{6,64}$/.test(value)) return false
      consumed = true
      buffer.current = ''
      onRead(value)
      return true
    }

    const handler = (event: KeyboardEvent) => {
      if (consumed || event.ctrlKey || event.metaKey || event.altKey) return
      const now = Date.now()
      if (now - lastKeyAt.current > 120) buffer.current = ''
      lastKeyAt.current = now
      if (event.key === 'Enter') {
        const value = buffer.current
        buffer.current = ''
        if (deliver(value)) event.preventDefault()
        return
      }
      if (event.key.length === 1 && /^[a-zA-Z0-9:-]$/.test(event.key)) {
        event.preventDefault()
        buffer.current = (buffer.current + event.key).slice(-64)
      }
    }

    // Local testing without hardware; never enabled outside an armed popup.
    const pasted = (event: ClipboardEvent) => {
      const value = event.clipboardData?.getData('text/plain').trim() ?? ''
      if (deliver(value)) event.preventDefault()
    }
    window.addEventListener('keydown', handler, true)
    window.addEventListener('paste', pasted, true)
    return () => {
      buffer.current = ''
      window.removeEventListener('keydown', handler, true)
      window.removeEventListener('paste', pasted, true)
    }
  }, [active, onRead])

  return null
}
