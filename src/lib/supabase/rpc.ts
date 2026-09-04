import 'server-only'
import type { ZodType } from 'zod'
import { toApiError } from '@/lib/api/errors'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function callApiRpc<T>(
  name: string,
  args: Record<string, unknown>,
  schema: ZodType<T>,
): Promise<T> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.schema('api').rpc(name, args)
  if (error) throw toApiError(new Error(error.message))
  return schema.parse(data)
}
