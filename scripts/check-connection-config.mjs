#!/usr/bin/env node

/**
 * Offline-only configuration check.
 * This script does not make a network request and does not contact Supabase.
 */

const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'CARD_HMAC_SECRET',
  'COUPON_HMAC_SECRET',
  'STUDENT_PIN_PEPPER',
  'SESSION_HMAC_SECRET',
  'TERMINAL_COOKIE_SECRET',
]

const missing = required.filter((name) => !process.env[name]?.trim())

if (missing.length > 0) {
  console.log('CampusPay connection state: UNCONFIGURED')
  console.log('No network request was made.')
  console.log(`Missing values: ${missing.join(', ')}`)
  process.exitCode = 1
} else {
  console.log('CampusPay connection state: CONFIG VALUES PRESENT')
  console.log('No network request was made; connectivity was not tested.')
}
