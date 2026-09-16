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
function table(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-disconnect-'))
  const path = join(dir, 'room.sqlite')
  let now = 100_000
  const deck = suits.flatMap((s) => ranks.map((r) => `${s}${r}` as Card))
  let service = new GameService(path, { deck: () => deck, now: () => now })
  t.after(() => { service.close(); rmSync(dir, { recursive: true, force: true }) })
  const identities = seats.map(() => service.issueIdentity())
  const code = accepted(service.execute({ kind: 'create', credential: identities[0], nickname: '房主', operationId: 'create' })).code
  const read = (i = 0) => accepted(service.read(code, identities[i]))
  let n = 0
  const send = (i: number, action: object) => service.execute({ code, credential: identities[i], expectedVersion: read().version, operationId: `op-${n++}`, ...action })
  for (let i = 0; i < 4; i++) {
    if (i) accepted(send(i, { kind: 'join', nickname: seats[i] }))
    accepted(send(i, { kind: 'seat', seat: seats[i] }))
    accepted(service.connect(code, identities[i], `socket-${i}`))
  }
  accepted(send(0, { kind: 'start' }))
  return { path, code, identities, read, send,
    get service() { return service },
    at(time: number) { now = time; return service.tick() },
    restart() { service.close(); service = new GameService(path, { deck: () => deck, now: () => now }) },
  }
}

test('掉线等待满30秒才接管，其他真人可继续，保留座位与本人手牌', (t) => {
  const room = table(t)
  const before = room.read(1)
  accepted(room.service.disconnect('socket-1')!)
  assert.deepEqual(room.read().members[1].connection, { status: 'waiting', deadline: 130_000 })
  accepted(room.send(0, { kind: 'call', call: { kind: 'pass' } }))
  assert.equal(room.read().board!.turn, 'east')
  assert.equal(room.service.computerTurn(room.code), null)
  assert.equal(room.send(1, { kind: 'call', call: { kind: 'pass' } }).status, 'unauthorized')
  room.at(129_999)
  assert.equal(room.read().board!.seats.east.controller, 'human')
  assert.deepEqual(room.at(130_000), [room.code])
  const after = room.read(1)
  assert.deepEqual(after.members[1].connection, { status: 'taken-over', deadline: 130_000 })
  assert.equal(after.board!.seats.east.controller, 'computer')
  assert.equal(after.board!.seats.east.memberId, before.selfId)
  assert.deepEqual(after.hand, before.hand)
  assert.deepEqual(after.board!.legalCalls, [])
  assert.ok(room.service.computerTurn(room.code))
  const version = after.version
  room.at(140_000)
  assert.equal(room.read().version, version)
})

test('接管座位在结算后自动准备，跨副保留归属，重连取消接管并不能被抢占', (t) => {
  const room = table(t)
  for (let i = 0; i < 4; i++) accepted(room.send(i, { kind: 'call', call: { kind: 'pass' } }))
  for (const i of [0, 2, 3]) accepted(room.send(i, { kind: 'ready' }))
  const owner = room.read(1).selfId
  accepted(room.service.disconnect('socket-1')!)
  room.at(130_000)
  assert.equal(room.read().board!.number, 2)
  assert.equal(room.read().board!.seats.east.memberId, owner)
  assert.equal(room.read().board!.seats.east.controller, 'computer')
  assert.equal(room.send(2, { kind: 'seat', seat: 'east' }).status, 'illegal_action')
  accepted(room.service.connect(room.code, room.identities[1], 'returned-east'))
  assert.deepEqual(room.read(1).members[1].connection, { status: 'online', deadline: null })
  assert.equal(room.read().board!.seats.east.controller, 'human')
  assert.equal(room.service.computerTurn(room.code), null)
  accepted(room.send(1, { kind: 'call', call: { kind: 'pass' } }))
  assert.equal(room.read().board!.turn, 'south')
})

test('同一身份多连接只在最后断开时计时，短暂重连撤销等待且再次掉线重新计时', (t) => {
  const room = table(t)
  const version = room.read().version
  accepted(room.service.connect(room.code, room.identities[1], 'east-extra'))
  accepted(room.service.disconnect('socket-1')!)
  assert.equal(room.read().version, version)
  assert.equal(room.read().members[1].connection.status, 'online')
  accepted(room.service.disconnect('east-extra')!)
  room.at(129_999)
  accepted(room.service.connect(room.code, room.identities[1], 'east-return'))
  room.at(130_000)
  assert.equal(room.read().members[1].connection.status, 'online')
  accepted(room.service.disconnect('east-return')!)
  assert.equal(room.read().members[1].connection.deadline, 160_000)
  assert.equal(room.service.disconnect('east-return'), null)
  const outsider = room.service.issueIdentity()
  assert.equal(room.service.connect(room.code, outsider, 'outsider').status, 'unauthorized')
  assert.equal(room.service.connect(room.code, room.identities[1], 'socket-0').status, 'unauthorized')
})

test('电脑思考期间重连撤回授权，已提交动作保留且真人随后可继续', async (t) => {
  const { suggestAuction } = await import('./computer/auction-strategy.ts')
  const room = table(t)
  accepted(room.service.disconnect('socket-0')!)
  room.at(130_000)
  const turn = room.service.computerTurn(room.code)!
  const decision = suggestAuction(turn.input)!
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve }).then(() => room.service.submitComputerCall(turn, decision))
  accepted(room.service.connect(room.code, room.identities[0], 'north-return'))
  release()
  assert.equal((await pending).status, 'stale_state')
  assert.deepEqual(room.read().board!.auction, [])
  accepted(room.send(0, { kind: 'call', call: { kind: 'pass' } }))
  accepted(room.service.disconnect('socket-1')!)
  room.at(160_000)
  const east = room.service.computerTurn(room.code)!
  accepted(room.service.submitComputerCall(east, suggestAuction(east.input)!))
  const submitted = room.read().board!.auction
  accepted(room.service.connect(room.code, room.identities[1], 'east-return'))
  assert.deepEqual(room.read().board!.auction, submitted)
  assert.equal(room.read().board!.turn, 'south')
  accepted(room.send(2, { kind: 'call', call: { kind: 'pass' } }))
})

test('接管庄家可控制明手，重连废弃明手旧出牌并保留已提交的首攻', async (t) => {
  const { suggestPlay } = await import('./computer/play-strategy.ts')
  const room = table(t)
  accepted(room.send(0, { kind: 'call', call: { kind: 'bid', level: 1, denomination: 'NT' } }))
  for (let i = 1; i < 4; i++) accepted(room.send(i, { kind: 'call', call: { kind: 'pass' } }))
  accepted(room.service.disconnect('socket-0')!)
  accepted(room.send(1, { kind: 'play', seat: 'east', card: room.read(1).board!.legalCards[0] }))
  room.at(129_999)
  assert.equal(room.service.computerPlayTurn(room.code), null)
  room.at(130_000)
  const turn = room.service.computerPlayTurn(room.code)!
  assert.equal(turn.input.seat, 'north')
  assert.equal(turn.input.turn, 'south')
  assert.deepEqual(turn.input.hand, room.read(0).hand)
  const decision = suggestPlay(turn.input)!
  const before = room.read().board!.currentTrick
  accepted(room.service.connect(room.code, room.identities[0], 'declarer-return'))
  assert.equal(room.service.submitComputerPlay(turn, decision).status, 'stale_state')
  assert.deepEqual(room.read().board!.currentTrick, before)
  assert.deepEqual(room.read(2).board!.legalCards, [])
  accepted(room.send(0, { kind: 'play', seat: 'south', card: room.read(0).board!.legalCards[0] }))
  assert.equal(room.read().board!.currentTrick.length, 2)
})

test('暂停时仍记录到期接管但不开始新副，房主恢复后按准备条件发牌', (t) => {
  const room = table(t)
  for (let i = 0; i < 4; i++) accepted(room.send(i, { kind: 'call', call: { kind: 'pass' } }))
  for (const i of [0, 2, 3]) accepted(room.send(i, { kind: 'ready' }))
  accepted(room.send(0, { kind: 'pause' }))
  accepted(room.service.disconnect('socket-1')!)
  room.at(130_000)
  assert.equal(room.read().board!.number, 1)
  assert.equal(room.read().board!.seats.east.ready, true)
  assert.equal(room.service.computerTurn(room.code), null)
  accepted(room.send(0, { kind: 'resume' }))
  assert.equal(room.read().board!.number, 2)
})

test('离线截止时间跨重启保留，掉线和到期提交失败原子回滚并重试', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const room = table(t)
  const db = new DatabaseSync(room.path)
  t.after(() => db.close())
  const before = room.read()
  const fail = () => db.exec("CREATE TRIGGER fail_presence BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'failure'); END")
  const recover = () => db.exec('DROP TRIGGER fail_presence')
  fail()
  assert.equal(room.service.disconnect('socket-1')!.status, 'storage_failure')
  assert.deepEqual(room.read(), before)
  recover()
  room.at(110_000)
  assert.equal(room.read().members[1].connection.deadline, 130_000)
  room.restart()
  room.at(129_999)
  assert.equal(room.read().members[1].connection.status, 'waiting')
  fail()
  const waiting = room.read()
  assert.deepEqual(room.at(130_000), [])
  assert.deepEqual(room.read(), waiting)
  recover()
  assert.deepEqual(room.at(130_001), [room.code])
  assert.equal(room.read().members[1].connection.status, 'taken-over')
  const takenOver = room.read()
  fail()
  assert.equal(room.service.connect(room.code, room.identities[1], 'east-return').status, 'storage_failure')
  assert.deepEqual(room.read(), takenOver)
  recover()
  accepted(room.service.connect(room.code, room.identities[1], 'east-return'))
  const returned = room.read()
  accepted(room.service.connect(room.code, room.identities[1], 'east-return'))
  assert.deepEqual(room.read(), returned)
})
