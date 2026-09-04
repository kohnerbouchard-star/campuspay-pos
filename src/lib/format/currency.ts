const won = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 })

export function formatWon(value: number): string {
  return won.format(value)
}
