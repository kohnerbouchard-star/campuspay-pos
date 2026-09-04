# Database and accounting rules

## Inventory source of truth

Stock on hand is derived from open inventory lots. It is not a freely editable field.

```text
stock_on_hand = SUM(inventory_lots.quantity_remaining)
```

A positive quantity enters inventory only through a posted stock receipt. Each receipt records supplier, invoice, purchase date, item quantity, unit purchase cost, fees, discounts, expiration date, and the employee who posted it.

## Landed cost

For each receipt line:

```text
base_cost = quantity × purchase_unit_cost
allocated_header_cost = proportional share of shipping and other costs
allocated_discount = proportional share of receipt discount
lot_total_cost = base_cost + allocated_header_cost − allocated_discount
landed_unit_cost = lot_total_cost ÷ quantity
```

Amounts are integer won. Any allocation remainder is assigned deterministically to the final line so the lot totals reconcile exactly to the receipt total.

## Cost flow

The system setting is `FIFO` by default. `LIFO` exists for controlled simulation/alternate accounting only. A method change is a super-admin configuration event and should not be performed after live reporting begins without a documented conversion.

Each sale records the exact lot allocations in `private.sale_cost_allocations`. Historical COGS does not change when a product price or a future purchase cost changes.

## Wallet accounting

`private.wallet_ledger` is immutable. `private.wallets.balance_won` is a transactionally maintained performance balance and must reconcile to the ledger.

```text
projected_balance = current_balance − sale_total
approve when projected_balance >= −15000
```

Corrections are new reversing entries. Existing ledger entries, sales, receipts, and inventory movements are never overwritten or deleted.
