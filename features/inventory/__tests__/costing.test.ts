import { describe, expect, it } from 'vitest'
import { allocateCostLayers, calculateLandedCosts } from '@/features/inventory/costing'

describe('inventory costing', () => {
  it('allocates receipt overhead and reconciles exactly', () => {
    const result = calculateLandedCosts([
      { id: 'water', quantity: 100, purchaseUnitCostWon: 550 },
      { id: 'juice', quantity: 25, purchaseUnitCostWon: 1200 },
    ], 5_000, 2_000, 1_000)

    expect(result.reduce((sum, line) => sum + line.totalLandedCostWon, 0)).toBe(91_000)
    expect(result.reduce((sum, line) => sum + line.allocatedOverheadWon, 0)).toBe(7_000)
    expect(result.reduce((sum, line) => sum + line.allocatedDiscountWon, 0)).toBe(1_000)
  })

  it('assigns allocation rounding remainder deterministically', () => {
    const result = calculateLandedCosts([
      { id: 'a', quantity: 1, purchaseUnitCostWon: 1 },
      { id: 'b', quantity: 1, purchaseUnitCostWon: 1 },
      { id: 'c', quantity: 1, purchaseUnitCostWon: 1 },
    ], 1, 0, 0)
    expect(result.map((line) => line.allocatedOverheadWon)).toEqual([0, 0, 1])
  })

  it('uses oldest layers under FIFO', () => {
    const result = allocateCostLayers([
      { lotId: 'old', receivedAt: '2026-01-01', quantityRemaining: 10, unitCostWon: 600 },
      { lotId: 'new', receivedAt: '2026-02-01', quantityRemaining: 10, unitCostWon: 800 },
    ], 12, 'FIFO')
    expect(result).toEqual([
      { lotId: 'old', quantity: 10, unitCostWon: 600, totalCostWon: 6000 },
      { lotId: 'new', quantity: 2, unitCostWon: 800, totalCostWon: 1600 },
    ])
  })

  it('uses newest layers under LIFO', () => {
    const result = allocateCostLayers([
      { lotId: 'old', receivedAt: '2026-01-01', quantityRemaining: 10, unitCostWon: 600 },
      { lotId: 'new', receivedAt: '2026-02-01', quantityRemaining: 10, unitCostWon: 800 },
    ], 12, 'LIFO')
    expect(result.reduce((sum, line) => sum + line.totalCostWon, 0)).toBe(9200)
    expect(result[0]?.lotId).toBe('new')
  })

  it('rejects inventory shortages', () => {
    expect(() => allocateCostLayers([
      { lotId: 'only', receivedAt: '2026-01-01', quantityRemaining: 2, unitCostWon: 600 },
    ], 3, 'FIFO')).toThrow('INVENTORY_SHORTAGE')
  })
})
