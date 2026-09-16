import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GameService } from './game-service.ts'
import { seats, suits, ranks } from '../shared/protocol.ts'
import type { Card, Denomination, Result, Seat } from '../shared/protocol.ts'

function accepted(result: Result) {
  if (result.status !== 'accepted') assert.fail(result.message)
  return result.state
}
function table(
  t: TestContext,
  denomination: Denomination = 'NT',
  deck = suits.flatMap((s) => ranks.map((r) => `${s}${r}` as Card)),
) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-play-'))
  const path = join(dir, 'game.sqlite')
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
  accepted(
    service.execute(
      command(0, {
        kind: 'call',
        call: { kind: 'bid', level: 1, denomination },
      }),
    ),
  )
  for (let i = 1; i < 4; i++)
    accepted(
      service.execute(command(i, { kind: 'call', call: { kind: 'pass' } })),
    )
  return {
    read,
    command,
    path,
    get service() {
      return service
    },
    play(
      seat: Seat,
      card: Card,
      i = seat === 'south' ? 0 : seats.indexOf(seat),
    ) {
      return accepted(service.execute(command(i, { kind: 'play', seat, card })))
    },
    restart() {
      service.close()
      service = new GameService(path)
    },
  }
}

test('首攻后公开明手，仅庄家能控制明手，连续十三墩完成并结算', (t) => {
  const room = table(t)
  assert.equal(room.read().board!.dummy, null)
  room.play('east', 'H2')
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(room.read(i).board!.dummy, {
      seat: 'south',
      hand: ranks.map((r) => `D${r}`),
    })
    assert.equal(room.read(i).hand.length, i === 1 ? 12 : 13)
  }
  assert.deepEqual(room.read(2).board!.legalCards, [])
  assert.equal(
    room.service.execute(
      room.command(2, { kind: 'play', seat: 'south', card: 'D2' }),
    ).status,
    'unauthorized',
  )
  room.play('south', 'D2')
  room.play('west', 'C2')
  room.play('north', 'SA')
  assert.equal(room.read().board!.tricks[0].winner, 'east')
  assert.equal(room.read().board!.turn, 'east')
  for (let i = 1; i < 13; i++) {
    room.play('east', `H${ranks[i]}`)
    room.play('south', `D${ranks[i]}`)
    room.play('west', `C${ranks[i]}`)
    room.play('north', `S${ranks[i - 1]}`)
  }
  const state = room.read()
  assert.equal(state.board!.phase, 'scored')
  assert.equal(state.board!.turn, null)
  assert.equal(state.board!.tricks.length, 13)
  assert.deepEqual(
    state.board!.tricks.map((t) => t.winner),
    Array(13).fill('east'),
  )
  assert.deepEqual(state.board!.legalCards, [])
  room.restart()
  assert.deepEqual(room.read(), state)
})

function arranged(first: Card[][]) {
  const used = new Set(first.flat())
  const rest = suits
    .flatMap((s) => ranks.map((r) => `${s}${r}` as Card))
    .filter((c) => !used.has(c))
  return first.flatMap((hand) => [...hand, ...rest.splice(0, 13 - hand.length)])
}

test('强制跟牌、越轮次与重复牌被拒绝，将吃及超将吃后由赢墩方首引', (t) => {
  // 北持黑桃和梅花，南只持梅花与红桃，西只持方块与红桃。
  const deck: Card[] = [
    ...ranks.slice(1).map((r) => `S${r}` as Card),
    'C2',
    'S2',
    ...ranks.slice(2).map((r) => `D${r}` as Card),
    'H2',
    ...ranks.slice(1).map((r) => `C${r}` as Card),
    'H3',
    'D2',
    'D3',
    ...ranks.slice(2).map((r) => `H${r}` as Card),
  ]
  const room = table(t, 'H', deck)
  const before = room.read()
  assert.equal(
    room.service.execute(
      room.command(0, { kind: 'play', seat: 'north', card: 'SA' }),
    ).status,
    'illegal_action',
  )
  assert.deepEqual(room.read(), before)
  room.play('east', 'S2')
  room.play('south', 'H3')
  room.play('west', 'HA')
  assert.deepEqual(
    room.read().board!.legalCards,
    ranks.slice(1).map((r) => `S${r}`),
  )
  const following = room.read()
  assert.equal(
    room.service.execute(
      room.command(0, { kind: 'play', seat: 'north', card: 'C2' }),
    ).status,
    'illegal_action',
  )
  assert.deepEqual(room.read(), following)
  room.play('north', 'SA')
  assert.equal(room.read().board!.tricks[0].winner, 'west')
  assert.equal(room.read().board!.turn, 'west')
  assert.equal(
    room.service.execute(
      room.command(3, { kind: 'play', seat: 'west', card: 'HA' }),
    ).status,
    'illegal_action',
  )
})

test('同花色 A 赢 K，下一墩由 10 赢 9', (t) => {
  const room = table(
    t,
    'NT',
    arranged([
      ['HA', 'D9'],
      ['H9', 'D10'],
      ['HK', 'D2'],
      ['H10', 'D3'],
    ]),
  )
  room.play('east', 'H9')
  room.play('south', 'HK')
  room.play('west', 'H10')
  room.play('north', 'HA')
  assert.equal(room.read().board!.tricks[0].winner, 'north')
  room.play('north', 'D9')
  room.play('east', 'D10')
  room.play('south', 'D2')
  room.play('west', 'D3')
  assert.equal(room.read().board!.tricks[1].winner, 'east')
})

test('出牌提交失败回滚，重试、重启和过期版本不会重复出牌，操作内容参与去重', async (t) => {
  const { DatabaseSync } = await import('node:sqlite')
  const room = table(t)
  const command = room.command(1, { kind: 'play', seat: 'east', card: 'H2' })
  const before = room.read()
  const db = new DatabaseSync(room.path)
  t.after(() => db.close())
  db.exec(
    "CREATE TRIGGER fail_play BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'failure'); END",
  )
  assert.equal(room.service.execute(command).status, 'storage_failure')
  assert.deepEqual(room.read(), before)
  db.exec('DROP TRIGGER fail_play')
  const first = room.service.execute(command)
  accepted(first)
  assert.deepEqual(room.service.execute(command), first)
  assert.equal(
    room.service.execute({ ...command, card: 'H3' }).status,
    'operation_conflict',
  )
  assert.equal(
    room.service.execute({ ...command, operationId: 'stale' }).status,
    'stale_state',
  )
  room.restart()
  assert.deepEqual(room.service.execute(command), first)
  room.play('south', 'D2')
  assert.equal(
    accepted(room.service.execute(command)).board!.currentTrick.length,
    2,
  )
  const foreign = room.service.issueIdentity()
  assert.equal(
    room.service.execute({
      ...room.command(3, { kind: 'play', seat: 'west', card: 'C2' }),
      credential: foreign,
    }).status,
    'unauthorized',
  )
})
