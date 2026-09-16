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

test('四家不叫自动零分结算，结束前隐藏四家原始手牌，结束后允许复盘', (t) => {
  const room = table(t)
  for (let i = 0; i < 3; i++) room.call({ kind: 'pass' })
  for (let i = 0; i < 4; i++)
    assert.equal(room.read(i).board!.reviewHands, null)
  const state = room.call({ kind: 'pass' })
  assert.deepEqual(state.scores, { 'north-south': 0, 'east-west': 0 })
  assert.deepEqual(state.board!.score, {
    declarerSide: null,
    declarerTricks: 0,
    requiredTricks: 0,
    vulnerable: false,
    items: [],
    declarerScore: 0,
    delta: { 'north-south': 0, 'east-west': 0 },
  })
  for (let i = 0; i < 4; i++) {
    const review = room.read(i).board!.reviewHands!
    for (let s = 0; s < 4; s++)
      assert.deepEqual(
        review[seats[s]],
        ranks.map((r) => `${suits[s]}${r}`),
      )
  }
  room.restart()
  assert.deepEqual(room.read(3), state)
})

test('十三墩后自动结算成约与超墩，累计按方位保存，公开原始手牌与记录', (t) => {
  const room = table(t)
  room.call({ kind: 'bid', level: 4, denomination: 'S' })
  for (let i = 0; i < 3; i++) room.call({ kind: 'pass' })
  for (let i = 0; i < 51; i++) {
    accepted(room.service.execute(room.nextPlay()))
    for (let who = 0; who < 4; who++)
      assert.equal(room.read(who).board!.reviewHands, null)
  }
  assert.equal(room.read().board!.score, null)
  const final = room.nextPlay()
  accepted(room.service.execute(final))
  const state = room.read()
  assert.equal(state.board!.phase, 'scored')
  assert.deepEqual(state.board!.score, {
    declarerSide: 'north-south',
    declarerTricks: 13,
    requiredTricks: 10,
    vulnerable: false,
    items: [
      { label: '定约墩分', points: 120 },
      { label: '超墩分（3 墩）', points: 90 },
      { label: '成局奖励', points: 300 },
    ],
    declarerScore: 510,
    delta: { 'north-south': 510, 'east-west': -510 },
  })
  assert.deepEqual(state.scores, { 'north-south': 510, 'east-west': -510 })
  for (let s = 0; s < 4; s++)
    assert.deepEqual(
      new Set(state.board!.reviewHands![seats[s]]),
      new Set(ranks.map((r) => `${suits[s]}${r}`)),
    )
  assert.equal(state.board!.tricks.length, 13)
  accepted(room.service.execute(final))
  room.restart()
  accepted(room.service.execute(final))
  assert.deepEqual(room.read(), state)
})

test('最后一张牌与宕墩结算同事务回滚，重试和确认丢失不重复扣分', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const room = table(t)
  room.call({ kind: 'bid', level: 1, denomination: 'NT' })
  for (let i = 0; i < 3; i++) room.call({ kind: 'pass' })
  for (let i = 0; i < 51; i++) accepted(room.service.execute(room.nextPlay()))
  const before = room.read()
  const final = room.nextPlay()
  const db = new DatabaseSync(room.path)
  t.after(() => db.close())
  db.exec(
    "CREATE TRIGGER fail_score BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'failure'); END",
  )
  assert.equal(room.service.execute(final).status, 'storage_failure')
  assert.deepEqual(room.read(), before)
  db.exec('DROP TRIGGER fail_score')
  const result = room.service.execute(final)
  accepted(result)
  assert.deepEqual(room.read().scores, {
    'north-south': -350,
    'east-west': 350,
  })
  assert.deepEqual(room.read().board!.score!.items, [
    { label: '宕墩罚分（7 墩）', points: -350 },
  ])
  assert.deepEqual(room.service.execute(final), result)
  assert.equal(
    room.service.execute({ ...final, operationId: 'stale' }).status,
    'stale_state',
  )
  assert.equal(
    room.service.execute({
      ...final,
      operationId: 'again',
      expectedVersion: room.read().version,
    }).status,
    'illegal_action',
  )
  room.restart()
  assert.deepEqual(room.service.execute(final), result)
})

test('东西做庄的加倍成约记入东西累计，南北对称扣分', (t) => {
  const room = table(t)
  room.call({ kind: 'pass' })
  room.call({ kind: 'bid', level: 4, denomination: 'H' })
  room.call({ kind: 'double' })
  for (let i = 0; i < 3; i++) room.call({ kind: 'pass' })
  for (let i = 0; i < 52; i++) accepted(room.service.execute(room.nextPlay()))
  assert.equal(room.read().board!.score!.declarerTricks, 13)
  // 240 定约墩分 + 300 超墩 + 300 成局 + 50 加倍成约。
  assert.deepEqual(room.read().scores, {
    'north-south': -890,
    'east-west': 890,
  })
})

test('旧版待结算存档升级一次，保留既有累计分并从出牌记录还原手牌', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const room = table(t)
  room.call({ kind: 'bid', level: 4, denomination: 'S' })
  for (let i = 0; i < 3; i++) room.call({ kind: 'pass' })
  for (let i = 0; i < 52; i++) accepted(room.service.execute(room.nextPlay()))
  const before = room.read()
  // 仅为旧存档兼容测试构造上一版持久化格式；验收仍读取公开入口。
  const db = new DatabaseSync(room.path)
  const row = db
    .prepare('SELECT state FROM rooms WHERE code = ?')
    .get(room.code)!
  const legacy = JSON.parse(String(row.state))
  delete legacy.board.score
  legacy.board.phase = 'awaiting-score'
  legacy.scores = { 'north-south': 100, 'east-west': -100 }
  db.prepare('UPDATE rooms SET state = ? WHERE code = ?').run(
    JSON.stringify(legacy),
    room.code,
  )
  db.close()
  room.restart()
  const recovered = room.read()
  assert.deepEqual(recovered.scores, { 'north-south': 610, 'east-west': -610 })
  assert.deepEqual(recovered.board, before.board)
  assert.equal(recovered.version, before.version + 1)
  room.restart()
  assert.deepEqual(room.read(), recovered)
})

test('最后一次不叫提交失败不公开手牌，重试零分结算仅生效一次', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const room = table(t)
  for (let i = 0; i < 3; i++) room.call({ kind: 'pass' })
  const before = room.read()
  const final = room.command(3, { kind: 'call', call: { kind: 'pass' } })
  const db = new DatabaseSync(room.path)
  t.after(() => db.close())
  db.exec(
    "CREATE TRIGGER fail_pass BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'failure'); END",
  )
  assert.equal(room.service.execute(final).status, 'storage_failure')
  assert.deepEqual(room.read(), before)
  assert.equal(room.read().board!.reviewHands, null)
  db.exec('DROP TRIGGER fail_pass')
  const result = room.service.execute(final)
  accepted(result)
  assert.deepEqual(room.service.execute(final), result)
  assert.deepEqual(room.read().scores, { 'north-south': 0, 'east-west': 0 })
  assert.equal(room.read().board!.auction.length, 4)
})
