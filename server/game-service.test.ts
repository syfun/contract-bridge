import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GameService } from './game-service.ts'

test('建房后凭持久身份读取房主和加入顺序，重启后恢复', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-'))
  const path = join(dir, 'game.sqlite')
  let service = new GameService(path)
  try {
    const credential = service.issueIdentity()
    const result = service.execute({
      kind: 'create',
      credential,
      nickname: '小南',
      operationId: 'create-1',
    })
    assert.equal(result.status, 'accepted')
    if (result.status !== 'accepted') throw Error('建房失败')
    assert.equal(result.state.version, 1)
    assert.equal(result.state.members[0].nickname, '小南')
    assert.equal(result.state.hostId, result.state.selfId)
    assert.equal(result.state.members[0].joinedOrder, 1)
    service.close()
    service = new GameService(path)
    assert.deepEqual(service.read(result.state.code, credential), {
      status: 'accepted',
      state: result.state,
    })
  } finally {
    service.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

function fixture(t: import('node:test').TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-'))
  const service = new GameService(join(dir, 'game.sqlite'))
  t.after(() => {
    service.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const credential = service.issueIdentity()
  const created = service.execute({
    kind: 'create',
    credential,
    nickname: '房主',
    operationId: 'create',
  })
  if (created.status !== 'accepted') throw Error('建房失败')
  return { service, credential, code: created.state.code }
}

test('入房拒绝重复昵称，选座校验归属、版本与操作去重', (t) => {
  const { service, credential, code } = fixture(t)
  const guest = service.issueIdentity()
  assert.equal(
    service.execute({
      kind: 'join',
      expectedVersion: 1,
      credential: guest,
      code,
      nickname: '房主',
      operationId: 'join',
    }).status,
    'duplicate_nickname',
  )
  const joined = service.execute({
    kind: 'join',
    expectedVersion: 1,
    credential: guest,
    code,
    nickname: '小东',
    operationId: 'join',
  })
  assert.equal(joined.status, 'accepted')
  const choose = {
    kind: 'seat',
    credential: guest,
    code,
    expectedVersion: 2,
    seat: 'east',
    operationId: 'seat',
  } as const
  const seated = service.execute(choose)
  assert.equal(seated.status, 'accepted')
  assert.deepEqual(service.execute(choose), seated)
  assert.equal(
    service.execute({ ...choose, seat: 'north' }).status,
    'operation_conflict',
  )
  assert.equal(
    service.execute({ ...choose, credential, operationId: 'old' }).status,
    'stale_state',
  )
  assert.equal(
    service.execute({ ...choose, credential, expectedVersion: 3 }).status,
    'seat_taken',
  )
  const state = service.read(code, guest)
  assert.equal(state.status, 'accepted')
  if (state.status === 'accepted') {
    assert.equal(state.state.version, 3)
    assert.equal(state.state.members[1].joinedOrder, 2)
    assert.equal(state.state.members[1].seat, 'east')
    assert.equal(state.state.members[0].seat, null)
    assert.equal(state.state.hostId, state.state.members[0].id)
  }
})

test('房间隔离，昵称与连接标识都不能冒用持久身份', (t) => {
  const { service, credential, code } = fixture(t)
  const other = service.issueIdentity()
  const second = service.execute({
    kind: 'create',
    credential: other,
    nickname: '房主',
    operationId: 'create',
  })
  assert.equal(second.status, 'accepted')
  assert.equal(service.read(code, other).status, 'unauthorized')
  for (const impostor of ['房主', 'socket-id', other]) {
    assert.equal(
      service.execute({
        kind: 'seat',
        credential: impostor,
        code,
        expectedVersion: 1,
        seat: 'south',
        operationId: 'hack',
      }).status,
      'unauthorized',
    )
  }
  assert.equal(
    service.execute({
      kind: 'join',
      expectedVersion: 1,
      credential: service.issueIdentity(),
      code: 'ZZZZZZ',
      nickname: '客人',
      operationId: 'missing',
    }).status,
    'room_not_found',
  )
  const state = service.read(code, credential)
  assert.equal(state.status, 'accepted')
  assert.ok(!JSON.stringify(state).includes(credential))
  assert.ok(!JSON.stringify(state).includes(other))
})

test('SQLite 无法提交时拒绝确认，解除写锁后同一操作只生效一次', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const dir = mkdtempSync(join(tmpdir(), 'bridge-lock-'))
  const path = join(dir, 'game.sqlite')
  const service = new GameService(path)
  const lock = new DatabaseSync(path)
  t.after(() => {
    lock.close()
    service.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const credential = service.issueIdentity()
  const command = {
    kind: 'create',
    credential,
    nickname: '小北',
    operationId: 'retry',
  } as const
  lock.exec('BEGIN IMMEDIATE')
  assert.equal(service.execute(command).status, 'storage_failure')
  lock.exec('ROLLBACK')
  const result = service.execute(command)
  assert.equal(result.status, 'accepted')
  assert.deepEqual(service.execute(command), result)
  if (result.status === 'accepted') assert.equal(result.state.version, 1)
})

test('入房前只读取加入版本，过期入房不改变房间', (t) => {
  const { service, code, credential } = fixture(t)
  const guest = service.issueIdentity()
  assert.deepEqual(service.joinVersion(code, guest), {
    status: 'accepted',
    version: 1,
  })
  assert.equal(
    service.execute({
      kind: 'join',
      expectedVersion: 0,
      credential: guest,
      code,
      nickname: '客人',
      operationId: 'join',
    }).status,
    'stale_state',
  )
  assert.deepEqual(service.joinVersion(code, guest), {
    status: 'accepted',
    version: 1,
  })
  assert.equal(service.joinVersion(code, credential).status, 'unauthorized')
})
