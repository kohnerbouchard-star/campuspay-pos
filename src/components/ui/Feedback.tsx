import type { ReactNode } from 'react'
import { DATABASE_UPGRADE_MESSAGE } from '@/lib/api/errors'
import { Icon } from '@/components/ui/Icon'

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty-state"><span className="empty-state-mark"><Icon name="box" size={25} /></span><strong>{title}</strong>{children && <p>{children}</p>}</div>
}
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading-state" role="status" aria-live="polite"><span className="loading-indicator" aria-hidden="true" />{label}</div>
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const upgrade = message === DATABASE_UPGRADE_MESSAGE
  return <div className="error-message" role="alert">{upgrade ? <div><strong>Database update required</strong><p>{message}</p><p>This application version includes features that are not installed on the connected CampusPay database. Contact the system administrator or switch to the matching development database.</p>{process.env.NODE_ENV === 'development' && <p>Your local application may be connected to an older database branch.</p>}</div> : <span>{message}</span>}{onRetry && <button className="text-action" onClick={onRetry}>Try again</button>}</div>
}
