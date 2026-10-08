import { withApiRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { accessSession,accessDefaults } from '@/features/access/server'
export const dynamic='force-dynamic'
export const GET=withApiRoute('/api/administration/access/defaults',async()=>ok(await accessDefaults(await accessSession())))
