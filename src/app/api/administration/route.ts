import { withApiRoute } from '@/lib/api/route'
import { ok,parseJson } from '@/lib/api/response'
import { administrationSession,administrationSnapshot,changeAdministration } from '@/features/administration/server'
import { AdministrationChangeSchema } from '@/features/administration/domain'
export const dynamic='force-dynamic'
export const GET=withApiRoute('/api/administration',async(request:Request)=>{const s=await administrationSession(),q=new URL(request.url).searchParams;return ok(await administrationSnapshot(s,Number(q.get('staffOffset')??0),Number(q.get('terminalOffset')??0)))})
export const POST=withApiRoute('/api/administration',async(request:Request)=>{const s=await administrationSession();return ok(await changeAdministration(s,await parseJson(request,AdministrationChangeSchema)))})
