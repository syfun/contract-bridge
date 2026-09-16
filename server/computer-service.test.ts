import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GameService } from './game-service.ts'
import { suggestAuction } from './computer/auction-strategy.ts'
import { suits, ranks } from '../shared/protocol.ts'
import type { Card, Result } from '../shared/protocol.ts'
const accepted = (result: Result) => {
  if (result.status !== 'accepted') assert.fail(result.message)
  return result.state
}
function table(t: TestContext, swap = false) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-computer-'))
  const path = join(dir, 'room.sqlite')
  const north: Card[] = [
    'SA',
    'SK',
    'S3',
    'HQ',
    'HJ',
    'H4',
    'DK',
    'DQ',
    'D3',
    'D2',
    'CJ',
    'C5',
    'C4',
  ]
  const deck = [
    ...north,
    ...suits
      .flatMap((s) => ranks.map((r) => `${s}${r}` as Card))
      .filter((card) => !north.includes(card)),
  ]
  if (swap) [deck[13], deck[26]] = [deck[26], deck[13]]
  const service = new GameService(path, { deck: () => deck })
  t.after(() => {
    service.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const credential = service.issueIdentity()
  const code = accepted(
    service.execute({
      kind: 'create',
      credential,
      nickname: '真人',
      operationId: 'create',
    }),
  ).code
  const read = () => accepted(service.read(code, credential))
  let n = 0
  const send = (action: object) =>
    service.execute({
      code,
      credential,
      expectedVersion: read().version,
      operationId: `op${n++}`,
      ...action,
    })
  accepted(send({ kind: 'seat', seat: 'west' }))
  accepted(send({ kind: 'start' }))
  return { service, code, credential, path, read, send }
}
test('电脑仅取自己的合法可见输入，建议经服务校验并持久推进', (t) => {
  const room = table(t)
  const turn = room.service.computerTurn(room.code)!
  assert.deepEqual(turn.input.hand, [
    'SA',
    'SK',
    'S3',
    'HQ',
    'HJ',
    'H4',
    'DK',
    'DQ',
    'D3',
    'D2',
    'CJ',
    'C5',
    'C4',
  ])
  assert.deepEqual(Object.keys(turn.input).sort(), [
    'auction',
    'dealer',
    'hand',
    'legalCalls',
    'seat',
    'version',
    'vulnerability',
  ])
  const initialHand = room.read().hand
  const decision = suggestAuction(turn.input)!
  accepted(room.service.submitComputerCall(turn, decision))
  assert.deepEqual(room.read().board!.auction[0].call, decision.call)
  assert.equal(room.read().board!.turn, 'east')
  assert.deepEqual(room.read().hand, initialHand)
  assert.ok(!JSON.stringify(room.read()).includes('HCP'))
})

test('改变隐藏手牌后电脑输入与重复建议不变', (t) => {
  const a = table(t),
    b = table(t, true)
  const left = a.service.computerTurn(a.code)!.input
  const right = b.service.computerTurn(b.code)!.input
  assert.deepEqual(left, right)
  for (let i = 0; i < 20; i++)
    assert.deepEqual(suggestAuction(left), suggestAuction(right))
})

test('旧版本与伪造授权不能推进；非法叫品不保存，重复提交只执行一次', (t) => {
  const room = table(t)
  const turn = room.service.computerTurn(room.code)!
  const decision = suggestAuction(turn.input)!
  assert.equal(
    room.service.submitComputerCall({ ...turn }, decision).status,
    'unauthorized',
  )
  assert.equal(
    room.send({ kind: 'call', call: decision.call, computer: true }).status,
    'illegal_action',
  )
  assert.equal(
    room.service.submitComputerCall(turn, {
      ...decision,
      call: { kind: 'double' },
    }).status,
    'illegal_action',
  )
  const credential = room.service.issueIdentity()
  accepted(
    room.service.execute({
      kind: 'join',
      code: room.code,
      credential,
      nickname: '等待',
      operationId: 'join',
      expectedVersion: room.read().version,
    }),
  )
  assert.equal(
    room.service.submitComputerCall(turn, decision).status,
    'stale_state',
  )
  const fresh = room.service.computerTurn(room.code)!
  const first = room.service.submitComputerCall(
    fresh,
    suggestAuction(fresh.input)!,
  )
  accepted(first)
  assert.deepEqual(
    room.service.submitComputerCall(fresh, suggestAuction(fresh.input)!),
    first,
  )
  assert.equal(room.read().board!.auction.length, 1)
})

test('电脑操作写入失败与牌局一起回滚，恢复存储后可重试', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const room = table(t)
  const turn = room.service.computerTurn(room.code)!
  const decision = suggestAuction(turn.input)!
  const before = room.read()
  const db = new DatabaseSync(room.path)
  t.after(() => db.close())
  db.exec(
    "CREATE TRIGGER fail_computer BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'fail'); END",
  )
  assert.equal(
    room.service.submitComputerCall(turn, decision).status,
    'storage_failure',
  )
  assert.deepEqual(room.read(), before)
  db.exec('DROP TRIGGER fail_computer')
  accepted(room.service.submitComputerCall(turn, decision))
  assert.equal(room.read().board!.auction.length, 1)
})

test('取得输入后控制权变化，即使存档版本未改变也拒绝旧电脑结果', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const room = table(t)
  const turn = room.service.computerTurn(room.code)!
  const db = new DatabaseSync(room.path)
  // 控制权交接接口由第 11 票实现；此处以存档夹具模拟交接防线。
  const state = JSON.parse(
    String(
      db.prepare('SELECT state FROM rooms WHERE code = ?').get(room.code)!
        .state,
    ),
  )
  state.board.occupants.north = state.members[0].id
  db.prepare('UPDATE rooms SET state = ? WHERE code = ?').run(
    JSON.stringify(state),
    room.code,
  )
  db.close()
  assert.equal(
    room.service.submitComputerCall(turn, suggestAuction(turn.input)!).status,
    'unauthorized',
  )
  assert.equal(room.service.computerTurn(room.code), null)
  assert.equal(room.read().board!.auction.length, 0)
})

test('真实 Worker 自动叫牌至真人行动，计算期间的新版本重新取输入', async (t) => {
  const { ComputerRunner } = await import('./computer/runner.ts')
  const room = table(t)
  const updates: number[] = []
  const runner = new ComputerRunner(room.service, (code) => {
    assert.equal(code, room.code)
    updates.push(room.read().version)
  })
  t.after(() => runner.close())
  const pending = runner.advance(room.code)
  const credential = room.service.issueIdentity()
  accepted(
    room.service.execute({
      kind: 'join',
      code: room.code,
      credential,
      nickname: '计算期间加入',
      operationId: 'join-during-compute',
      expectedVersion: room.read().version,
    }),
  )
  await pending
  assert.equal(room.read().board!.turn, 'west')
  assert.equal(room.read().board!.auction.length, 3)
  assert.equal(updates.length, 3)
  assert.ok(room.read().board!.auction.some((e) => e.call.kind === 'bid'))
})

test('一至四真人的固定发牌叫牌可结束，建议合法且每次只推进一个版本', (t) => {
  for (const count of [1, 2, 3, 4])
    for (let seed = 0; seed < 20; seed++) {
      let random = seed + 1
      const deck = suits.flatMap((s) => ranks.map((r) => `${s}${r}` as Card))
      for (let i = deck.length - 1; i > 0; i--) {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0
        const j = random % (i + 1)
        ;[deck[i], deck[j]] = [deck[j], deck[i]]
      }
      const service = new GameService(':memory:', { deck: () => deck })
      t.after(() => service.close())
      const credentials = Array.from({ length: count }, () =>
        service.issueIdentity(),
      )
      let state = accepted(
        service.execute({
          kind: 'create',
          nickname: '0',
          credential: credentials[0],
          operationId: 'create',
        }),
      )
      const order = ['north', 'east', 'south', 'west'] as const
      let operation = 0
      const send = (who: number, action: object) => {
        const result = service.execute({
          code: state.code,
          credential: credentials[who],
          operationId: String(operation++),
          expectedVersion: state.version,
          ...action,
        })
        state = accepted(result)
      }
      for (let i = 0; i < count; i++) {
        if (i) send(i, { kind: 'join', nickname: String(i) })
        send(i, { kind: 'seat', seat: order[i] })
      }
      send(0, { kind: 'start' })
      for (let step = 0; state.board!.phase === 'auction'; step++) {
        assert.ok(step < 100, `人数${count} 种子${seed} 叫牌未结束`)
        const version = state.version
        const job = service.computerTurn(state.code)
        if (job) {
          const result = service.submitComputerCall(
            job,
            suggestAuction(job.input)!,
          )
          state = accepted(result)
        } else
          send(order.indexOf(state.board!.turn!), {
            kind: 'call',
            call: { kind: 'pass' },
          })
        assert.equal(state.version, version + 1)
      }
      assert.ok(['opening-lead', 'passed-out'].includes(state.board!.phase))
    }
})
