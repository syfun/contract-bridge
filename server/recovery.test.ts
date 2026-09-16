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
  const dir = mkdtempSync(join(tmpdir(), 'bridge-recovery-'))
  const path = join(dir, 'room.sqlite')
  let now = 100_000
  const deck = suits.flatMap((s) => ranks.map((r) => `${s}${r}` as Card))
  let service = new GameService(path, { deck: () => deck, now: () => now })
  t.after(() => { service.close(); rmSync(dir, { recursive: true, force: true }) })
  const identities = seats.map(() => service.issueIdentity())
  const code = accepted(service.execute({ kind: 'create', credential: identities[0], nickname: '房主', operationId: 'create' })).code
  const read = (i = 0) => accepted(service.read(code, identities[i]))
  let n = 0
  const command = (i: number, action: object) => ({ code, credential: identities[i], expectedVersion: read().version, operationId: `op-${n++}`, ...action })
  const send = (i: number, action: object) => service.execute(command(i, action))
  for (let i = 0; i < humans; i++) {
    if (i) accepted(send(i, { kind: 'join', nickname: seats[i] }))
    accepted(send(i, { kind: 'seat', seat: seats[i] }))
    accepted(service.connect(code, identities[i], `socket-${i}`))
  }
  accepted(send(0, { kind: 'start' }))
  return { path, code, identities, read, send, command,
    get service() { return service },
    at(time: number) { now = time; return service.tick() },
    restart() { service.close(); service = new GameService(path, { deck: () => deck, now: () => now }) },
  }
}

test('单机最后连接断开立即暂停，作废电脑结果，重连后须房主确认', async (t) => {
  const { suggestAuction } = await import('./computer/auction-strategy.ts')
  const room = table(t, 1)
  accepted(room.send(0, { kind: 'call', call: { kind: 'pass' } }))
  const turn = room.service.computerTurn(room.code)!
  const decision = suggestAuction(turn.input)!
  const before = room.read().board
  accepted(room.service.disconnect('socket-0')!)
  assert.deepEqual(room.read().pause, { reason: 'all-offline' })
  assert.equal(room.service.computerTurn(room.code), null)
  assert.equal(room.service.submitComputerCall(turn, decision).status, 'stale_state')
  room.at(130_000)
  assert.deepEqual(room.read().board!.auction, before!.auction)
  assert.equal(room.service.computerTurn(room.code), null)
  accepted(room.service.connect(room.code, room.identities[0], 'returned'))
  assert.deepEqual(room.read().pause, { reason: 'all-offline' })
  accepted(room.send(0, { kind: 'resume' }))
  assert.ok(room.service.computerTurn(room.code))
})

test('房主满30秒转给加入最早的在线真人，回归不抢回，转交不自动恢复', (t) => {
  const room = table(t)
  accepted(room.send(0, { kind: 'pause' }))
  accepted(room.service.disconnect('socket-1')!)
  accepted(room.service.disconnect('socket-0')!)
  room.at(129_999)
  assert.equal(room.read().hostId, room.read(0).selfId)
  room.at(130_000)
  assert.equal(room.read().hostId, room.read(2).selfId)
  assert.deepEqual(room.read().pause, { reason: 'host' })
  accepted(room.service.connect(room.code, room.identities[0], 'old-host'))
  assert.equal(room.send(0, { kind: 'resume' }).status, 'unauthorized')
  accepted(room.send(2, { kind: 'resume' }))
})

test('全员离线到期不自动开新副，首位重连真人接任房主并确认恢复', (t) => {
  const room = table(t)
  for (let i = 0; i < 4; i++) accepted(room.send(i, { kind: 'call', call: { kind: 'pass' } }))
  accepted(room.send(0, { kind: 'ready' }))
  for (let i = 0; i < 4; i++) accepted(room.service.disconnect(`socket-${i}`)!)
  room.at(130_000)
  assert.equal(room.read().board!.number, 1)
  assert.deepEqual(room.read().pause, { reason: 'all-offline' })
  accepted(room.service.connect(room.code, room.identities[2], 'returned-south'))
  assert.equal(room.read().hostId, room.read(2).selfId)
  assert.deepEqual(room.read().pause, { reason: 'all-offline' })
  assert.equal(room.send(0, { kind: 'resume' }).status, 'unauthorized')
  accepted(room.send(2, { kind: 'resume' }))
  assert.equal(room.read().board!.number, 1)
  accepted(room.send(2, { kind: 'ready' }))
  assert.equal(room.read().board!.number, 2)
})

test('叫牌中重启保留已确认动作与去重，标记未连接并保持暂停，恢复快照隔离暗牌', (t) => {
  const room = table(t)
  const call = room.command(0, { kind: 'call', call: { kind: 'pass' } })
  const confirmed = room.service.execute(call)
  accepted(confirmed)
  const before = room.read()
  accepted(room.service.disconnect('socket-2')!)
  room.at(110_000)
  room.restart()
  const restored = room.read()
  assert.deepEqual(restored.pause, { reason: 'restart' })
  assert.deepEqual(restored.board!.auction, before.board!.auction)
  assert.deepEqual(restored.hand, before.hand)
  assert.equal(restored.selfId, before.selfId)
  assert.equal(restored.members[0].connection.deadline, 140_000)
  assert.equal(restored.members[2].connection.deadline, 130_000)
  assert.equal(room.service.computerTurn(room.code), null)
  const retry = room.service.execute(call)
  assert.equal(retry.status, 'accepted')
  if (retry.status === 'accepted' && confirmed.status === 'accepted')
    assert.equal(retry.appliedVersion, confirmed.appliedVersion)
  assert.deepEqual(room.read(), restored)
  assert.equal(room.service.read(room.code, room.service.issueIdentity()).status, 'unauthorized')
  for (let i = 0; i < 4; i++) {
    const view = room.read(i)
    assert.equal(view.hand.length, 13)
    assert.equal(view.board!.reviewHands, null)
    assert.equal('hands' in view.board!, false)
    assert.equal('offline' in view, false)
    assert.deepEqual(view.board!.legalCalls, [])
    if (i) assert.notDeepEqual(view.hand, restored.hand)
    accepted(room.service.connect(room.code, room.identities[i], `returned-${i}`))
  }
  assert.equal(room.send(1, { kind: 'resume' }).status, 'unauthorized')
  accepted(room.send(0, { kind: 'resume' }))
  accepted(room.send(1, { kind: 'call', call: { kind: 'pass' } }))
  assert.equal(room.read().board!.auction.length, 2)
})

test('全员离线保存失败时拦截电脑，重连前未保存的暂停仍必须补存', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const { suggestAuction } = await import('./computer/auction-strategy.ts')
  const room = table(t, 1)
  accepted(room.send(0, { kind: 'call', call: { kind: 'pass' } }))
  const turn = room.service.computerTurn(room.code)!
  const decision = suggestAuction(turn.input)!
  const db = new DatabaseSync(room.path)
  t.after(() => db.close())
  db.exec("CREATE TRIGGER fail_save BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'failure'); END")
  const before = room.read()
  assert.equal(room.service.disconnect('socket-0')!.status, 'storage_failure')
  assert.deepEqual(room.read(), before)
  assert.equal(room.service.computerTurn(room.code), null)
  db.exec('DROP TRIGGER fail_save')
  assert.equal(room.service.submitComputerCall(turn, decision).status, 'paused')
  accepted(room.service.connect(room.code, room.identities[0], 'returned'))
  assert.deepEqual(room.read().pause, { reason: 'all-offline' })
  assert.deepEqual(room.read().board!.auction, before.board!.auction)
  accepted(room.send(0, { kind: 'resume' }))
  assert.ok(room.service.computerTurn(room.code))
})

test('打牌和结算重启保留进度、准备及累计分，末张提交失败与确认丢失重试不重复计分', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const room = table(t)
  const reconnect = () => {
    for (let i = 0; i < 4; i++) accepted(room.service.connect(room.code, room.identities[i], `back-${i}`))
  }
  accepted(room.send(0, { kind: 'call', call: { kind: 'bid', level: 1, denomination: 'NT' } }))
  for (let i = 1; i < 4; i++) accepted(room.send(i, { kind: 'call', call: { kind: 'pass' } }))
  const next = () => {
    const turn = room.read().board!.turn!
    const i = turn === 'south' ? 0 : seats.indexOf(turn)
    return room.command(i, { kind: 'play', seat: turn, card: room.read(i).board!.legalCards[0] })
  }
  const lead = next()
  const confirmed = room.service.execute(lead)
  accepted(confirmed)
  const before = room.read()
  room.restart()
  assert.deepEqual(room.read().pause, { reason: 'restart' })
  assert.deepEqual(room.read().board!.currentTrick, before.board!.currentTrick)
  assert.deepEqual(room.read().board!.dummy, before.board!.dummy)
  reconnect()
  accepted(room.send(0, { kind: 'resume' }))
  assert.deepEqual(room.read().board, before.board)
  const retry = room.service.execute(lead)
  assert.equal(retry.status, 'accepted')
  if (retry.status === 'accepted' && confirmed.status === 'accepted') assert.equal(retry.appliedVersion, confirmed.appliedVersion)
  for (let n = 1; n < 51; n++) accepted(room.service.execute(next()))
  const last = next()
  const unscored = room.read()
  const db = new DatabaseSync(room.path)
  t.after(() => db.close())
  db.exec("CREATE TRIGGER fail_score BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'failure'); END")
  assert.equal(room.service.execute(last).status, 'storage_failure')
  assert.deepEqual(room.read(), unscored)
  db.exec('DROP TRIGGER fail_score')
  const final = room.service.execute(last)
  const scored = accepted(final)
  assert.equal(scored.board!.phase, 'scored')
  assert.notDeepEqual(scored.scores, { 'north-south': 0, 'east-west': 0 })
  accepted(room.send(1, { kind: 'ready' }))
  const ready = room.read()
  room.restart()
  assert.deepEqual(room.read().pause, { reason: 'restart' })
  assert.deepEqual(room.read().scores, scored.scores)
  assert.deepEqual(room.read().board, ready.board)
  const repeated = room.service.execute(last)
  assert.equal(repeated.status, 'accepted')
  if (repeated.status === 'accepted' && final.status === 'accepted') assert.equal(repeated.appliedVersion, final.appliedVersion)
  assert.deepEqual(room.read().scores, scored.scores)
  assert.equal(room.read().board!.number, 1)
  reconnect()
  accepted(room.send(0, { kind: 'resume' }))
  for (const i of [0, 2, 3]) accepted(room.send(i, { kind: 'ready' }))
  assert.equal(room.read().board!.number, 2)
  assert.deepEqual(room.read().scores, scored.scores)
})

test('启动恢复事务失败时拒绝启动，修复存储后重试不丢失已确认叫牌', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const room = table(t)
  accepted(room.send(0, { kind: 'call', call: { kind: 'pass' } }))
  const before = room.read()
  const db = new DatabaseSync(room.path)
  t.after(() => db.close())
  db.exec("CREATE TRIGGER fail_startup BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'failure'); END")
  assert.throws(() => new GameService(room.path), /failure/)
  assert.deepEqual(room.read(), before)
  db.exec('DROP TRIGGER fail_startup')
  room.restart()
  assert.deepEqual(room.read().board!.auction, before.board!.auction)
  assert.deepEqual(room.read().pause, { reason: 'restart' })
})
