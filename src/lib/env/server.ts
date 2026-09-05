import 'server-only'
import { z } from 'zod'

const DatabaseUrlSchema = z.string().min(20).refine(
  (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
  'DATABASE_URL must be a PostgreSQL connection string',
)

const ServerEnvSchema = z.object({
  DATABASE_URL: DatabaseUrlSchema,
  CARD_HMAC_SECRET: z.string().min(32),
  COUPON_HMAC_SECRET: z.string().min(32),
  STAFF_PIN_PEPPER: z.string().min(32),
  STUDENT_PIN_PEPPER: z.string().min(32),
  SESSION_HMAC_SECRET: z.string().min(32),
  TERMINAL_COOKIE_SECRET: z.string().min(32),
  COOKIE_SECURE: z.enum(['true', 'false']).default('true'),
})

type ParsedServerEnv = z.infer<typeof ServerEnvSchema>
export type ServerEnv = Omit<ParsedServerEnv, 'COOKIE_SECURE'> & { COOKIE_SECURE: boolean }

let cached: ServerEnv | null = null

function values() {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    CARD_HMAC_SECRET: process.env.CARD_HMAC_SECRET,
    COUPON_HMAC_SECRET: process.env.COUPON_HMAC_SECRET,
    STAFF_PIN_PEPPER: process.env.STAFF_PIN_PEPPER,
    STUDENT_PIN_PEPPER: process.env.STUDENT_PIN_PEPPER,
    SESSION_HMAC_SECRET: process.env.SESSION_HMAC_SECRET,
    TERMINAL_COOKIE_SECRET: process.env.TERMINAL_COOKIE_SECRET,
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
    throw new Error('DATABASE_NOT_CONFIGURED: database connection or application secrets are missing or invalid')
  }
  cached = { ...parsed.data, COOKIE_SECURE: parsed.data.COOKIE_SECURE === 'true' }
  return cached
}
