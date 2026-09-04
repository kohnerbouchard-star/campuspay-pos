import type { InventoryLot } from '@/features/inventory/domain'
import { formatWon } from '@/lib/format/currency'

export function LotTable({lots}:{lots:InventoryLot[]}){return <section className="panel table-panel"><div className="panel-heading"><div><p className="eyebrow">Cost layers</p><h2>Inventory lots</h2></div></div><div className="table-scroll"><table><thead><tr><th>Product</th><th>Receipt</th><th>Remaining</th><th>Unit cost</th><th>Value</th><th>Expires</th></tr></thead><tbody>{lots.map(l=><tr key={l.lot_id}><td>{l.product_name}</td><td>{l.receipt_number}</td><td>{l.quantity_remaining}/{l.quantity_received}</td><td>{formatWon(l.landed_unit_cost_won)}</td><td>{formatWon(l.inventory_value_won)}</td><td>{l.expiration_date??'—'}</td></tr>)}</tbody></table></div></section>}
