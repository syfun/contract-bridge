import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import { GameService } from '../game-service.ts'
import { conventionVersion } from '../../shared/conventions.ts'
import { suits } from '../../shared/protocol.ts'
import type { Card, Call, Result, Seat } from '../../shared/protocol.ts'

export const deals = {
  D1: ['KQJ/765/A32/6543', 'T98/JT98/KQJ/987', 'A76/AKQ/T987/AK2', '5432/432/654/QJT'],
  D2: ['T98/A32/KQJ/7654', '765/JT98/765/QJT', 'AKQJ/KQ/AT98/AK2', '432/7654/432/983'],
  D3: ['AQJ/765/A32/6543', 'T98/JT98/KQJ/987', '765/AKQ/T987/AK2', 'K432/432/654/QJT'],
  D4: ['98/A32/KQJ/76543', '765/JT98/765/QJT', 'AKQJT/KQ/AT98/AK', '432/7654/432/982'],
  D5: ['KQJ/765/A32/6543', 'T98/JT98/KQJ/A87', 'A76/AKQ/T987/K92', '5432/432/654/QJT'],
  D6: ['T98/A32/KQJ43/76', '765/JT98/765/QJT', 'AKQJ/KQ/AT98/AK2', '432/7654/2/98543'],
} as const
export function parseHand(hand: string): Card[] {
  return hand.split('/').flatMap((cards, i) => [...cards].map(r => `${suits[i]}${r === 'T' ? '10' : r}` as Card))
}
export function accepted(result: Result) {
  if (result.status !== 'accepted') assert.fail(result.message)
  return result.state
}
export function table(t: TestContext, id: keyof typeof deals, swap?: [Card, Card]) {
  const deck = deals[id].flatMap(parseHand)
  if (swap) {
    const [a, b] = swap.map(card => deck.indexOf(card))
    ;[deck[a], deck[b]] = [deck[b], deck[a]]
  }
  const dir = mkdtempSync(join(tmpdir(), 'bridge-play-computer-'))
  const path = join(dir, 'room.sqlite')
  const service = new GameService(path, { deck: () => deck })
  t.after(() => { service.close(); rmSync(dir, { recursive: true, force: true }) })
  const credential = service.issueIdentity()
  const code = accepted(service.execute({ kind: 'create', nickname: '北家真人', credential, operationId: 'create' })).code
  const read = () => accepted(service.read(code, credential))
  let operation = 0
  const send = (action: object) => service.execute({ credential, code, expectedVersion: read().version, operationId: String(operation++), ...action })
  accepted(send({ kind: 'seat', seat: 'north' }))
  accepted(send({ kind: 'start' }))
  // 固定评估要求南发牌、双方无局；仅调整初始元数据，所有前缀通过公开操作重放。
  const db = new DatabaseSync(path)
  const room = JSON.parse(String(db.prepare('SELECT state FROM rooms WHERE code = ?').get(code)!.state))
  room.board.dealer = room.board.turn = 'south'
  db.prepare('UPDATE rooms SET state = ? WHERE code = ?').run(JSON.stringify(room), code)
  db.close()
  const call = (call: Call) => {
    const turn = service.computerTurn(code)
    return accepted(turn ? service.submitComputerCall(turn, { call, rule: 'G05', version: turn.input.version, conventionVersion, reason: '固定合法前缀' }) : send({ kind: 'call', call }))
  }
  call({ kind: 'bid', level: ['D2','D4','D6'].includes(id) ? 4 : 3, denomination: ['D2','D4','D6'].includes(id) ? 'S' : 'NT' })
  for (let i = 0; i < 3; i++) call({ kind: 'pass' })
  const play = (seat: Seat, card: Card) => {
    const turn = service.computerPlayTurn(code)!
    assert.equal(turn.input.turn, seat)
    return accepted(service.submitComputerPlay(turn, { seat, card, rule: 'play-low', version: turn.input.version, conventionVersion, reason: '固定合法前缀' }))
  }
  return { service, code, path, credential, read, send, play }
}
