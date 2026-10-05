# Staff navigation and contextual routes

Primary staff destinations: 14 before, 5 after. Workspaces are organizational containers, never permission bundles. An allowed parent does not authorize its sections or actions. Existing bookmarks remain guarded or redirect to the canonical context.

| Workspace | Sections / routes | Record actions |
| --- | --- | --- |
| Register | `/register` chooses first permitted section; `/pos`, `/orders`, `/cash`, `/cash/movements` | POS immediately for assigned staff; fulfill orders; operate assigned drawer; independently approved cash movements |
| Students | `/students`; `/funding` receipts/corrections; `/security` contextual credential support; `/students/[id]/complete` | Selected student → Add Funds primary, Wallet History secondary, More for authorized credential/status actions |
| Inventory | `/inventory`, `/coupons` | Selected product → Receive Stock primary; More for permitted price, adjustment, lots, edit/archive actions |
| Finance | `/finance`, `/refunds`, `/reconciliation`, `/reports`, `/cash/history` | Read, refund issue and cash handover are separate; report tabs/export follow individual capabilities |
| Admin | `/admin`, `/administration`, `/settings/payments` | Staff → Employee → Access, profile/session controls, registered terminals and payment policy with distinct authorization |

`/accounting` redirects to Students. The legacy AdjustmentPanel is unmounted. Normal deposits begin only at Students → Student → Add Funds; no second student search is required. The selected ID is bound in the database, independently of the scanned card.

## Preset and custom examples

| Stored assignment | Visible workspaces |
| --- | --- |
| New Staff defaults | Register |
| New Manager defaults, no wallets | Register, Students, Inventory, Finance |
| New Accountant defaults | Register, Students, Finance (Register contains assigned cash functions; POS remains absent) |
| New Super Admin defaults | All five |
| Alex: Staff + order fulfillment + inventory view, no cash operation | Register, Inventory |
| Accountant + wallet approval | Register, Students, Finance; no pricing, staff or credential mutation |
| Manager + student status, no credentials | Register, Students, Inventory, Finance; status controls visible, credential controls absent |
| View-only POS/students/inventory/coupons/orders | Register, Students, Inventory; no checkout, funds, mutation or picking controls |
| Staff + staff/terminal view | Admin; read-only employee effective access, no Access editor or management controls |

These are effective-capability examples, not role-routing rules. Existing migrated employees may differ from new preset defaults. The access editor indicates Customized, shows defaults/differences, and offers an explicit reviewed reset. Effective Access text derives from the capability catalog and actual stored/proposed assignment, not hand-maintained role descriptions.

On mobile the semantic matrix becomes grouped expandable areas. Cells exist only for implemented, meaningful View/Operate/Manage/Approve actions. Dependencies add prerequisites with an explanation and removing a prerequisite removes dependent cells. Access changes show the target, preset, additions, removals, reason, typed identity confirmation and session revocation; current Super Admin PIN is required and review expires after one minute.

Unauthorized controls are absent. Authorized workflows blocked by activation, closed/unassigned drawer, inactive student or incomplete card/PIN stay visible with readiness explanations and no balance change. Add Funds collapses completed checks to bring the amount form forward; blockers stay expanded.
