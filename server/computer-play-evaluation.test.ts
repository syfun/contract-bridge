import { test } from 'node:test'
import assert from 'node:assert/strict'
import { table, accepted } from './fixtures/computer-play.ts'
import { suggestPlay } from './computer/play-strategy.ts'
import type { Card, Seat } from '../shared/protocol.ts'

type Check = { id: string; deal: Parameters<typeof table>[1]; prefix: [Seat, Card][]; allowed: Card[] }
const checks: Check[] = [
  { id: 'P01', deal: 'D1', prefix: [], allowed: ['CQ'] },
  { id: 'P02', deal: 'D1', prefix: [['west','D4']], allowed: ['D2','D3'] },
  { id: 'P03', deal: 'D1', prefix: [['west','D4'],['north','D2']], allowed: ['DJ'] },
  { id: 'P04', deal: 'D5', prefix: [['west','H2'],['north','H5'],['east','H8'],['south','HQ'],['south','C2'],['west','CQ'],['north','C3']], allowed: ['C7','C8'] },
  { id: 'P05', deal: 'D1', prefix: [['west','CQ'],['north','C3'],['east','C7']], allowed: ['CK','CA'] },
  { id: 'P06', deal: 'D2', prefix: [['west','D2'],['north','DJ'],['east','D5'],['south','D8']], allowed: ['S8','S9','S10'] },
  { id: 'P07', deal: 'D3', prefix: [['west','CQ'],['north','C3'],['east','C7'],['south','CK'],['south','S5'],['west','S2']], allowed: ['SJ','SQ'] },
  { id: 'P08', deal: 'D4', prefix: [['west','C2'],['north','C3'],['east','CQ'],['south','CK'],['south','CA'],['west','C8'],['north','C4'],['east','CJ'],['south','D8'],['west','D2'],['north','DJ'],['east','D5'],['north','C5'],['east','C10']], allowed: ['SA','SK','SQ','SJ','S10'] },
  { id: 'P13', deal: 'D6', prefix: [], allowed: ['D2'] },
]
for (const check of checks) test(`${check.id}：固定基础打牌评估重复 20 次`, (t) => {
  const room = table(t, check.deal)
  for (const [seat, card] of check.prefix) room.play(seat, card)
  const turn = room.service.computerPlayTurn(room.code)!
  const original = structuredClone(turn.input)
  const decision = suggestPlay(turn.input)!
  for (let i = 0; i < 20; i++) {
    const actual = suggestPlay(turn.input)!
    assert.deepEqual(actual, decision)
    assert.ok(check.allowed.includes(actual.card))
    assert.ok(turn.input.legalCards.includes(actual.card))
    assert.deepEqual(turn.input, original)
  }
  accepted(room.service.submitComputerPlay(turn, decision))
  t.diagnostic(JSON.stringify({ id: check.id, deal: check.deal, input: original, decision, result: '20/20' }))
})

test('P09：电脑必须跟牌，提交其他花色被拒绝且状态不变', (t) => {
  const room = table(t, 'D1')
  room.play('west', 'D4'); room.play('north', 'D2'); room.play('east', 'DJ')
  const turn = room.service.computerPlayTurn(room.code)!
  assert.deepEqual(new Set(turn.input.legalCards), new Set(['D10','D9','D8','D7']))
  const decision = suggestPlay(turn.input)!
  assert.ok(turn.input.legalCards.includes(decision.card))
  const before = room.read()
  assert.equal(room.service.submitComputerPlay(turn, { ...decision, card: 'HA' }).status, 'illegal_action')
  assert.deepEqual(room.read(), before)
  accepted(room.service.submitComputerPlay(turn, decision))
  t.diagnostic(JSON.stringify({ id: 'P09', input: turn.input, decision, result: '非法跟牌拒绝且状态不变；合法牌接受' }))
})

test('P10：明手真人不能独立行动，电脑庄家只能操作当前明手', (t) => {
  const room = table(t, 'D2')
  for (const [seat, card] of checks.find(check => check.id === 'P06')!.prefix) room.play(seat, card)
  const turn = room.service.computerPlayTurn(room.code)!
  const decision = suggestPlay(turn.input)!
  const before = room.read()
  assert.equal(room.service.submitComputerPlay(turn, { ...decision, seat: 'south', card: 'SA' }).status, 'unauthorized')
  assert.equal(room.send({ kind: 'play', seat: 'north', card: 'S8' }).status, 'unauthorized')
  assert.deepEqual(room.read(), before)
  accepted(room.service.submitComputerPlay(turn, decision))
  assert.equal(room.read().board!.turn, 'east')
  t.diagnostic(JSON.stringify({ id: 'P10', input: turn.input, decision, result: '明手越权拒绝；庄家控制明手接受；下一家东' }))
})

for (const [id, deal, swap, prefix, allowed] of [
  ['P11', 'D3', ['SK','S8'], checks.find(c => c.id === 'P07')!.prefix, ['SJ','SQ']],
  ['P12', 'D1', ['SK','S6'], [], ['CQ']],
] as const) test(`${id}：交换暗牌，可见输入和 20 次建议均不变`, (t) => {
  const a = table(t, deal), b = table(t, deal, [...swap])
  for (const room of [a, b]) for (const [seat, card] of prefix) room.play(seat, card)
  const left = a.service.computerPlayTurn(a.code)!.input
  const right = b.service.computerPlayTurn(b.code)!.input
  assert.deepEqual(left, right)
  assert.deepEqual(Object.keys(left).sort(), ['auction','contract','currentTrick','dummy','hand','legalCards','seat','tricks','turn','version','vulnerability'])
  for (let i = 0; i < 20; i++) {
    const decision = suggestPlay(left)!
    assert.deepEqual(decision, suggestPlay(right))
    assert.ok((allowed as readonly string[]).includes(decision.card))
  }
  t.diagnostic(JSON.stringify({ id, input: left, decision: suggestPlay(left), result: '20/20 输入与结果相同' }))
})
