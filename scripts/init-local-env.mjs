#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'

if (fs.existsSync('.env.local')) {
  console.error('.env.local already exists; refusing to overwrite it.')
  process.exit(1)
}
const secret = () => randomBytes(32).toString('base64url')
const content = `DATABASE_URL=
CARD_HMAC_SECRET=${secret()}
COUPON_HMAC_SECRET=${secret()}
STAFF_PIN_PEPPER=${secret()}
STUDENT_PIN_PEPPER=${secret()}
SESSION_HMAC_SECRET=${secret()}
TERMINAL_COOKIE_SECRET=${secret()}
COOKIE_SECURE=false
`
fs.writeFileSync('.env.local', content, { mode: 0o600 })
console.log('Created .env.local with fresh application secrets. Add DATABASE_URL before starting the app.')
