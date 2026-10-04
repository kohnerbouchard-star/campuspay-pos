import type { ReactNode } from 'react'

const paths = {
  register: <><rect x="4" y="3" width="16" height="11" rx="2" /><path d="M8 18h8M12 14v4M3 21h18M8 7h8M8 10h4" /></>,
  bag: <><path d="M5 7h14l1 14H4L5 7Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>,
  box: <><path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5" /></>,
  tag: <><path d="M20 13 13 20a2 2 0 0 1-3 0l-8-8V3h9l9 8a2 2 0 0 1 0 2Z" /><circle cx="7.5" cy="7.5" r="1" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 21v-2a6 6 0 0 0-4-5.7" /></>,
  wallet: <><path d="M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v12H6a3 3 0 0 1-3-3V6" /><path d="M20 12h-5v5h5M17 14.5h.01" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  cash: <><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M6 12h.01M18 12h.01" /></>,
  refund: <><path d="M9 5H5v4M5 5l5 5M5 14a7 7 0 1 0 4-8" /><path d="M13 10v5M11 11h3a1 1 0 0 1 0 2h-2a1 1 0 0 0 0 2h3" /></>,
  chart: <><path d="M3 3v18h18M7 16v-5M12 16V7M17 16v-8" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
  settings: <><path d="M4 7h16M4 17h16M8 4v6M16 14v6" /><circle cx="8" cy="7" r="2" /><circle cx="16" cy="17" r="2" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  cup: <><path d="M5 8h12v7a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V8ZM17 9h2a3 3 0 1 1 0 6h-2M8 3v2M13 3v2" /></>,
  snack: <><path d="M20.5 12.5A8.5 8.5 0 1 1 11.5 3a4 4 0 0 0 4 4 4 4 0 0 0 5 5.5Z" /><path d="M8 9h.01M7 14h.01M12 16h.01M13 11h.01M17 17h.01" /></>,
  meal: <><path d="M4 3v5a3 3 0 0 0 6 0V3M7 3v18M19 3c-3 3-4 6-4 10h4M19 3v18" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  sparkles: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4M18 4h4" /></>,
  card: <><rect x="2" y="4" width="20" height="16" rx="3" /><path d="M2 9h20M6 15h3M13 15h5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  logout: <><path d="M9 21H4V3h5M9 12h12m-4-4 4 4-4 4" /></>,
  receipt: <><path d="m5 3 3 2 4-2 4 2 3-2v18l-3-2-4 2-4-2-3 2V3ZM9 9h6M9 13h6M9 17h3" /></>,
  building: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 21v-5h6v5M8 7h2M14 7h2M8 11h2M14 11h2" /></>,
  truck: <><path d="M1 5h13v12H1V5ZM14 9h4l4 4v4h-8" /><circle cx="5" cy="18" r="3" /><circle cx="18" cy="18" r="3" /></>,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof paths

/** Decorative UI icons. The containing control supplies the accessible label. */
export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>
    {paths[name]}
  </svg>
}
