import 'server-only'
import { z } from 'zod'

const ServerEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(20),
  CARD_HMAC_SECRET: z.string().min(32),
  COUPON_HMAC_SECRET: z.string().min(32),
  STUDENT_PIN_PEPPER: z.string().min(32),
  SESSION_HMAC_SECRET: z.string().min(32),
  TERMINAL_COOKIE_SECRET: z.string().min(32),
  STAFF_AUTH_EMAIL_DOMAIN: z.string().min(3).default('campuspay.internal'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('true'),
})

type ParsedServerEnv = z.infer<typeof ServerEnvSchema>
export type ServerEnv = Omit<ParsedServerEnv, 'COOKIE_SECURE'> & { COOKIE_SECURE: boolean }

let cached: ServerEnv | null = null

function values() {
  return {
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    CARD_HMAC_SECRET: process.env.CARD_HMAC_SECRET,
    COUPON_HMAC_SECRET: process.env.COUPON_HMAC_SECRET,
    STUDENT_PIN_PEPPER: process.env.STUDENT_PIN_PEPPER,
    SESSION_HMAC_SECRET: process.env.SESSION_HMAC_SECRET,
    TERMINAL_COOKIE_SECRET: process.env.TERMINAL_COOKIE_SECRET,
    STAFF_AUTH_EMAIL_DOMAIN: process.env.STAFF_AUTH_EMAIL_DOMAIN,
    COOKIE_SECURE: process.env.COOKIE_SECURE,
  }
}

export function isServerConfigurationPresent(): boolean {
  return ServerEnvSchema.safeParse(values()).success
}

export function getServerEnv(): ServerEnv {
  if (cached) return cached
  const parsed = ServerEnvSchema.safeParse(values())
  if (!parsed.success) {
    throw new Error('SUPABASE_NOT_CONFIGURED: server connection or application secrets are missing or invalid')
  }
  cached = { ...parsed.data, COOKIE_SECURE: parsed.data.COOKIE_SECURE === 'true' }
  return cached
}
