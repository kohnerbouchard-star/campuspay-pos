import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { writeBackupAtomically } from './lib/atomic-backup-file.mjs'

function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campuspay-atomic-'))
  try { return run(directory, path.join(directory, 'daily.cpbackup'), randomBytes(2048)) }
  finally { fs.rmSync(directory, { recursive: true, force: true }) }
}
const diskError = () => Object.assign(new Error('Simulated disk failure'), { code: 'ENOSPC' })

test('publishes complete private bytes atomically and removes the temporary name', () => fixture((directory, output, bytes) => {
  let sawPublication = false
  writeBackupAtomically(output, bytes, {
    ...fs,
    linkSync(temporary, destination) {
      assert.equal(fs.existsSync(destination), false)
      assert.deepEqual(fs.readFileSync(temporary), bytes)
      assert.equal(fs.statSync(temporary).mode & 0o777, 0o600)
      assert.equal(fs.statSync(temporary).nlink, 1)
      sawPublication = true
      fs.linkSync(temporary, destination)
    },
  })
  assert.equal(sawPublication, true)
  assert.deepEqual(fs.readFileSync(output), bytes)
  assert.equal(fs.statSync(output).mode & 0o777, 0o600)
  assert.equal(fs.statSync(output).nlink, 1)
  assert.deepEqual(fs.readdirSync(directory), ['daily.cpbackup'])
}))

test('an existing backup is never overwritten', () => fixture((directory, output, bytes) => {
  const original = Buffer.from('previous accepted archive')
  fs.writeFileSync(output, original)
  assert.throws(() => writeBackupAtomically(output, bytes), { code: 'EEXIST' })
  assert.deepEqual(fs.readFileSync(output), original)
  assert.deepEqual(fs.readdirSync(directory), ['daily.cpbackup'])
}))

test('a partial write or failed data flush never publishes a final path', () => fixture((directory, output, bytes) => {
  for (const io of [
    { ...fs, writeFileSync(fd, data) { fs.writeSync(fd, data.subarray(0, 37)); throw diskError() } },
    { ...fs, fsyncSync() { throw diskError() } },
    { ...fs, linkSync() { throw diskError() } },
  ]) {
    assert.throws(() => writeBackupAtomically(output, bytes, io), { code: 'ENOSPC' })
    assert.equal(fs.existsSync(output), false)
    assert.deepEqual(fs.readdirSync(directory), [])
  }
}))

test('a directory-flush failure leaves complete bytes, never a partial archive', () => fixture((directory, output, bytes) => {
  let syncs = 0
  assert.throws(() => writeBackupAtomically(output, bytes, {
    ...fs,
    fsyncSync(fd) { if (++syncs === 2) throw diskError(); fs.fsyncSync(fd) },
  }), { code: 'ENOSPC' })
  assert.deepEqual(fs.readFileSync(output), bytes)
  assert.deepEqual(fs.readdirSync(directory), ['daily.cpbackup'])
}))
