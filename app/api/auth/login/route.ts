import { LoginSchema } from '@/features/auth/domain'
import { loginStaff } from '@/features/auth/server/login'
import { failure, ok, parseJson } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
  try {
    const input = await parseJson(request, LoginSchema)
    return ok(await loginStaff(input.employeeCode, input.pin))
  } catch (error) { return failure(error) }
}
