import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GameService } from './game-service.ts'
import { seats, suits, ranks } from '../shared/protocol.ts'
import type { Card, Result, Call } from '../shared/protocol.ts'

function accepted(result: Result) {
  if (result.status !== 'accepted') assert.fail(result.message)
  return result.state
}
function table(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-score-'))
  const path = join(dir, 'game.sqlite')
  const deck = suits.flatMap((s) => ranks.map((r) => `${s}${r}` as Card))
  let service = new GameService(path, { deck: () => deck })
  t.after(() => {
    service.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const identities = seats.map(() => service.issueIdentity())
  const code = accepted(
    service.execute({
      kind: 'create',
      credential: identities[0],
      nickname: '北',
      operationId: 'create',
    }),
  ).code
  const read = (i = 0) => accepted(service.read(code, identities[i]))
  let sequence = 0
  const command = (i: number, action: object) => ({
    credential: identities[i],
    code,
    expectedVersion: read().version,
    operationId: `op-${sequence++}`,
    ...action,
  })
  for (let i = 0; i < 4; i++) {
    if (i)
      accepted(
        service.execute(command(i, { kind: 'join', nickname: seats[i] })),
      )
    accepted(service.execute(command(i, { kind: 'seat', seat: seats[i] })))
  }
  accepted(service.execute(command(0, { kind: 'start' })))
  const call = (call: Call) =>
    accepted(
      service.execute(
        command(seats.indexOf(read().board!.turn!), { kind: 'call', call }),
      ),
    )
  const nextPlay = () => {
    const board = read().board!
    const turn = board.turn!
    const dummy = seats[(seats.indexOf(board.contract!.declarer) + 2) % 4]
    const i = seats.indexOf(turn === dummy ? board.contract!.declarer : turn)
    return command(i, {
      kind: 'play',
      seat: turn,
      card: read(i).board!.legalCards[0],
    })
  }
  return {
    path,
    read,
    call,
    nextPlay,
    command,
    identities,
    code,
    get service() {
      return service
    },
    restart() {
      service.close()
      service = new GameService(path)
    },
  }
}

test('四名真人全部准备后开始下一副，准备状态与本副记录重置', (t) => {
  const room = table(t)
  for (let i = 0; i < 4; i++) room.call({ kind: 'pass' })
  for (let i = 0; i < 3; i++) {
    accepted(room.service.execute(room.command(i, { kind: 'ready' })))
    assert.equal(room.read().board!.number, 1)
    assert.equal(room.read().board!.seats[seats[i]].ready, true)
  }
  const state = accepted(room.service.execute(room.command(3, { kind: 'ready' })))
  assert.equal(state.board!.number, 2)
  assert.equal(state.board!.dealer, 'east')
  assert.equal(state.board!.vulnerability, 'north-south')
  assert.equal(state.board!.phase, 'auction')
  assert.deepEqual(state.board!.auction, [])
  assert.equal(state.board!.score, null)
  assert.equal(state.board!.reviewHands, null)
  assert.ok(seats.every((seat) => !state.board!.seats[seat].ready))
})

test('连续十七副按固定周期轮换发牌人和局况', (t) => {
  const room = table(t)
  const expected = [
    ['north', 'none'], ['east', 'north-south'], ['south', 'east-west'], ['west', 'both'],
    ['north', 'north-south'], ['east', 'east-west'], ['south', 'both'], ['west', 'none'],
    ['north', 'east-west'], ['east', 'both'], ['south', 'none'], ['west', 'north-south'],
    ['north', 'both'], ['east', 'none'], ['south', 'north-south'], ['west', 'east-west'],
    ['north', 'none'],
  ]
  for (const [index, [dealer, vulnerability]] of expected.entries()) {
    const board = room.read().board!
    assert.equal(board.number, index + 1)
    assert.equal(board.dealer, dealer)
    assert.equal(board.turn, dealer)
    assert.equal(board.vulnerability, vulnerability)
    for (let i = 0; i < 4; i++) room.call({ kind: 'pass' })
    for (let i = 0; i < 4; i++) accepted(room.service.execute(room.command(i, { kind: 'ready' })))
  }
})

test('最后准备失败原子回滚，并发与确认丢失重试只产生一副新牌', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const room = table(t)
  room.call({ kind: 'bid', level: 4, denomination: 'S' })
  for (let i = 0; i < 3; i++) room.call({ kind: 'pass' })
  for (let i = 0; i < 52; i++) accepted(room.service.execute(room.nextPlay()))
  for (let i = 0; i < 3; i++) accepted(room.service.execute(room.command(i, { kind: 'ready' })))
  const before = room.read()
  const final = room.command(3, { kind: 'ready' })
  const db = new DatabaseSync(room.path)
  t.after(() => db.close())
  db.exec("CREATE TRIGGER fail_ready BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'failure'); END")
  assert.equal(room.service.execute(final).status, 'storage_failure')
  assert.deepEqual(room.read(), before)
  db.exec('DROP TRIGGER fail_ready')
  const results = await Promise.all([
    Promise.resolve().then(() => room.service.execute(final)),
    Promise.resolve().then(() => room.service.execute(final)),
    Promise.resolve().then(() => room.service.execute({ ...final, operationId: 'racing-ready' })),
  ])
  assert.deepEqual(results[0], results[1])
  assert.equal(results[2].status, 'stale_state')
  assert.equal(room.read().board!.number, 2)
  assert.deepEqual(room.read().scores, { 'north-south': 510, 'east-west': -510 })
  assert.deepEqual(room.read().board!.tricks, [])
  assert.deepEqual(room.read().board!.currentTrick, [])
  assert.equal(room.read().board!.contract, null)
  for (let i = 0; i < 4; i++) {
    assert.equal(room.read(i).hand.length, 13)
    assert.equal(room.read(i).board!.reviewHands, null)
  }
  room.restart()
  assert.deepEqual(room.service.execute(final), results[0])
  assert.equal(room.service.execute(room.command(3, { kind: 'ready' })).status, 'illegal_action')
})

test('准备受阶段与身份约束，部分准备持久化且重复准备不跳过其他真人', (t) => {
  const room = table(t)
  assert.equal(room.service.execute(room.command(0, { kind: 'ready' })).status, 'illegal_action')
  for (let i = 0; i < 4; i++) room.call({ kind: 'pass' })
  const outsider = room.service.issueIdentity()
  assert.equal(room.service.execute({ ...room.command(0, { kind: 'ready' }), credential: outsider }).status, 'unauthorized')
  const first = room.command(0, { kind: 'ready' })
  accepted(room.service.execute(first))
  const before = room.read()
  accepted(room.service.execute(first))
  assert.deepEqual(room.read(), before)
  accepted(room.service.execute(room.command(0, { kind: 'ready' })))
  room.restart()
  assert.equal(room.read().board!.number, 1)
  assert.equal(room.read().board!.seats.north.ready, true)
  assert.equal(room.read().board!.seats.east.ready, false)
  assert.equal(room.service.execute({ ...first, kind: 'start' }).status, 'operation_conflict')
})

test('已登记电脑座位自动准备，未参与本副的等待者不能代为准备', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const room = table(t)
  for (let i = 0; i < 4; i++) room.call({ kind: 'pass' })
  // 电脑行动尚未集成：登记一份已结算的一真人三电脑存档，验证公开准备入口。
  const db = new DatabaseSync(room.path)
  const row = db.prepare('SELECT state FROM rooms WHERE code = ?').get(room.code)!
  const stored = JSON.parse(String(row.state))
  for (const seat of ['east', 'south', 'west']) stored.board.occupants[seat] = null
  for (const member of stored.members.slice(1)) member.seat = null
  db.prepare('UPDATE rooms SET state = ? WHERE code = ?').run(JSON.stringify(stored), room.code)
  db.close()
  room.restart()
  for (const seat of ['east', 'south', 'west'] as const) assert.equal(room.read().board!.seats[seat].ready, true)
  assert.equal(room.service.execute(room.command(1, { kind: 'ready' })).status, 'unauthorized')
  accepted(room.service.execute(room.command(0, { kind: 'ready' })))
  assert.equal(room.read().board!.number, 2)
  assert.ok(seats.every((seat) => !room.read().board!.seats[seat].ready))
  assert.equal(room.read(1).hand.length, 0)
})
