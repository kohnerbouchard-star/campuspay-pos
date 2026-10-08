import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import pg from 'pg'
import sharp from 'sharp'
import { photoOrigin, photoNamespace, photoReason } from './product-photo-context.mjs'

export async function verifyPhotoDatabase(ctx, admin, product, other, checks) {
  const { owner, read, upload, commit, cancel, http, rateReset, image } = ctx
  const cashier = await ctx.login('1001'), accountant = await ctx.login('3001'), manager = await ctx.login('2001'), second = await ctx.login('9101')
  await http(new Map(), product.id, 'GET', undefined, 401)
  for (const cookies of [cashier, accountant]) {
    for (const method of ['POST', 'PUT', 'DELETE']) await http(cookies, product.id, method, { requestId: randomUUID(), revision: 0, reason: photoReason }, 403)
    await http(cookies, null, 'POST', {}, 403)
  }
  await http(admin, product.id, 'DELETE', { requestId: randomUUID(), revision: 0, reason: photoReason }, 403, '', 'https://untrusted.invalid')
  await http(admin, product.id, 'PUT', { requestId: randomUUID(), url: 'https://untrusted.invalid/image' }, 400)
  await http(admin, null, 'POST', { path: 'unrelated/file.webp' }, 400)
  const initial = await read(manager, product.id); assert.equal(initial.photo, null); assert.equal(initial.revision, 0)
  checks.push('HTTP authentication, product capability, origin and strict payload guards; inventory manager authorized')

  for (const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from('not an image'), Buffer.from('GIF89a')]) await upload(manager, product.id, bytes, 0, randomUUID(), 400)
  await upload(manager, product.id, Buffer.alloc(4_000_001), 0, randomUUID(), 413)
  const pixelBomb = await sharp({ create: { width: 4500, height: 4500, channels: 3, background: '#ffffff' } }).png().toBuffer()
  await upload(manager, product.id, pixelBomb, 0, randomUUID(), 400)
  assert.equal((await owner.query('select count(*) n from private.product_photo_assets')).rows[0].n, '0')
  checks.push('Invalid, SVG, disguised, oversized and decoded-pixel-limit images publish no objects and reserve no assets')
  await rateReset()
  const first = await upload(manager, product.id, await image('jpeg'), 0)
  assert.equal(first.data.operation.state, 'READY'); assert.equal(first.data.photo, null)
  const asset = first.data.operation.photo
  for (const url of [asset.url, asset.thumbnail_url]) {
    const metadata = await sharp(await fs.readFile(ctx.fileFor(url))).metadata()
    assert.equal(metadata.format, 'webp'); assert.equal(metadata.exif, undefined); assert.equal(metadata.xmp, undefined); assert.equal(metadata.icc, undefined)
  }
  const saved = await commit(manager, product.id, first.requestId)
  assert.equal(saved.revision, 1); assert.equal(saved.photo.asset_id, asset.asset_id)
  assert.deepEqual(await commit(manager, product.id, first.requestId), saved)
  await http(second, product.id, 'GET', undefined, 403, `?requestId=${first.requestId}`)
  await http(manager, other.id, 'PUT', { requestId: first.requestId }, 403)
  assert.equal((await owner.query("select count(*) n from private.audit_events where reference_number=$1 and event_type='PRODUCT_PHOTO_SAVED'", [`PHOTO-${first.requestId}`])).rows[0].n, '1')
  checks.push('Actual JPEG decode/re-encode, separate stage/save, immutable replay audit and actor/product operation ownership')

  await rateReset()
  const replacement = await upload(manager, product.id, await image('webp', '#ad6c43'), 1)
  assert.equal(replacement.data.photo.asset_id, asset.asset_id)
  await owner.query("create function private.photo_test_save_fault() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_PHOTO_SAVE_FAILURE'; end$$; create trigger photo_test_save_fault before update on private.product_photo_states for each row execute function private.photo_test_save_fault()")
  try { await commit(manager, product.id, replacement.requestId, 500) } finally { await owner.query('drop trigger photo_test_save_fault on private.product_photo_states; drop function private.photo_test_save_fault()') }
  const recovered = await read(manager, product.id, replacement.requestId)
  assert.equal(recovered.photo.asset_id, asset.asset_id); assert.equal(recovered.operation.state, 'READY'); assert.equal(recovered.revision, 1)
  await fs.access(ctx.fileFor(asset.url)); assert.equal((await commit(manager, product.id, replacement.requestId)).revision, 2)
  checks.push('Injected DB save failure rolls back replacement atomically, retains old bytes/reference, and permits original-request recovery')

  await rateReset()
  const [left, right] = await Promise.all([upload(manager, product.id, await image('png', '#378052'), 2), upload(second, product.id, await image('png', '#af3a47'), 2)])
  const results = await Promise.all([commit(manager, product.id, left.requestId), commit(second, product.id, right.requestId)])
  assert.deepEqual(results.map(r => r.operation.state).sort(), ['CONFLICT', 'SAVED'])
  const winner = (await read(admin, product.id)).photo
  assert.equal((await read(admin, product.id)).revision, 3)
  assert.equal((await owner.query("select count(*) n from private.product_photo_assets where product_id=$1 and state='LIVE'", [product.id])).rows[0].n, '1')
  await fs.access(ctx.fileFor(winner.url))
  const stale = await upload(admin, product.id, await image(), 1)
  assert.equal(stale.data.operation.state, 'CONFLICT'); assert.equal(stale.data.photo.asset_id, winner.asset_id)
  checks.push('Simultaneous distinct-actor replacements and stale edits produce one winner; losing candidates never delete or relink it')

  await rateReset()
  const closedKey = randomUUID()
  assert.equal((await cancel(admin, product.id, closedKey)).operation.state, 'CANCELLED')
  const beforeAssets = (await owner.query('select count(*) n from private.product_photo_assets')).rows[0].n
  assert.equal((await upload(admin, product.id, await image(), 3, closedKey)).data.operation.state, 'CANCELLED')
  assert.equal((await owner.query('select count(*) n from private.product_photo_assets')).rows[0].n, beforeAssets)
  const duplicateKey = randomUUID(), bytes = await image()
  const simultaneous = await Promise.all([upload(admin, product.id, bytes, 3, duplicateKey), upload(admin, product.id, bytes, 3, duplicateKey)])
  assert.ok(simultaneous.every(r => ['UPLOADING', 'READY'].includes(r.data.operation.state)))
  assert.equal((await owner.query('select count(*) n from private.product_photo_assets a join private.product_photo_operations o on o.asset_id=a.id where o.request_id=$1', [duplicateKey])).rows[0].n, '1')
  await cancel(admin, product.id, duplicateKey)
  checks.push('Cancel-before-arrival tombstone rejects delayed upload; concurrent identical submissions reserve/store only one immutable asset')

  await rateReset()
  const productDirectory = ctx.fileFor(winner.url).split(`/${winner.asset_id}/`)[0], backupDirectory = `${productDirectory}-isolated-test-backup`
  await fs.rename(productDirectory, backupDirectory); await fs.writeFile(productDirectory, 'synthetic unavailable storage path', { flag: 'wx' })
  try { await upload(admin, product.id, await image(), 3, randomUUID(), 503) }
  finally { await fs.unlink(productDirectory); await fs.rename(backupDirectory, productDirectory) }
  assert.equal((await read(admin, product.id)).photo.asset_id, winner.asset_id); await fs.access(ctx.fileFor(winner.url))
  const pending = await upload(admin, product.id, await image(), 3)
  await owner.query("update private.product_photo_operations set expires_at=clock_timestamp()-interval '1 second' where request_id=$1", [pending.requestId])
  assert.equal((await commit(admin, product.id, pending.requestId)).operation.state, 'CANCELLED')
  checks.push('Interrupted storage and expired staging preserve the current image, and durable reservations remain cleanup-visible')

  await rateReset()
  assert.deepEqual(await http(admin, null, 'POST', {}), { claimed: 0, deleted: 0, deferred: 0 })
  // Age only synthetic retired/pending test assets; never age the LIVE winner.
  await owner.query("update private.product_photo_assets set eligible_at=clock_timestamp()-interval '25 hours' where state<>'LIVE'")
  const session = (await owner.query("select ss.id from private.staff_sessions ss join public.staff_profiles p on p.auth_user_id=ss.auth_user_id where p.employee_code='9001' order by ss.created_at desc limit 1")).rows[0].id
  const nativeCleanup = (assetId = null, token = null, namespace = photoNamespace) => owner.query('select result from api.product_photo_cleanup($1,$2,$3,$4,$5)', [session, namespace, photoOrigin, assetId, token])
  const claimed = (await nativeCleanup()).rows[0].result.objects
  assert.equal(claimed.length, 5); assert.ok(claimed.every(o => o.asset_id !== winner.asset_id))
  const firstClaim = claimed[0]
  await assert.rejects(nativeCleanup(firstClaim.asset_id, randomUUID()), /CONFLICT/)
  await assert.rejects(nativeCleanup(firstClaim.asset_id, firstClaim.token, 'test/another-store'), /CONFLICT/)
  await owner.query("update private.product_photo_assets set lease_until=clock_timestamp()-interval '1 second' where id=any($1::uuid[])", [claimed.map(o => o.asset_id)])
  const reclaimed = (await nativeCleanup()).rows[0].result.objects
  assert.equal(reclaimed.length, 5); assert.ok(reclaimed.some(o => o.asset_id === firstClaim.asset_id && o.token !== firstClaim.token))
  await assert.rejects(nativeCleanup(firstClaim.asset_id, firstClaim.token), /CONFLICT/)
  await owner.query("update private.product_photo_assets set lease_until=clock_timestamp()-interval '1 second' where state='DELETING'")
  const cleaned = await http(admin, null, 'POST', {})
  assert.equal(cleaned.claimed, 5); assert.equal(cleaned.deleted, 5); assert.equal(cleaned.deferred, 0)
  await fs.access(ctx.fileFor(winner.url)); assert.equal((await read(admin, product.id)).photo.asset_id, winner.asset_id)
  for (const row of (await owner.query("select id, product_id from private.product_photo_assets where state='DELETED'")).rows) await assert.rejects(fs.access(`${ctx.directory}/campuspay-products/${photoNamespace}/${row.product_id}/${row.id}/display.webp`), { code: 'ENOENT' })
  checks.push('Cleanup observes grace, claims at most five, fences expired leases/stale acknowledgments, and never deletes the referenced winner')

  await rateReset()
  const removalKey = randomUUID(), removalBody = { requestId: removalKey, revision: 3, reason: photoReason }
  const removed = await http(admin, product.id, 'DELETE', removalBody)
  assert.equal(removed.photo, null); assert.equal(removed.revision, 4)
  assert.deepEqual(await http(admin, product.id, 'DELETE', removalBody), removed)
  await fs.access(ctx.fileFor(winner.url))
  assert.equal((await commit(manager, product.id, first.requestId)).photo, null)
  assert.equal((await owner.query("select count(*) n from private.audit_events where reference_number=$1 and event_type='PRODUCT_PHOTO_REMOVED'", [`PHOTO-${removalKey}`])).rows[0].n, '1')
  checks.push('Removal clears only the primary photo; replay is once-only and a historical successful upload cannot resurrect a retired image')

  await rateReset()
  for (let i = 0; i < 12; i++) await upload(admin, product.id, Buffer.from('invalid synthetic payload'), 4, randomUUID(), 400)
  await upload(admin, product.id, await image(), 4, randomUUID(), 429)
  await rateReset()
  const runtime = new pg.Client({ connectionString: ctx.runtimeUrl }); await runtime.connect()
  try {
    for (const table of ['product_photo_assets', 'product_photo_states', 'product_photo_operations', 'product_photo_rate_limits']) await assert.rejects(runtime.query(`select * from private.${table}`), /permission denied/)
    await assert.rejects(runtime.query('select private.product_photo_descriptor($1)', [winner.asset_id]), /permission denied/)
    const cashierSession = (await owner.query("select ss.id from private.staff_sessions ss join public.staff_profiles p on p.auth_user_id=ss.auth_user_id where p.employee_code='1001' order by ss.created_at desc limit 1")).rows[0].id
    await assert.rejects(runtime.query("select * from api.product_photo_command($1,$2,$3,'CANCEL','{}')", [cashierSession, product.id, randomUUID()]), /FORBIDDEN/)
    assert.equal((await runtime.query("select result from api.product_photo_command($1,$2,null,'READ','{}')", [session, product.id])).rows[0].result.revision, 4)
  } finally { await runtime.end() }
  checks.push('Persistent pre-decode rate limit is enforced; runtime has execute-only API access and SQL independently rejects missing capabilities')
}

export async function verifyPhotoMigration(ctx, checks) {
  const { owner } = ctx, migration = await fs.readFile('database/migrations/20261008090000_product_photos.sql', 'utf8')
  assert.equal(migration, await fs.readFile('database/schema/051_product_photos.sql', 'utf8'))
  const ownerName = (await owner.query('select current_user name')).rows[0].name
  const quote = value => '"' + value.replaceAll('"', '""') + '"'
  for (const privilege of ['TABLES', 'FUNCTIONS']) {
    await owner.query('begin')
    try {
      await owner.query('create role photo_unexpected_default_grantee')
      await owner.query('drop function api.product_photo_command(uuid,uuid,uuid,text,jsonb),api.product_photo_catalog(uuid,uuid,uuid[]),api.product_photo_cleanup(uuid,text,text,uuid,uuid),private.product_photo_descriptor(uuid),private.product_photo_snapshot(uuid,uuid),private.product_photo_rate(uuid); drop table private.product_photo_states,private.product_photo_operations,private.product_photo_assets,private.product_photo_rate_limits')
      await owner.query(`alter default privileges for role ${quote(ownerName)} in schema ${privilege === 'TABLES' ? 'private' : 'api'} grant all on ${privilege} to photo_unexpected_default_grantee`)
      await assert.rejects(owner.query(migration), /PRODUCT_PHOTO_(TABLE|FUNCTION)_ACL_PRECONDITION/)
    } finally { await owner.query('rollback') }
  }
  await owner.query('begin')
  try {
    await owner.query('create role photo_wrong_owner; alter table public.products owner to photo_wrong_owner')
    await assert.rejects(owner.query(migration), /PRODUCT_PHOTO_OWNER_PRECONDITION/)
  } finally { await owner.query('rollback') }
  const attributes = (await owner.query("select n.nspname,p.proname,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like 'product_photo_%' order by n.nspname,p.proname")).rows
  assert.equal(attributes.length, 6)
  for (const row of attributes) { assert.equal(row.owner, ownerName); assert.equal(row.prosecdef, row.nspname === 'api'); assert.deepEqual(row.proconfig, ['search_path=""']) }
  checks.push('Exact additive schema/migration pair; native owner/default-ACL negative rehearsals roll back and all six API/private function attributes match')
}
