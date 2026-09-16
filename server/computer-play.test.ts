import { test } from 'node:test'
import assert from 'node:assert/strict'
import { table, accepted } from './fixtures/computer-play.ts'
import { suggestPlay } from './computer/play-strategy.ts'

test('P01：明手公开前，无将从 QJT 连张顶张首攻', (t) => {
  const room = table(t, 'D1')
  const turn = room.service.computerPlayTurn(room.code)!
  assert.equal(turn.input.dummy, null)
  assert.equal(suggestPlay(turn.input)!.card, 'CQ')
  accepted(room.service.submitComputerPlay(turn, suggestPlay(turn.input)!))
  assert.equal(room.read().board!.turn, 'north')
  assert.equal(room.read().board!.dummy!.seat, 'north')
})

test('P03：第三家从 KQJ 使用最低足够大牌争墩', (t) => {
  const room = table(t, 'D1')
  room.play('west', 'D4')
  room.play('north', 'D2')
  const turn = room.service.computerPlayTurn(room.code)!
  assert.equal(suggestPlay(turn.input)!.card, 'DJ')
  accepted(room.service.submitComputerPlay(turn, suggestPlay(turn.input)!))
})

test('P05：第四家用现成赢张拿墩', (t) => {
  const room = table(t, 'D1')
  room.play('west', 'CQ'); room.play('north', 'C3'); room.play('east', 'C7')
  const turn = room.service.computerPlayTurn(room.code)!
  assert.ok(['CK', 'CA'].includes(suggestPlay(turn.input)!.card))
})

test('P04：第四家不盖住搭档已赢的牌', (t) => {
  const room = table(t, 'D5')
  for (const [seat, card] of [['west','H2'],['north','H5'],['east','H8'],['south','HQ'],['south','C2'],['west','CQ'],['north','C3']] as const) room.play(seat, card)
  const turn = room.service.computerPlayTurn(room.code)!
  assert.ok(['C7', 'C8'].includes(suggestPlay(turn.input)!.card))
})

test('P06：庄家控制明手，有强将配合时先吊将，随后轮到东', (t) => {
  const room = table(t, 'D2')
  for (const [seat, card] of [['west','D2'],['north','DJ'],['east','D5'],['south','D8']] as const) room.play(seat, card)
  const turn = room.service.computerPlayTurn(room.code)!
  assert.equal(turn.input.seat, 'south')
  assert.equal(turn.input.turn, 'north')
  assert.equal(suggestPlay(turn.input)!.rule, 'draw-trump')
  assert.ok(['S8','S9','S10'].includes(suggestPlay(turn.input)!.card))
  accepted(room.service.submitComputerPlay(turn, suggestPlay(turn.input)!))
  assert.equal(room.read().board!.turn, 'east')
})

test('P13：有将首攻优先非将单张，争取将吃', (t) => {
  const room = table(t, 'D6')
  const input = room.service.computerPlayTurn(room.code)!.input
  assert.equal(suggestPlay(input)!.card, 'D2')
})

test('真实 Worker 在真人坐明手时连续完成电脑做庄、防守、结算与自动准备', async (t) => {
  const { ComputerRunner } = await import('./computer/runner.ts')
  const room = table(t, 'D1')
  const updates: number[] = []
  const runner = new ComputerRunner(room.service, () => updates.push(room.read().version))
  t.after(() => runner.close())
  await runner.advance(room.code)
  assert.equal(room.read().board!.phase, 'scored')
  assert.equal(room.read().board!.tricks.length, 13)
  assert.equal(updates.length, 52)
  assert.equal(room.read().board!.seats.south.ready, true)
  assert.equal(room.read().board!.seats.north.ready, false)
  accepted(room.send({ kind: 'ready' }))
  await runner.advance(room.code)
  assert.equal(room.read().board!.number, 2)
  assert.equal(room.read().board!.turn, 'north')
})

test('电脑出牌拒绝伪造授权与过期版本，重复结果不重复推进', (t) => {
  const room = table(t, 'D1')
  const turn = room.service.computerPlayTurn(room.code)!
  const decision = suggestPlay(turn.input)!
  assert.equal(room.service.submitComputerPlay({ ...turn }, decision).status, 'unauthorized')
  assert.equal(room.service.submitComputerPlay(turn, { ...decision, version: -1 }).status, 'illegal_action')
  const guest = room.service.issueIdentity()
  accepted(room.service.execute({ kind: 'join', credential: guest, code: room.code, expectedVersion: room.read().version, operationId: 'guest', nickname: '等待' }))
  const before = room.read()
  assert.equal(room.service.submitComputerPlay(turn, decision).status, 'stale_state')
  assert.deepEqual(room.read(), before)
  const fresh = room.service.computerPlayTurn(room.code)!
  const next = suggestPlay(fresh.input)!
  const result = room.service.submitComputerPlay(fresh, next)
  accepted(result)
  assert.deepEqual(room.service.submitComputerPlay(fresh, next), result)
  assert.equal(room.read().board!.currentTrick.length, 1)
  // 授权绑定原始输入，篡改输入不能将行动权转给另一手牌。
  fresh.input.turn = 'south'
  assert.equal(room.service.submitComputerPlay(fresh, { ...next, seat: 'south' }).status, 'operation_conflict')
})

test('电脑出牌状态与操作记录同事务保存，失败回滚后能重试', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const room = table(t, 'D1')
  const turn = room.service.computerPlayTurn(room.code)!
  const decision = suggestPlay(turn.input)!
  const before = room.read()
  const db = new DatabaseSync(room.path)
  t.after(() => db.close())
  db.exec("CREATE TRIGGER fail_computer_play BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'fail'); END")
  assert.equal(room.service.submitComputerPlay(turn, decision).status, 'storage_failure')
  assert.deepEqual(room.read(), before)
  db.exec('DROP TRIGGER fail_computer_play')
  accepted(room.service.submitComputerPlay(turn, decision))
  const persisted = new (await import('./game-service.ts')).GameService(room.path)
  t.after(() => persisted.close())
  assert.deepEqual(accepted(persisted.read(room.code, room.credential)), room.read())
})

test('明手的电脑庄家失去控制权，即使版本不变也拒绝旧结果', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const room = table(t, 'D1')
  room.play('west', 'CQ')
  const turn = room.service.computerPlayTurn(room.code)!
  assert.equal(turn.input.seat, 'south')
  const db = new DatabaseSync(room.path)
  // 控制权交接的真实入口留给第 11 票；夹具单独验证提交时复查。
  const stored = JSON.parse(String(db.prepare('SELECT state FROM rooms WHERE code = ?').get(room.code)!.state))
  stored.board.occupants.south = stored.members[0].id
  db.prepare('UPDATE rooms SET state = ? WHERE code = ?').run(JSON.stringify(stored), room.code)
  db.close()
  assert.equal(room.service.submitComputerPlay(turn, suggestPlay(turn.input)!).status, 'unauthorized')
  assert.equal(room.service.computerPlayTurn(room.code), null)
  assert.equal(room.read().board!.currentTrick.length, 1)
})

test('另一房间计算期间仍能读写，真实 Worker 支持十桌独立连续出牌', async (t) => {
  const { ComputerRunner } = await import('./computer/runner.ts')
  // 每个服务持有十个房间，确保共享同一个 Worker 的实际并发路径。
  const { GameService } = await import('./game-service.ts')
  const { deals, parseHand } = await import('./fixtures/computer-play.ts')
  const service = new GameService(':memory:', { deck: () => deals.D1.flatMap(parseHand) })
  t.after(() => service.close())
  const runner = new ComputerRunner(service, () => {})
  t.after(() => runner.close())
  const rooms = Array.from({ length: 10 }, (_, i) => {
    const credential = service.issueIdentity()
    let state = accepted(service.execute({ kind: 'create', nickname: String(i), credential, operationId: 'create' }))
    let n = 0
    const send = (action: object) => state = accepted(service.execute({ code: state.code, credential, operationId: String(n++), expectedVersion: state.version, ...action }))
    send({ kind: 'seat', seat: 'west' })
    send({ kind: 'start' })
    return { code: state.code, credential }
  })
  const running = rooms.map(room => runner.advance(room.code))
  const other = service.issueIdentity()
  accepted(service.execute({ kind: 'create', credential: other, nickname: '计算期间建房', operationId: 'other' }))
  await Promise.all(running)
  const started = performance.now()
  let operation = 0
  for (let round = 0; round < 100; round++) {
    const states = rooms.map(room => accepted(service.read(room.code, room.credential)))
    if (states.every(state => state.board!.score)) break
    for (const [i, state] of states.entries()) {
      const board = state.board!
      if (board.score) continue
      assert.ok(board.legalCalls.length || board.legalCards.length, 'Worker 必须停在真人可操作处')
      accepted(service.execute({ code: state.code, credential: rooms[i].credential, expectedVersion: state.version, operationId: `human-${operation++}`, ...(board.phase === 'auction' ? { kind: 'call', call: { kind: 'pass' } } : { kind: 'play', seat: board.turn, card: board.legalCards[0] }) }))
    }
    await Promise.all(rooms.map(room => runner.advance(room.code)))
  }
  for (const room of rooms) {
    const state = accepted(service.read(room.code, room.credential))
    assert.equal(state.board!.phase, 'scored')
    assert.equal(state.board!.tricks.length, 13)
  }
  t.diagnostic(JSON.stringify({ rooms: 10, milliseconds: Math.round(performance.now() - started), rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024), node: process.version, platform: process.platform, arch: process.arch }))
})
