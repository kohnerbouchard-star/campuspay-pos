import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getPublicEnv } from '@/lib/env/public'

export async function createServerSupabaseClient() {
  const cookieStore = await cookies()
  const env = getPublicEnv()

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (items) => {
          for (const { name, value, options } of items) {
            try {
              cookieStore.set(name, value, options)
            } catch {
              // Server Components cannot always write cookies. Route handlers can.
            }
          }
        },
      },
    },
  )
}
