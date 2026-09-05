#!/usr/bin/env node
import { createHmac, randomInt } from 'node:crypto'
import pg from 'pg'
if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEMO_BOOTSTRAP !== 'true') {
  throw new Error('Demo bootstrap is disabled. Use only an empty development database with ALLOW_DEMO_BOOTSTRAP=true.')
}
for (const key of ['DATABASE_URL_UNPOOLED','STAFF_PIN_PEPPER','STUDENT_PIN_PEPPER','CARD_HMAC_SECRET','COUPON_HMAC_SECRET']) {
  if (!process.env[key]) throw new Error(`Missing ${key}`)
}
const h=(k,s)=>createHmac('sha256', process.env[k]).update(s).digest('hex')
const staff=[['1001','cashier'],['2001','inventory_admin'],['3001','accountant'],['9001','super_admin']].map(([employeeCode,role])=>({employeeCode,role,displayName:`Demo ${role}`,pin:String(randomInt(10000000,100000000))}))
const studentPin=String(randomInt(100000,1000000))
const client=new pg.Client({connectionString:process.env.DATABASE_URL_UNPOOLED})
try {
  await client.connect()
  await client.query('select * from api.bootstrap_demo($1::jsonb,$2,$3,$4)',[
    JSON.stringify(staff.map(({pin,...s})=>({...s,pinProof:h('STAFF_PIN_PEPPER',`staff-pin:${pin}`)}))),
    h('STUDENT_PIN_PEPPER',`student-pin:${studentPin}`),h('CARD_HMAC_SECRET','04A81F92C73180'),h('COUPON_HMAC_SECRET','WELCOME10')
  ])
  // Printed once to the operator's terminal only. Never commit this output.
  for (const s of staff) console.log(`${s.role}: ${s.employeeCode} / ${s.pin}`)
  console.log(`Demo student PIN: ${studentPin}; demo card: 04A81F92C73180; coupon: WELCOME10`)
} finally { await client.end() }
