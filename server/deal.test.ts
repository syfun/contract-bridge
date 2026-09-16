import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GameService } from './game-service.ts'
import type { Card, Result, Seat } from '../shared/protocol.ts'

const fixedDeck: Card[] = [
  'S2',
  'S3',
  'S4',
  'S5',
  'S6',
  'S7',
  'S8',
  'S9',
  'S10',
  'SJ',
  'SQ',
  'SK',
  'SA',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'H7',
  'H8',
  'H9',
  'H10',
  'HJ',
  'HQ',
  'HK',
  'HA',
  'D2',
  'D3',
  'D4',
  'D5',
  'D6',
  'D7',
  'D8',
  'D9',
  'D10',
  'DJ',
  'DQ',
  'DK',
  'DA',
  'C2',
  'C3',
  'C4',
  'C5',
  'C6',
  'C7',
  'C8',
  'C9',
  'C10',
  'CJ',
  'CQ',
  'CK',
  'CA',
]
function accepted(result: Result) {
  if (result.status !== 'accepted') assert.fail(result.message)
  return result.state
}
function table(
  t: TestContext,
  deck: (() => Card[]) | null = () => [...fixedDeck],
) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-deal-'))
  const path = join(dir, 'game.sqlite')
  let service = new GameService(path, deck ? { deck } : {})
  t.after(() => {
    service.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const host = service.issueIdentity()
  const created = accepted(
    service.execute({
      kind: 'create',
      credential: host,
      nickname: '房主',
      operationId: 'create',
    }),
  )
  const code = created.code
  const read = (credential = host) => accepted(service.read(code, credential))
  const seat = (credential: string, position: Seat) =>
    service.execute({
      kind: 'seat',
      credential,
      code,
      seat: position,
      expectedVersion: read(credential).version,
      operationId: `seat-${position}`,
    })
  const joinRoom = (nickname: string) => {
    const credential = service.issueIdentity()
    accepted(
      service.execute({
        kind: 'join',
        credential,
        code,
        nickname,
        operationId: 'join',
        expectedVersion: read().version,
      }),
    )
    return credential
  }
  return {
    path,
    get service() {
      return service
    },
    host,
    code,
    read,
    seat,
    joinRoom,
    restart() {
      service.close()
      service = new GameService(path, {
        deck: () => {
          throw Error('恢复不能重新发牌')
        },
      })
    },
    start() {
      return service.execute({
        kind: 'start',
        code,
        credential: host,
        expectedVersion: read().version,
        operationId: 'start',
      })
    },
  }
}

test('一名真人开局后空位由电脑补齐，只返回本人十三张牌', (t) => {
  const room = table(t)
  accepted(room.seat(room.host, 'south'))
  const state = accepted(room.start())
  assert.deepEqual(state.hand, [
    'D2',
    'D3',
    'D4',
    'D5',
    'D6',
    'D7',
    'D8',
    'D9',
    'D10',
    'DJ',
    'DQ',
    'DK',
    'DA',
  ])
  assert.deepEqual(state.board, {
    number: 1,
    dealer: 'north',
    vulnerability: 'none',
    turn: 'north',
    phase: 'auction',
    auction: [],
    contract: null,
    legalCalls: [],
    legalCards: [],
    currentTrick: [],
    tricks: [],
    dummy: null,
    seats: {
      north: { memberId: null, controller: 'computer', cardCount: 13 },
      east: { memberId: null, controller: 'computer', cardCount: 13 },
      south: { memberId: state.selfId, controller: 'human', cardCount: 13 },
      west: { memberId: null, controller: 'computer', cardCount: 13 },
    },
  })
  assert.equal(state.version, 3)
})

test('开局后座位锁定，等待者和中途加入者不能领取电脑手牌', (t) => {
  const room = table(t)
  accepted(room.seat(room.host, 'south'))
  const waiting = room.joinRoom('未入座')
  accepted(room.start())
  const late = room.joinRoom('中途加入')
  for (const credential of [waiting, late]) {
    const state = room.read(credential)
    assert.deepEqual(state.hand, [])
    assert.equal(room.seat(credential, 'north').status, 'illegal_action')
    assert.deepEqual(Object.keys(state).sort(), [
      'board',
      'code',
      'hand',
      'hostId',
      'members',
      'selfId',
      'version',
    ])
    assert.deepEqual(Object.keys(state.board!).sort(), [
      'auction',
      'contract',
      'currentTrick',
      'dealer',
      'dummy',
      'legalCalls',
      'legalCards',
      'number',
      'phase',
      'seats',
      'tricks',
      'turn',
      'vulnerability',
    ])
  }
  assert.equal(room.seat(room.host, 'west').status, 'illegal_action')
  assert.deepEqual(room.read().hand, [
    'D2',
    'D3',
    'D4',
    'D5',
    'D6',
    'D7',
    'D8',
    'D9',
    'D10',
    'DJ',
    'DQ',
    'DK',
    'DA',
  ])
})

for (const count of [2, 3, 4]) {
  test(`${count} 名真人开局，其他位置补齐电脑，四真人合计完整且不重复的 52 张牌`, (t) => {
    const room = table(t, null)
    const credentials = [room.host]
    for (let index = 1; index < count; index++)
      credentials.push(room.joinRoom(`牌友${index}`))
    const positions: Seat[] = ['north', 'east', 'south', 'west']
    credentials.forEach((credential, index) =>
      accepted(room.seat(credential, positions[index])),
    )
    accepted(room.start())
    const views = credentials.map((credential) => room.read(credential))
    for (const state of views) {
      assert.equal(state.hand.length, 13)
      assert.equal(
        Object.values(state.board!.seats).filter(
          (s) => s.controller === 'human',
        ).length,
        count,
      )
      assert.equal(
        Object.values(state.board!.seats).filter(
          (s) => s.controller === 'computer',
        ).length,
        4 - count,
      )
      assert.ok(
        Object.values(state.board!.seats).every((s) => s.cardCount === 13),
      )
    }
    const dealt = views.flatMap((state) => state.hand)
    assert.equal(new Set(dealt).size, 13 * count)
    if (count === 4) assert.deepEqual(dealt.sort(), [...fixedDeck].sort())
  })
}

test('开局校验房主、入座、预期版本和阶段，拒绝响应不携带暗牌', (t) => {
  const room = table(t)
  assert.equal(room.start().status, 'illegal_action')
  accepted(room.seat(room.host, 'south'))
  const guest = room.joinRoom('牌友')
  const command = {
    kind: 'start',
    credential: room.host,
    code: room.code,
    expectedVersion: room.read().version,
    operationId: 'start',
  } as const
  assert.deepEqual(room.service.execute({ ...command, credential: guest }), {
    status: 'unauthorized',
    message: '只有房主可以开局。',
  })
  assert.equal(
    room.service.execute({ ...command, expectedVersion: 0 }).status,
    'stale_state',
  )
  const started = room.service.execute(command)
  const state = accepted(started)
  assert.deepEqual(room.service.execute(command), started)
  assert.deepEqual(
    room.service.execute({
      ...command,
      operationId: 'another',
      expectedVersion: state.version,
    }),
    { status: 'illegal_action', message: '本副已开始，不能重复开局。' },
  )
  assert.equal(
    room.service.execute({ ...command, credential: '房主' }).status,
    'unauthorized',
  )
  const outsider = room.service.issueIdentity()
  assert.equal(
    room.service.execute({ ...command, credential: outsider }).status,
    'unauthorized',
  )
  assert.equal(room.service.read(room.code, outsider).status, 'unauthorized')
  assert.deepEqual(room.read(), state)
  room.restart()
  assert.deepEqual(room.read(), state)
  assert.deepEqual(room.service.execute(command), started)
})

test('SQLite 操作记录写入失败时发牌一起回滚，重试只提交一副', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const room = table(t)
  accepted(room.seat(room.host, 'north'))
  const before = room.read()
  const database = new DatabaseSync(room.path)
  t.after(() => database.close())
  // 在真实存储边界注入写入故障，保证是在房间更新后、事务提交前失败。
  database.exec(
    "CREATE TRIGGER fail_operation BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'test storage failure'); END",
  )
  assert.equal(room.start().status, 'storage_failure')
  assert.deepEqual(room.read(), before)
  database.exec('DROP TRIGGER fail_operation')
  const result = accepted(room.start())
  assert.equal(result.version, before.version + 1)
  assert.equal(result.board?.number, 1)
  assert.deepEqual(room.read().hand, [
    'S2',
    'S3',
    'S4',
    'S5',
    'S6',
    'S7',
    'S8',
    'S9',
    'S10',
    'SJ',
    'SQ',
    'SK',
    'SA',
  ])
})
