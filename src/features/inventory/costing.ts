import type { CostMethod } from '@/features/inventory/domain'

export type ReceiptCostLine = {
  id: string
  quantity: number
  purchaseUnitCostWon: number
}
export type CostedReceiptLine = ReceiptCostLine & {
  baseCostWon: number
  allocatedOverheadWon: number
  allocatedDiscountWon: number
  totalLandedCostWon: number
  landedUnitCostWon: number
}

function allocate(total: number, weights: number[]): number[] {
  if (total === 0) return weights.map(() => 0)
  const denominator = weights.reduce((sum, value) => sum + value, 0)
  if (denominator <= 0) {
    const per = Math.floor(total / weights.length)
    return weights.map((_, index) => index === weights.length - 1 ? total - per * (weights.length - 1) : per)
  }
  let assigned = 0
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return total - assigned
    const value = Math.floor(total * weight / denominator)
    assigned += value
    return value
  })
}

export function calculateLandedCosts(
  lines: ReceiptCostLine[],
  shippingWon: number,
  otherCostsWon: number,
  discountWon: number,
): CostedReceiptLine[] {
  if (!lines.length) throw new Error('At least one receipt line is required')
  const base = lines.map((line) => line.quantity * line.purchaseUnitCostWon)
  const overhead = allocate(shippingWon + otherCostsWon, base)
  const discount = allocate(discountWon, base)
  return lines.map((line, index) => {
    const total = base[index] + overhead[index] - discount[index]
    if (total < 0) throw new Error('Discount cannot exceed landed cost')
    return {
      ...line,
      baseCostWon: base[index],
      allocatedOverheadWon: overhead[index],
      allocatedDiscountWon: discount[index],
      totalLandedCostWon: total,
      landedUnitCostWon: Math.round(total / line.quantity),
    }
  })
}

export type CostLayer = { lotId: string; receivedAt: string; quantityRemaining: number; unitCostWon: number }
export type LayerAllocation = { lotId: string; quantity: number; unitCostWon: number; totalCostWon: number }

export function allocateCostLayers(layers: CostLayer[], quantity: number, method: CostMethod): LayerAllocation[] {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Quantity must be a positive integer')
  const sorted = [...layers]
    .filter((layer) => layer.quantityRemaining > 0)
    .sort((a, b) => method === 'FIFO'
      ? a.receivedAt.localeCompare(b.receivedAt) || a.lotId.localeCompare(b.lotId)
      : b.receivedAt.localeCompare(a.receivedAt) || b.lotId.localeCompare(a.lotId))
  const available = sorted.reduce((sum, layer) => sum + layer.quantityRemaining, 0)
  if (available < quantity) throw new Error('INVENTORY_SHORTAGE')
  let needed = quantity
  const result: LayerAllocation[] = []
  for (const layer of sorted) {
    if (!needed) break
    const take = Math.min(needed, layer.quantityRemaining)
    result.push({ lotId: layer.lotId, quantity: take, unitCostWon: layer.unitCostWon, totalCostWon: take * layer.unitCostWon })
    needed -= take
  }
  return result
}
