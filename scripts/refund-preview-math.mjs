import assert from 'node:assert/strict'

// Independent integer oracle. Never uses floating point or the SQL algorithm's
// implementation source; only the explicitly versioned apportionment contract.
export function share(total, parts, before, take) {
  const [t, p, b, n] = [total, parts, before, take].map(BigInt)
  assert.ok(t >= 0n && p > 0n && b >= 0n && n >= 0n && b + n <= p)
  return t * (b + n) / p - t * b / p
}
export async function verifyPreviewMath(owner) {
  const cases = []
  for (const t of [0n, 1n, 2n, 17n, 1001n, 9007199254740991n, 9223372036854775807n]) {
    for (const p of [1n, 2n, 3n, 7n, 31n]) {
      let sum = 0n
      for (let b = 0n; b < p; b++) {
        cases.push({ total: String(t), parts: String(p), before: String(b), take: '1' })
        sum += share(t, p, b, 1n)
      }
      assert.equal(sum, t)
    }
    cases.push({ total: String(t), parts: '9223372036854775807', before: '9223372036854775805', take: '2' })
  }
  let seed = 104729n
  for (let k = 0; k < 1000; k++) {
    seed = (seed * 48271n) % 2147483647n
    const parts = seed % 999n + 1n, before = seed % parts, take = (seed / parts) % (parts - before + 1n)
    cases.push({ total: String(seed * 99999991n), parts: String(parts), before: String(before), take: String(take) })
  }
  await owner.query('begin read only')
  try {
    const result = await owner.query(`select x.ordinality,private.refund_proportional_slice(
      (x.value->>'total')::bigint,(x.value->>'parts')::bigint,(x.value->>'before')::bigint,(x.value->>'take')::bigint)::text amount
      from jsonb_array_elements($1::jsonb) with ordinality x order by x.ordinality`, [JSON.stringify(cases)])
    assert.equal(result.rows.length, cases.length)
    for (let k = 0; k < cases.length; k++) {
      const c = cases[k]; assert.equal(result.rows[k].amount, String(share(c.total, c.parts, c.before, c.take)))
    }
  } finally { await owner.query('rollback') }
  for (const args of [[null,1,0,1],[1,null,0,1],[1,1,null,1],[1,1,0,null],[-1,2,0,1],[1,0,0,0],[1,2,-1,1],[1,2,0,-1],[1,2,1,2],['9223372036854775807','9223372036854775807','9223372036854775807',1]]) {
    await assert.rejects(() => owner.query('select private.refund_proportional_slice($1,$2,$3,$4)', args), e => e.message === 'BAD_REQUEST')
  }
  return cases.length
}
