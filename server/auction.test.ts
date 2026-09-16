import { assertRecovered, reconnectAndResume } from './fixtures/recovery.ts'
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GameService } from './game-service.ts'
import { seats } from '../shared/protocol.ts'
import type { Result, Seat } from '../shared/protocol.ts'

function accepted(result: Result) {
  if (result.status !== 'accepted') assert.fail(result.message)
  return result.state
}
function table(t: TestContext, count = 4) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-auction-'))
  const path = join(dir, 'game.sqlite')
  let service = new GameService(path)
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
  const read = (index = 0) => accepted(service.read(code, identities[index]))
  for (let index = 0; index < count; index++) {
    if (index)
      accepted(
        service.execute({
          kind: 'join',
          credential: identities[index],
          code,
          nickname: seats[index],
          operationId: 'join',
          expectedVersion: read().version,
        }),
      )
    accepted(
      service.execute({
        kind: 'seat',
        credential: identities[index],
        code,
        seat: seats[index],
        operationId: 'seat',
        expectedVersion: read().version,
      }),
    )
  }
  accepted(
    service.execute({
      kind: 'start',
      credential: identities[0],
      code,
      expectedVersion: read().version,
      operationId: 'start',
    }),
  )
  let sequence = 0
  const command = (call: unknown, seat: Seat = read().board!.turn!) => ({
    kind: 'call',
    credential: identities[seats.indexOf(seat)],
    code,
    expectedVersion: read().version,
    operationId: `call-${sequence++}`,
    call,
  })
  return {
    get service() {
      return service
    },
    path,
    identities,
    code,
    read,
    command,
    call: (call: unknown) => accepted(service.execute(command(call))),
    resume() { reconnectAndResume(service, code, identities) },
    restart() {
      service.close()
      service = new GameService(path)
    },
  }
}

test('开局三家不叫仍轮到西家，四家不叫后结束且没有定约或行动方', (t) => {
  const room = table(t)
  for (let i = 0; i < 3; i++) room.call({ kind: 'pass' })
  assert.equal(room.read().board!.phase, 'auction')
  assert.equal(room.read().board!.turn, 'west')
  const state = room.call({ kind: 'pass' })
  assert.equal(state.board!.phase, 'passed-out')
  assert.equal(state.board!.turn, null)
  assert.equal(state.board!.contract, null)
  assert.deepEqual(
    state.board!.auction.map((entry) => entry.seat),
    ['north', 'east', 'south', 'west'],
  )
  assert.deepEqual(state.board!.legalCalls, [])
  assert.equal(
    room.service.execute(room.command({ kind: 'pass' }, 'north')).status,
    'illegal_action',
  )
})

test('同阶花色逐级提升，无将最高；三次不叫成立定约，庄家是本方最先叫该花色者', (t) => {
  const room = table(t)
  room.call({ kind: 'bid', level: 1, denomination: 'C' })
  room.call({ kind: 'bid', level: 1, denomination: 'D' })
  room.call({ kind: 'bid', level: 1, denomination: 'H' })
  room.call({ kind: 'bid', level: 1, denomination: 'S' })
  room.call({ kind: 'bid', level: 1, denomination: 'NT' })
  room.call({ kind: 'pass' })
  room.call({ kind: 'bid', level: 3, denomination: 'NT' })
  room.call({ kind: 'pass' })
  room.call({ kind: 'pass' })
  assert.equal(room.read().board!.phase, 'auction')
  const board = room.call({ kind: 'pass' }).board!
  assert.equal(board.phase, 'opening-lead')
  assert.equal(board.turn, 'east')
  assert.deepEqual(board.contract, {
    level: 3,
    denomination: 'NT',
    doubling: 'undoubled',
    declarer: 'north',
    openingLeader: 'east',
  })
  assert.equal(board.auction.length, 10)
})

test('加倍和再加倍可隔不叫生效，重新起算连续不叫；仅最终定约一方认定庄家', (t) => {
  const room = table(t)
  room.call({ kind: 'bid', level: 1, denomination: 'H' }) // 北
  room.call({ kind: 'bid', level: 2, denomination: 'H' }) // 东
  room.call({ kind: 'pass' })
  room.call({ kind: 'pass' })
  assert.ok(
    room.read().board!.legalCalls.some((call) => call.kind === 'double'),
  )
  room.call({ kind: 'double' }) // 北
  room.call({ kind: 'pass' })
  room.call({ kind: 'pass' })
  const west = accepted(room.service.read(room.code, room.identities[3]))
  assert.ok(west.board!.legalCalls.some((call) => call.kind === 'redouble'))
  room.call({ kind: 'redouble' }) // 西
  room.call({ kind: 'pass' })
  room.call({ kind: 'pass' })
  assert.equal(room.read().board!.phase, 'auction')
  const board = room.call({ kind: 'pass' }).board!
  assert.deepEqual(board.contract, {
    level: 2,
    denomination: 'H',
    doubling: 'redoubled',
    declarer: 'east',
    openingLeader: 'south',
  })
})

test('拒绝越轮次、越权、畸形叫品、不足叫、同阵营加倍和错误再加倍，状态不变', (t) => {
  const room = table(t)
  function rejected(
    call: unknown,
    seat: Seat = room.read().board!.turn!,
    status = 'illegal_action',
  ) {
    const before = room.read()
    assert.equal(room.service.execute(room.command(call, seat)).status, status)
    assert.deepEqual(room.read(), before)
  }
  rejected({ kind: 'pass' }, 'east')
  for (const call of [
    null,
    {},
    'pass',
    { kind: 'double' },
    { kind: 'redouble' },
    { kind: 'bid', level: 0, denomination: 'C' },
    { kind: 'bid', level: 8, denomination: 'C' },
    { kind: 'bid', level: 1.5, denomination: 'C' },
    { kind: 'bid', level: '1', denomination: 'C' },
    { kind: 'bid', level: 1, denomination: 'invalid' },
  ])
    rejected(call)
  const foreign = room.service.issueIdentity()
  assert.equal(
    room.service.execute({
      ...room.command({ kind: 'pass' }),
      credential: foreign,
    }).status,
    'unauthorized',
  )
  room.call({ kind: 'bid', level: 1, denomination: 'NT' })
  rejected({ kind: 'bid', level: 1, denomination: 'NT' })
  rejected({ kind: 'bid', level: 1, denomination: 'S' })
  rejected({ kind: 'redouble' })
  room.call({ kind: 'pass' })
  rejected({ kind: 'double' }) // 南不能加倍北的定约
  room.call({ kind: 'bid', level: 2, denomination: 'C' })
  room.call({ kind: 'double' }) // 西
  rejected({ kind: 'double' })
  room.call({ kind: 'pass' })
  rejected({ kind: 'redouble' }) // 东不能再加倍本方的加倍
  room.call({ kind: 'pass' })
  room.call({ kind: 'redouble' })
  rejected({ kind: 'double' })
  rejected({ kind: 'redouble' })
  room.call({ kind: 'bid', level: 7, denomination: 'NT' }) // 新叫品清除加倍
  assert.deepEqual(room.read().board!.legalCalls, [
    { kind: 'pass' },
    { kind: 'double' },
  ])
  room.call({ kind: 'pass' })
  room.call({ kind: 'pass' })
  const board = room.call({ kind: 'pass' }).board!
  assert.deepEqual(board.contract, {
    level: 7,
    denomination: 'NT',
    doubling: 'undoubled',
    declarer: 'west',
    openingLeader: 'north',
  })
})

test('定约加倍后连续三次不叫，保留加倍且首攻从西轮回北', (t) => {
  const room = table(t)
  room.call({ kind: 'pass' })
  room.call({ kind: 'pass' })
  room.call({ kind: 'pass' })
  room.call({ kind: 'bid', level: 7, denomination: 'S' })
  room.call({ kind: 'double' })
  room.call({ kind: 'pass' })
  room.call({ kind: 'pass' })
  const board = room.call({ kind: 'pass' }).board!
  assert.deepEqual(board.contract, {
    level: 7,
    denomination: 'S',
    doubling: 'doubled',
    declarer: 'west',
    openingLeader: 'north',
  })
  assert.equal(board.turn, 'north')
  assert.deepEqual(board.legalCalls, [])
})

test('叫牌与操作记录同事务回滚，确认丢失及重启后重试只生效一次，过期后读取最新授权状态', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const room = table(t)
  const before = room.read()
  const command = room.command({ kind: 'bid', level: 1, denomination: 'H' })
  const database = new DatabaseSync(room.path)
  t.after(() => database.close())
  database.exec(
    "CREATE TRIGGER fail_call BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'failure'); END",
  )
  assert.equal(room.service.execute(command).status, 'storage_failure')
  assert.deepEqual(room.read(), before)
  database.exec('DROP TRIGGER fail_call')
  const first = room.service.execute(command)
  accepted(first)
  assert.deepEqual(
    room.service.execute({
      ...command,
      call: { denomination: 'H', kind: 'bid', level: 1 },
    }),
    first,
  )
  assert.equal(
    room.service.execute({ ...command, call: { kind: 'pass' } }).status,
    'operation_conflict',
  )
  assert.equal(
    room.service.execute({ ...command, operationId: 'stale' }).status,
    'stale_state',
  )
  room.call({ kind: 'pass' })
  const latest = room.read()
  assert.equal(latest.board!.auction.length, 2)
  assert.deepEqual(latest.hand, before.hand)
  assert.deepEqual(accepted(room.service.execute(command)), latest)
  room.restart()
  assertRecovered(room.read(), latest)
  assert.deepEqual(accepted(room.service.execute(command)), room.read())
  room.resume()
  room.call({ kind: 'pass' })
  room.call({ kind: 'pass' })
  const ended = room.read()
  room.restart()
  assertRecovered(room.read(), ended)
})

test('等待者可查看公开记录和行动方但不能叫牌，合法操作按身份提供且暗牌不公开', (t) => {
  const room = table(t, 2)
  accepted(
    room.service.execute({
      kind: 'join',
      credential: room.identities[2],
      code: room.code,
      nickname: '等待者',
      operationId: 'join',
      expectedVersion: room.read().version,
    }),
  )
  const before = room.read()
  assert.equal(before.board!.legalCalls.length, 36)
  const initialGuestHand = room.read(1).hand
  room.call({ kind: 'bid', level: 1, denomination: 'C' })
  const waiting = room.read(2)
  assert.deepEqual(waiting.hand, [])
  assert.deepEqual(waiting.board!.legalCalls, [])
  assert.deepEqual(waiting.board!.auction, [
    { seat: 'north', call: { kind: 'bid', level: 1, denomination: 'C' } },
  ])
  assert.equal(waiting.board!.turn, 'east')
  assert.equal(
    room.service.execute(room.command({ kind: 'pass' }, 'south')).status,
    'unauthorized',
  )
  assert.deepEqual(room.read().board!.legalCalls, [])
  assert.deepEqual(room.read().hand, before.hand)
  assert.deepEqual(room.read(1).hand, initialGuestHand)
  assert.ok(!JSON.stringify(waiting).includes('hands'))
  room.call({ kind: 'pass' })
  assert.equal(
    room.service.execute(room.command({ kind: 'pass' }, 'south')).status,
    'unauthorized',
  )
})
