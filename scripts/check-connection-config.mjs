#!/usr/bin/env node
const required = [
  'DATABASE_URL', 'CARD_HMAC_SECRET', 'COUPON_HMAC_SECRET', 'STAFF_PIN_PEPPER',
  'STUDENT_PIN_PEPPER', 'SESSION_HMAC_SECRET', 'TERMINAL_COOKIE_SECRET',
]
const missing = required.filter((name) => !process.env[name])
if (missing.length) {
  console.error('CampusPay connection state: UNCONFIGURED')
  console.error(`Missing values: ${missing.join(', ')}`)
  process.exit(1)
}
console.log('CampusPay connection state: CONFIGURED')
console.log('This presence check does not print or transmit secrets.')
