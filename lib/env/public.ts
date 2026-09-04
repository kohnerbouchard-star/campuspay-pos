import { z } from 'zod'

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
})

export type PublicEnv = z.infer<typeof PublicEnvSchema>

let cached: PublicEnv | null = null

function values() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  }
}

export function isPublicSupabaseConfigured(): boolean {
  return PublicEnvSchema.safeParse(values()).success
}

export function getPublicEnv(): PublicEnv {
  if (cached) return cached
  const parsed = PublicEnvSchema.safeParse(values())
  if (!parsed.success) {
    throw new Error('SUPABASE_NOT_CONFIGURED: public connection values are missing or invalid')
  }
  cached = parsed.data
  return cached
}
