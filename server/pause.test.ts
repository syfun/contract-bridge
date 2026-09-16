import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GameService } from './game-service.ts'
import { seats, suits, ranks } from '../shared/protocol.ts'
import type { Card, Result } from '../shared/protocol.ts'

function accepted(result: Result) {
  if (result.status !== 'accepted') assert.fail(result.message)
  return result.state
}
function table(t: TestContext, humans = 4) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-pause-'))
  const path = join(dir, 'room.sqlite')
  const deck = suits.flatMap((s) => ranks.map((r) => `${s}${r}` as Card))
  let service = new GameService(path, { deck: () => deck })
  t.after(() => {
    service.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const identities = seats.map(() => service.issueIdentity())
  const code = accepted(service.execute({ kind: 'create', credential: identities[0], nickname: '房主', operationId: 'create' })).code
  const read = (i = 0) => accepted(service.read(code, identities[i]))
  let sequence = 0
  const command = (i: number, action: object) => ({ credential: identities[i], code, expectedVersion: read().version, operationId: `op-${sequence++}`, ...action })
  const send = (i: number, action: object) => service.execute(command(i, action))
  for (let i = 0; i < humans; i++) {
    if (i) accepted(send(i, { kind: 'join', nickname: seats[i] }))
    accepted(send(i, { kind: 'seat', seat: seats[i] }))
  }
  accepted(send(0, { kind: 'start' }))
  return { path, code, read, send, command, get service() { return service }, restart() { service.close(); service = new GameService(path, { deck: () => deck }) } }
}

test('仅房主可暂停恢复，暂停原因跨读取和重启保留且原轮次继续', (t) => {
  const room = table(t)
  const before = room.read()
  assert.equal(room.send(1, { kind: 'pause' }).status, 'unauthorized')
  assert.deepEqual(room.read(), before)
  accepted(room.send(0, { kind: 'pause' }))
  assert.deepEqual(room.read().pause, { reason: 'host' })
  assert.deepEqual(room.read(1).pause, { reason: 'host' })
  assert.deepEqual(room.read().board, before.board)
  assert.equal(room.send(0, { kind: 'call', call: { kind: 'pass' } }).status, 'paused')
  assert.equal(room.send(1, { kind: 'resume' }).status, 'unauthorized')
  room.restart()
  assert.deepEqual(room.read().pause, { reason: 'host' })
  accepted(room.send(0, { kind: 'resume' }))
  assert.equal(room.read().pause, null)
  assert.deepEqual(room.read().board, before.board)
  accepted(room.send(0, { kind: 'call', call: { kind: 'pass' } }))
  assert.equal(room.read().board!.turn, 'east')
})

test('暂停期间不派发电脑叫牌，异步旧结果在暂停及恢复后均不能推进', async (t) => {
  const { suggestAuction } = await import('./computer/auction-strategy.ts')
  const room = table(t, 1)
  accepted(room.send(0, { kind: 'call', call: { kind: 'pass' } }))
  const turn = room.service.computerTurn(room.code)!
  const decision = suggestAuction(turn.input)!
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve }).then(() => room.service.submitComputerCall(turn, decision))
  accepted(room.send(0, { kind: 'pause' }))
  const paused = room.read()
  assert.equal(room.service.computerTurn(room.code), null)
  release()
  assert.equal((await pending).status, 'stale_state')
  assert.deepEqual(room.read(), paused)
  accepted(room.send(0, { kind: 'resume' }))
  assert.equal(room.service.submitComputerCall(turn, decision).status, 'stale_state')
  const fresh = room.service.computerTurn(room.code)!
  accepted(room.service.submitComputerCall(fresh, suggestAuction(fresh.input)!))
  assert.equal(room.read().board!.auction.length, 2)
})

test('暂停期间不派发电脑出牌，异步旧出牌不能执行而恢复后的新结果可执行', async (t) => {
  const { suggestPlay } = await import('./computer/play-strategy.ts')
  const { conventionVersion } = await import('../shared/conventions.ts')
  const room = table(t, 1)
  accepted(room.send(0, { kind: 'call', call: { kind: 'bid', level: 1, denomination: 'NT' } }))
  for (let i = 0; i < 3; i++) {
    const turn = room.service.computerTurn(room.code)!
    accepted(room.service.submitComputerCall(turn, { version: turn.input.version, conventionVersion, call: { kind: 'pass' }, rule: 'C07', reason: '模拟异步电脑不叫' }))
  }
  const turn = room.service.computerPlayTurn(room.code)!
  const decision = suggestPlay(turn.input)!
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve }).then(() => room.service.submitComputerPlay(turn, decision))
  accepted(room.send(0, { kind: 'pause' }))
  assert.equal(room.service.computerPlayTurn(room.code), null)
  const paused = room.read()
  release()
  assert.equal((await pending).status, 'stale_state')
  assert.deepEqual(room.read(), paused)
  accepted(room.send(0, { kind: 'resume' }))
  assert.equal(room.service.submitComputerPlay(turn, decision).status, 'stale_state')
  const fresh = room.service.computerPlayTurn(room.code)!
  accepted(room.service.submitComputerPlay(fresh, suggestPlay(fresh.input)!))
  assert.equal(room.read().board!.currentTrick.length, 1)
})

test('暂停拦截真人出牌，恢复后从原首攻继续', (t) => {
  const room = table(t)
  accepted(room.send(0, { kind: 'call', call: { kind: 'bid', level: 1, denomination: 'NT' } }))
  for (let i = 1; i < 4; i++) accepted(room.send(i, { kind: 'call', call: { kind: 'pass' } }))
  const play = { kind: 'play', seat: 'east', card: room.read(1).board!.legalCards[0] }
  accepted(room.send(0, { kind: 'pause' }))
  const paused = room.read(1)
  assert.equal(room.send(1, play).status, 'paused')
  assert.deepEqual(room.read(1), paused)
  accepted(room.send(0, { kind: 'resume' }))
  accepted(room.send(1, play))
  assert.equal(room.read().board!.currentTrick.length, 1)
})

test('暂停拦截最后准备，保留已准备座位及分数，恢复后仅开一副', (t) => {
  const room = table(t)
  for (let i = 0; i < 4; i++) accepted(room.send(i, { kind: 'call', call: { kind: 'pass' } }))
  for (let i = 0; i < 3; i++) accepted(room.send(i, { kind: 'ready' }))
  accepted(room.send(0, { kind: 'pause' }))
  const paused = room.read()
  assert.equal(room.send(3, { kind: 'ready' }).status, 'paused')
  assert.deepEqual(room.read(), paused)
  room.restart()
  assert.deepEqual(room.read(), paused)
  accepted(room.send(0, { kind: 'resume' }))
  const ready = room.command(3, { kind: 'ready' })
  accepted(room.service.execute(ready))
  accepted(room.service.execute(ready))
  assert.equal(room.read().board!.number, 2)
  assert.equal(room.read().pause, null)
  assert.deepEqual(room.read().scores, paused.scores)
})

test('暂停恢复持久化失败不改变状态，同版本竞态及确认丢失重试只提交一次', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const room = table(t)
  const db = new DatabaseSync(room.path)
  t.after(() => db.close())
  for (const kind of ['pause', 'resume']) {
    const command = room.command(0, { kind })
    const before = room.read()
    db.exec("CREATE TRIGGER fail_pause BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'failure'); END")
    assert.equal(room.service.execute(command).status, 'storage_failure')
    assert.deepEqual(room.read(), before)
    db.exec('DROP TRIGGER fail_pause')
    const results = await Promise.all([
      Promise.resolve().then(() => room.service.execute(command)),
      Promise.resolve().then(() => room.service.execute(command)),
      Promise.resolve().then(() => room.service.execute({ ...command, operationId: `racing-${kind}` })),
    ])
    assert.equal(results[0].status, 'accepted')
    assert.deepEqual(results[1], results[0])
    assert.equal(results[2].status, 'stale_state')
    assert.equal(room.read().version, before.version + 1)
    room.restart()
    assert.deepEqual(room.service.execute(command), results[0])
    assert.equal(room.service.execute({ ...command, kind: kind === 'pause' ? 'resume' : 'pause' }).status, 'operation_conflict')
    assert.equal(room.send(0, { kind }).status, 'illegal_action')
  }
})
