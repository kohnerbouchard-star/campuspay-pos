import 'server-only'
import { clearAppCookies, readAppCookies } from '@/lib/http/cookies'
import { fingerprintSessionToken } from '@/lib/crypto/session-fingerprint'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function logoutStaff(): Promise<void> {
  const supabase = await createServerSupabaseClient()
  const { sessionToken } = await readAppCookies()
  if (sessionToken) {
    await supabase.schema('api').rpc('revoke_staff_session', {
      p_session_token_hash: fingerprintSessionToken(sessionToken),
    })
  }
  await supabase.auth.signOut()
  await clearAppCookies()
}
