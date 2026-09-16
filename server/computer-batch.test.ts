import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GameService } from './game-service.ts'
import { suggestAuction } from './computer/auction-strategy.ts'
import { suggestPlay } from './computer/play-strategy.ts'
import { accepted } from './fixtures/computer-play.ts'
import { seats, suits, ranks } from '../shared/protocol.ts'
import type { Card } from '../shared/protocol.ts'

// shuffle-v1：LCG32(seed+1, 1664525, 1013904223) + 降序 Fisher–Yates。
function deckFor(seed: number): Card[] {
  let random = seed + 1
  const deck = suits.flatMap(s => ranks.map(r => `${s}${r}` as Card))
  for (let i = 51; i > 0; i--) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0
    const j = random % (i + 1)
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}
const order = (card: Card) => 'CDHS'.indexOf(card[0]) * 13 + ranks.indexOf(card.slice(1) as typeof ranks[number])
for (const count of [1, 2, 3, 4]) test(`${count} 真人：固定种子 0～99 完成结算并进入下一副`, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-batch-'))
  let passedOut = 0, plays = 0
  try {
    for (let seed = 0; seed < 100; seed++) {
      const service = new GameService(join(dir, `${seed}.sqlite`), { deck: () => deckFor(seed) })
      try {
        const credentials = Array.from({ length: count }, () => service.issueIdentity())
        let state = accepted(service.execute({ kind: 'create', credential: credentials[0], nickname: '0', operationId: 'create' }))
        let sequence = 0
        const send = (who: number, action: object) => {
          const command = { code: state.code, credential: credentials[who], expectedVersion: state.version, operationId: String(sequence++), ...action }
          state = accepted(service.execute(command))
          return () => service.execute(command)
        }
        for (let i = 0; i < count; i++) {
          if (i) send(i, { kind: 'join', nickname: String(i) })
          send(i, { kind: 'seat', seat: seats[i] })
        }
        send(0, { kind: 'start' })
        let repeatLast: (() => unknown) | undefined
        for (let step = 0; !state.board!.score; step++) {
          assert.ok(step < 200, `人数 ${count} 种子 ${seed} 未结束`)
          const before = state.version
          const auction = service.computerTurn(state.code)
          const play = service.computerPlayTurn(state.code)
          if (auction) {
            const decision = suggestAuction(auction.input)!
            assert.ok(auction.input.legalCalls.some(call => JSON.stringify(call) === JSON.stringify(decision.call)))
            repeatLast = () => service.submitComputerCall(auction, decision)
            state = accepted(service.submitComputerCall(auction, decision))
          } else if (play) {
            const decision = suggestPlay(play.input)!
            assert.ok(play.input.legalCards.includes(decision.card))
            repeatLast = () => service.submitComputerPlay(play, decision)
            state = accepted(service.submitComputerPlay(play, decision))
          } else {
            const board = state.board!
            const controller = board.phase === 'auction' ? board.turn! : board.dummy?.seat === board.turn ? board.contract!.declarer : board.turn!
            const who = seats.indexOf(controller)
            assert.ok(who < count)
            const view = accepted(service.read(state.code, credentials[who]))
            repeatLast = send(who, board.phase === 'auction' ? { kind: 'call', call: { kind: 'pass' } } : { kind: 'play', seat: board.turn, card: [...view.board!.legalCards].sort((a,b) => order(a)-order(b))[0] })
          }
          assert.equal(state.version, before + 1)
        }
        if (state.board!.phase === 'passed-out') passedOut++
        else {
          plays++
          const cards = state.board!.tricks.flatMap(trick => trick.cards)
          assert.equal(cards.length, 52)
          assert.equal(new Set(cards.map(entry => entry.card)).size, 52)
        }
        const completed = accepted(service.read(state.code, credentials[0]))
        repeatLast!()
        assert.deepEqual(accepted(service.read(state.code, credentials[0])), completed)
        assert.equal(completed.scores['north-south'], completed.board!.score!.delta['north-south'])
        for (const seat of seats.slice(count)) assert.equal(completed.board!.seats[seat].ready, true)
        for (let who = 0; who < count; who++) {
          assert.equal(state.board!.number, 1)
          const repeat = send(who, { kind: 'ready' })
          repeat()
        }
        assert.equal(state.board!.number, 2)
        assert.equal(state.board!.phase, 'auction')
        assert.deepEqual(state.scores, completed.scores)
        assert.equal(state.board!.score, null)
        assert.equal(state.board!.tricks.length, 0)
      } finally { service.close() }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
  t.diagnostic(JSON.stringify({ humans: count, seeds: '0–99', completed: 100, played: plays, passedOut, nextBoard: 100 }))
})
