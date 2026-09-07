import type { OrderTimelineEvent } from '@/features/store/domain'
import { ORDER_STEPS, orderStatusLabel, orderTime } from '@/features/store/presentation'
import styles from './store.module.css'

export function OrderTimeline({ status, events }: { status: string; events: OrderTimelineEvent[] }) {
  return <ol className={styles.timeline} aria-label="Fulfillment timeline">
    {ORDER_STEPS.map((step) => {
      const event = events.find((entry) => entry.status === step)
      return <li key={step} data-complete={Boolean(event)} aria-current={status === step ? 'step' : undefined}><span className={styles.timelineDot} aria-hidden="true">{event ? '✓' : '·'}</span><div><strong>{orderStatusLabel(step)}</strong>{event ? <time dateTime={event.created_at}>{orderTime(event.created_at)}</time> : <span>Upcoming</span>}</div></li>
    })}
  </ol>
}
