import { z } from 'zod'

export const StaffRoleSchema = z.enum(['cashier', 'inventory_admin', 'accountant', 'super_admin'])
export type StaffRole = z.infer<typeof StaffRoleSchema>

export const PermissionSchema = z.enum([
  'pos.read', 'pos.checkout',
  'coupons.redeem', 'coupons.manage',
  'inventory.read', 'inventory.receive', 'inventory.adjust', 'inventory.product.manage', 'inventory.price.manage',
  'wallet.read', 'wallet.adjust',
  'reports.sales', 'reports.inventory', 'reports.wallets', 'reports.coupons',
  'orders.fulfill',
  'students.manage',
  'security.credentials.request', 'security.step_up', 'security.credentials.reset', 'security.staff.manage',
])
export type Permission = z.infer<typeof PermissionSchema>

export const SessionContextSchema = z.object({
  session_id: z.string().uuid(),
  user_id: z.string().uuid(),
  employee_code: z.string(),
  display_name: z.string(),
  role: StaffRoleSchema,
  permissions: z.array(PermissionSchema),
  expires_at: z.string(),
})
export type SessionContext = z.infer<typeof SessionContextSchema>

export const LoginSchema = z.object({
  employeeCode: z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9_-]+$/),
  pin: z.string().min(4).max(16).regex(/^\d+$/),
})
