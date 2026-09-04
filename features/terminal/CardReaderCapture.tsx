'use client'

import { useEffect, useRef } from 'react'

export function CardReaderCapture({
  active,
  onRead,
}: {
  active: boolean
  onRead(value: string): void
}) {
  const buffer = useRef('')
  const lastKeyAt = useRef(0)

  useEffect(() => {
    if (!active) {
      buffer.current = ''
      return
    }

    const handler = (event: KeyboardEvent) => {
      const now = Date.now()
      if (now - lastKeyAt.current > 120) buffer.current = ''
      lastKeyAt.current = now

      if (event.key === 'Enter') {
        const value = buffer.current
        buffer.current = ''
        if (value.length >= 6) {
          event.preventDefault()
          onRead(value)
        }
        return
      }
      if (event.key.length === 1 && /^[a-zA-Z0-9:-]$/.test(event.key)) {
        buffer.current += event.key
      }
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [active, onRead])

  return null
}
