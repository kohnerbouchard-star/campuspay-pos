import 'server-only'
import type { Permission, SessionContext } from '../domain'
import { ApiError } from '@/lib/api/errors'
export function requireCapability(session: SessionContext, permission: Permission) {
 if (!session.permissions.includes(permission)) throw new ApiError(403, 'FORBIDDEN', 'This action is not assigned to your account')
}
