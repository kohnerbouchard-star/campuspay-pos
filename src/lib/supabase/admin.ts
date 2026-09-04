import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { getPublicEnv } from '@/lib/env/public'
import { getServerEnv } from '@/lib/env/server'

export function createSecretSupabaseClient() {
  const publicEnv = getPublicEnv()
  const serverEnv = getServerEnv()
  return createClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  )
}
