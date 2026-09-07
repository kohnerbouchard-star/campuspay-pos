export const NEXT_ORDER_STATUS: Record<string, { status: 'PICKING' | 'READY' | 'OUT_FOR_DELIVERY' | 'DELIVERED'; label: string } | undefined> = {
  PLACED: { status: 'PICKING', label: 'Start picking' },
  PICKING: { status: 'READY', label: 'Mark ready for delivery' },
  READY: { status: 'OUT_FOR_DELIVERY', label: 'Start delivery' },
  OUT_FOR_DELIVERY: { status: 'DELIVERED', label: 'Confirm delivered' },
}
