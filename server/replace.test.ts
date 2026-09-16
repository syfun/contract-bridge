import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GameService } from './game-service.ts'
import { suits, ranks } from '../shared/protocol.ts'
import type { Card, Result } from '../shared/protocol.ts'

function accepted(result: Result) {
  if (result.status !== 'accepted') assert.fail(result.message)
  return result.state
}
function table(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-replace-'))
  const path = join(dir, 'room.sqlite')
  let now = 100_000
  const options = { deck: () => suits.flatMap(s => ranks.map(r => `${s}${r}` as Card)), now: () => now }
  let service = new GameService(path, options)
  t.after(() => { service.close(); rmSync(dir, { recursive: true, force: true }) })
  const identities = Array.from({ length: 6 }, () => service.issueIdentity())
  const code = accepted(service.execute({ kind: 'create', credential: identities[0], nickname: '北', operationId: 'create' })).code
  let n = 0
  const read = (i = 0) => accepted(service.read(code, identities[i]))
  const command = (i: number, action: object) => ({ code, credential: identities[i], expectedVersion: accepted(service.read(code, identities[i])).version, operationId: `op-${n++}`, ...action })
  const send = (i: number, action: object): Result => service.execute(command(i, action))
  const enter = (i: number) => {
    accepted(service.execute({ code, credential: identities[i], expectedVersion: accepted(service.read(code, identities[0])).version, operationId: `join-${i}`, kind: 'join', nickname: `牌友${i}` }))
    accepted(service.connect(code, identities[i], `socket-${i}`))
  }
  accepted(service.connect(code, identities[0], 'socket-0'))
  accepted(send(0, { kind: 'seat', seat: 'north' }))
  return { path, code, identities, read, send, enter, command,
    get service() { return service },
    at(time: number) { now = time; service.tick() },
    restart() { service.close(); service = new GameService(path, options) },
  }
}

test('中途等待者只能在结算后接替无归属座位，选座竞争和重新准备保留累计分', async t => {
  const room = table(t)
  room.enter(1)
  accepted(room.send(1, { kind: 'seat', seat: 'east' }))
  accepted(room.send(0, { kind: 'start' }))
  room.enter(2)
  assert.deepEqual(room.read(2).hand, [])
  assert.equal(room.read(2).board!.dummy, null)
  assert.equal(room.send(2, { kind: 'seat', seat: 'south' }).status, 'illegal_action')
  // 固定牌组：北家十三张黑桃，4S 获得十三墩，南北累计 510。
  accepted(room.send(0, { kind: 'call', call: { kind: 'bid', level: 4, denomination: 'S' } }))
  while (room.read().board!.phase === 'auction') {
    const turn = room.service.computerTurn(room.code)
    if (turn) accepted(room.service.submitComputerCall(turn, { version: turn.input.version, conventionVersion: 'computer-conventions-v1.0', rule: 'C07', reason: '', call: { kind: 'pass' } }))
    else accepted(room.send(1, { kind: 'call', call: { kind: 'pass' } }))
  }
  while (!room.read().board!.score) {
    const turn = room.service.computerPlayTurn(room.code)
    if (turn) {
      const { suggestPlay } = await import('./computer/play-strategy.ts')
      accepted(room.service.submitComputerPlay(turn, suggestPlay(turn.input)!))
    } else {
      const state = room.read().board!.legalCards.length ? room.read() : room.read(1)
      accepted(room.send(state.selfId === room.read().selfId ? 0 : 1, { kind: 'play', seat: state.board!.turn, card: state.board!.legalCards[0] }))
    }
  }
  assert.deepEqual(room.read().scores, { 'north-south': 510, 'east-west': -510 })
  assert.equal(room.send(0, { kind: 'start' }).status, 'illegal_action')
  accepted(room.send(0, { kind: 'ready' }))
  room.enter(3)
  const first = room.command(2, { kind: 'seat', seat: 'south' })
  const second = room.command(3, { kind: 'seat', seat: 'south' })
  accepted(room.service.execute(first))
  assert.equal(room.service.execute(second).status, 'stale_state')
  assert.equal(room.send(3, { kind: 'seat', seat: 'south' }).status, 'seat_taken')
  assert.equal(room.read().board!.seats.north.ready, false)
  for (const i of [0, 1, 2]) accepted(room.send(i, { kind: 'ready' }))
  assert.equal(room.read().board!.number, 2)
  assert.equal(room.read(2).hand.length, 13)
  assert.deepEqual(room.read().scores, { 'north-south': 510, 'east-west': -510 })
})

test('主动退出即刻交给电脑、转交房主，旧凭据和旧行动失效，退出重试不重复提交', t => {
  const room = table(t)
  room.enter(1)
  accepted(room.send(1, { kind: 'seat', seat: 'east' }))
  accepted(room.send(0, { kind: 'start' }))
  const old = room.command(0, { kind: 'call', call: { kind: 'pass' } })
  const leave = room.command(0, { kind: 'leave' })
  const result = room.service.execute(leave)
  accepted(result)
  assert.equal(room.service.read(room.code, room.identities[0]).status, 'unauthorized')
  assert.equal(room.service.execute(old).status, 'unauthorized')
  assert.equal(room.service.connect(room.code, room.identities[0], 'old').status, 'unauthorized')
  assert.deepEqual(room.service.execute(leave), result)
  const state = room.read(1)
  assert.equal(state.hostId, state.selfId)
  assert.equal(state.board!.seats.north.memberId, null)
  assert.ok(room.service.computerTurn(room.code))
  assert.equal(room.service.disconnect('socket-0'), null)
  room.at(150_000)
  assert.equal(room.read(1).version, state.version)
})

test('房主仅在两副之间释放离线座位，接管保留归属，保存失败可重试且重启不复活旧凭据', async t => {
  const room = table(t)
  for (const [i, seat] of [[1, 'east'], [2, 'south'], [3, 'west']] as const) {
    room.enter(i)
    accepted(room.send(i, { kind: 'seat', seat }))
  }
  accepted(room.send(0, { kind: 'start' }))
  assert.equal(room.send(0, { kind: 'release', seat: 'east' }).status, 'illegal_action')
  for (const i of [0, 1, 2, 3]) accepted(room.send(i, { kind: 'call', call: { kind: 'pass' } }))
  assert.equal(room.send(0, { kind: 'release', seat: 'east' }).status, 'illegal_action')
  accepted(room.service.disconnect('socket-1')!)
  room.at(130_000)
  assert.equal(room.read().board!.seats.east.memberId, room.read(1).selfId)
  assert.equal(room.send(2, { kind: 'release', seat: 'east' }).status, 'unauthorized')
  const release = room.command(0, { kind: 'release', seat: 'east' })
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(room.path)
  t.after(() => db.close())
  db.exec("CREATE TRIGGER fail_release BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'failure'); END")
  const before = room.read()
  assert.equal(room.service.execute(release).status, 'storage_failure')
  assert.deepEqual(room.read(), before)
  assert.equal(room.service.read(room.code, room.identities[1]).status, 'accepted')
  db.exec('DROP TRIGGER fail_release')
  accepted(room.service.execute(release))
  assert.equal(room.service.read(room.code, room.identities[1]).status, 'unauthorized')
  assert.equal(room.read().board!.seats.east.memberId, null)
  room.enter(4)
  accepted(room.send(4, { kind: 'seat', seat: 'east' }))
  assert.equal(room.read(4).members.at(-1)!.joinedOrder, 5)
  room.restart()
  assert.equal(room.service.read(room.code, room.identities[1]).status, 'unauthorized')
  assert.equal(room.read(4).board!.seats.east.memberId, room.read(4).selfId)
  assert.equal(room.service.execute(release).status, 'accepted')
  assert.equal(room.service.execute({ ...release, seat: 'south' }).status, 'operation_conflict')
})

test('最后真人退出后暂停，后来者接任房主但仍需恢复，暂停期间允许退出', t => {
  const room = table(t)
  accepted(room.send(0, { kind: 'start' }))
  const leave = room.command(0, { kind: 'leave' })
  accepted(room.service.execute(leave))
  assert.equal(room.service.computerTurn(room.code), null)
  const version = room.service.joinVersion(room.code, room.identities[1])
  assert.equal(version.status, 'accepted')
  if (version.status !== 'accepted') return
  accepted(room.service.execute({ kind: 'join', code: room.code, credential: room.identities[1], nickname: '继任', expectedVersion: version.version, operationId: 'successor' }))
  accepted(room.service.connect(room.code, room.identities[1], 'successor'))
  assert.equal(room.read(1).hostId, room.read(1).selfId)
  assert.equal(room.read(1).pause?.reason, 'all-offline')
  room.restart()
  accepted(room.service.execute(leave))
  accepted(room.service.connect(room.code, room.identities[1], 'returned'))
  accepted(room.send(1, { kind: 'resume' }))
  assert.ok(room.service.computerTurn(room.code))
  accepted(room.send(1, { kind: 'pause' }))
  accepted(room.send(1, { kind: 'leave' }))
  assert.equal(room.service.computerTurn(room.code), null)
})

test('原真人全部退出后等待者可在结算停留时入座，不被四名电脑自动开新副跳过', async t => {
  const room = table(t)
  room.enter(1)
  accepted(room.send(0, { kind: 'start' }))
  accepted(room.send(0, { kind: 'leave' }))
  for (let i = 0; i < 4; i++) {
    const turn = room.service.computerTurn(room.code)!
    accepted(room.service.submitComputerCall(turn, { version: turn.input.version, conventionVersion: 'computer-conventions-v1.0', rule: 'C07', reason: '', call: { kind: 'pass' } }))
  }
  assert.equal(room.read(1).board!.number, 1)
  assert.ok(room.read(1).board!.score)
  accepted(room.send(1, { kind: 'seat', seat: 'north' }))
  accepted(room.send(1, { kind: 'ready' }))
  assert.equal(room.read(1).board!.number, 2)
})
