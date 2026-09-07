import type { ReactNode } from 'react'

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty-state"><strong>{title}</strong>{children && <p>{children}</p>}</div>
}
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading-state" role="status" aria-live="polite"><span className="loading-indicator" aria-hidden="true" />{label}</div>
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="error-message" role="alert"><span>{message}</span>{onRetry && <button className="text-action" onClick={onRetry}>Try again</button>}</div>
}
