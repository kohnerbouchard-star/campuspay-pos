// Called only by the isolated-localhost integration harness. Never connects to Neon.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'

export async function runEnrollmentChecks({ owner, request, login, jar, catalog, base }) {
  assert.ok(['127.0.0.1', 'localhost'].includes(owner.connectionParameters.host), 'Enrollment checks require localhost')
  const suffix = randomBytes(5).toString('hex').toUpperCase()
  const pin = '682947'
  const input = {
    studentCode: `ENROLL-${suffix}`, displayName: `Enrollment ${suffix}`,
    cardRead: `CARD${randomBytes(8).toString('hex').toUpperCase()}`,
    pin, confirmationPin: pin, idempotencyKey: randomUUID(),
  }
  await request(jar(), '/api/students', undefined, 401)
  await request(jar(), '/api/students', input, 401)
  for (const code of ['1001', '2001', '3001']) {
    const denied = await login(code)
    if(code==='1001')await request(denied, '/api/students', undefined, 403)
    else{const viewed=await request(denied,'/api/students');if(code==='2001')assert.ok(viewed.every(s=>s.balance_won===null))}
    await request(denied, '/api/students', input, 403)
  }
  let admin = await login('9001')
  await request(admin, '/api/students', { ...input, studentCode: '' }, 400)
  await request(admin, '/api/students', { ...input, displayName: '' }, 400)
  await request(admin, '/api/students', { ...input, pin: '123', confirmationPin: '123' }, 400)
  await request(admin, '/api/students', { ...input, confirmationPin: '194826' }, 400)
  await request(admin, '/api/students', { ...input, confirmationPin: undefined }, 400)
  await request(admin, '/api/students', { ...input, cardRead: '------' }, 400)
  await request(admin, '/api/students', { ...input, initialBalanceWon: 1000 }, 400)

  const enrolled = await request(admin, '/api/students', input, 201)
  assert.equal(enrolled.balance_won, 0)
  assert.equal(enrolled.card_active, true)
  assert.equal(enrolled.student_code, input.studentCode)
  assert.match(enrolled.audit_reference, /^AUD-ENROLL-/)
  assert.ok(!JSON.stringify(enrolled).includes(pin))
  assert.ok(!/fingerprint|pin_hash|pin_proof|request_proof/.test(JSON.stringify(enrolled)))
  const verify = await owner.query(`select
    (select count(*)::int from private.students where id=$1) as students,
    (select count(*)::int from private.wallets where student_id=$1 and balance_won=0) as wallets,
    (select count(*)::int from private.student_credentials where student_id=$1 and pin_hash like '$2a$12$%') as credentials,
    (select count(*)::int from private.student_cards where student_id=$1 and active) as cards,
    (select count(*)::int from private.audit_events where subject_id=$1 and event_type='STUDENT_ENROLLED') as audits,
    (select count(*)::int from private.wallet_ledger where student_id=$1) as ledger,
    (select count(*)::int from private.student_enrollments where student_id=$1) as enrollments`, [enrolled.student_id])
  assert.deepEqual(verify.rows[0], { students: 1, wallets: 1, credentials: 1, cards: 1, audits: 1, ledger: 0, enrollments: 1 })
  const audit = await owner.query('select safe_payload from private.audit_events where reference_number=$1', [enrolled.audit_reference])
  assert.deepEqual(audit.rows[0].safe_payload, { initial_balance_won: 0, card_active: true })

  const replay = await request(admin, '/api/students', input, 201)
  assert.equal(replay.student_id, enrolled.student_id)
  assert.equal(replay.audit_reference, enrolled.audit_reference)
  await request(admin, '/api/students', { ...input, displayName: 'Changed request' }, 409)
  const duplicateStudent = await request(admin, '/api/students', { ...input, studentCode: input.studentCode.toLowerCase(), cardRead: `UNUSED${suffix}`, idempotencyKey: randomUUID() }, 409)
  assert.match(duplicateStudent.message, /already enrolled/)
  const duplicateCardCode = `DUPLICATE-${suffix}`
  const duplicateCard = await request(admin, '/api/students', { ...input, studentCode: duplicateCardCode, idempotencyKey: randomUUID() }, 409)
  assert.match(duplicateCard.message, /already assigned/)
  assert.equal((await owner.query('select count(*)::int as n from private.students where student_code=$1', [duplicateCardCode])).rows[0].n, 0)

  const students = await request(admin, `/api/students?q=${encodeURIComponent(input.studentCode)}`)
  assert.equal(students.length, 1)
  assert.equal(students[0].student_id, enrolled.student_id)
  assert.equal(students[0].audit_reference, enrolled.audit_reference)
  const securityOperator = await login('2001')
  const safeSearch = await request(securityOperator, `/api/security/students?q=${encodeURIComponent(input.studentCode)}`)
  assert.equal(safeSearch[0].student_id, enrolled.student_id)
  assert.ok(!('balance_won' in safeSearch[0]))

  // A late failure after student, wallet, credential and card creation must roll everything back.
  const failCode = `ROLLBACK-${suffix}`
  const counts = async () => (await owner.query(`select
    (select count(*)::int from private.students) as students,
    (select count(*)::int from private.wallets) as wallets,
    (select count(*)::int from private.student_credentials) as credentials,
    (select count(*)::int from private.student_cards) as cards,
    (select count(*)::int from private.student_enrollments) as enrollments,
    (select count(*)::int from private.audit_events where event_type='STUDENT_ENROLLED') as audits`)).rows[0]
  const before = await counts()
  await owner.query(`create function private.test_enrollment_failure() returns trigger language plpgsql set search_path='' as $$
    begin if new.event_type='STUDENT_ENROLLED' then raise exception 'TEST_ENROLLMENT_ROLLBACK'; end if; return new; end; $$;
    create trigger test_enrollment_failure before insert on private.audit_events for each row execute function private.test_enrollment_failure()`)
  try {
    await request(admin, '/api/students', { ...input, studentCode: failCode, cardRead: `ROLLBACK${suffix}`, idempotencyKey: randomUUID() }, 500)
    assert.deepEqual(await counts(), before)
  } finally {
    await owner.query('drop trigger test_enrollment_failure on private.audit_events; drop function private.test_enrollment_failure()')
  }

  // Concurrent requests with one idempotency key settle exactly once.
  const concurrent = { ...input, studentCode: `CONCURRENT-${suffix}`, cardRead: `CONCURRENT${suffix}`, idempotencyKey: randomUUID() }
  const responses = await Promise.all([request(admin, '/api/students', concurrent, 201), request(admin, '/api/students', concurrent, 201)])
  assert.equal(responses[0].student_id, responses[1].student_id)
  assert.equal((await owner.query('select count(*)::int as n from private.student_enrollments where idempotency_key=$1', [concurrent.idempotencyKey])).rows[0].n, 1)

  // The account is immediately usable by the isolated student session and shared settlement engine.
  const customer = jar()
  await request(customer, '/api/store/login', { cardNumber: input.cardRead, pin })
  let session = await request(customer, '/api/store/session')
  assert.equal(session.student_id, enrolled.student_id)
  assert.equal(session.balance_won, 0)
  const locations = await request(customer, '/api/store/locations')
  const location = locations.find((value) => value.orderable)
  assert.ok(location)
  const product = catalog.find((value) => value.selling_price_won > 0 && value.selling_price_won <= 15000 && !value.sold_out)
  assert.ok(product)
  const order = await request(customer, '/api/store/orders', { items: [{ productId: product.id, quantity: 1 }], couponCode: null, deliveryLocationId: location.location_id, deliveryNote: 'Enrollment integration', idempotencyKey: randomUUID() }, 201)
  assert.match(order.order_number, /^WEB-/)
  session = await request(customer, '/api/store/session')
  assert.equal(session.balance_won, -product.selling_price_won)

  // Card replacement retains one-use, student-bound elevation and invalidates old store access.
  admin = await login('9001')
  const credentialOperator = await login('2001')
  const stepUp = await request(credentialOperator, '/api/security/step-up', { superAdminEmployeeCode: '9001', superAdminPin: '12345678', purpose: 'RESET_STUDENT_CARD', studentId: enrolled.student_id })
  const replacementCard = `REPLACED${suffix}`
  await request(credentialOperator, `/api/security/students/${enrolled.student_id}/card-reset`, { authorizationToken: stepUp.authorizationToken, newCardRead: replacementCard })
  await request(customer, '/api/store/session', undefined, 401)
  await request(jar(), '/api/store/login', { cardNumber: input.cardRead, pin }, 401)
  await request(jar(), '/api/store/login', { cardNumber: replacementCard, pin })
  await request(credentialOperator, `/api/security/students/${enrolled.student_id}/card-reset`, { authorizationToken: stepUp.authorizationToken, newCardRead: `SECOND${suffix}` }, 403)

  // Runtime callers cannot bypass role authorization or null-proof validation.
  const adminSession = await request(admin, '/api/auth/session')
  const cashierSession = await request(await login('1001'), '/api/auth/session')
  await assert.rejects(owner.query('select * from api.enroll_student($1,$2,$3,$4,$5,$6)', [cashierSession.session_id, `BADROLE-${suffix}`, 'Denied', 'a'.repeat(64), 'b'.repeat(64), randomUUID()]), /FORBIDDEN/)
  await assert.rejects(owner.query('select * from api.enroll_student($1,$2,$3,$4,$5,$6)', [adminSession.session_id, `BADPIN-${suffix}`, 'Denied', 'a'.repeat(64), null, randomUUID()]), /BAD_REQUEST/)
  await owner.query('update private.student_enrollment_limits set attempt_count=30,window_started_at=now() where staff_user_id=$1', [adminSession.user_id])
  try {
    await request(admin, '/api/students', { ...input, studentCode: `LIMIT-${suffix}`, cardRead: `LIMIT${suffix}`, idempotencyKey: randomUUID() }, 429)
  } finally {
    await owner.query('update private.student_enrollment_limits set attempt_count=0 where staff_user_id=$1', [adminSession.user_id])
  }
  if (base) {
    const anonymousPage = await fetch(`${base}/students`, { redirect: 'manual' })
    assert.equal(anonymousPage.status, 307)
  }
  console.log('PASS: enrollment authorization, validation, atomic rollback, duplication, idempotency, zero wallet, audit, student store use and protected card replacement')
}
