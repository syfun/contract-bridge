import { ranks, seats } from '../shared/protocol.ts'
import type { Card, Seat } from '../shared/protocol.ts'
import type { StoredBoard } from './deal.ts'

export function dummySeat(board: StoredBoard): Seat | null {
  return board.contract
    ? seats[(seats.indexOf(board.contract.declarer) + 2) % 4]
    : null
}
export function seatController(
  board: StoredBoard,
  seat: Seat,
  computerMembers: readonly string[] = [],
): string | null {
  const owner = board.occupants[seat]
  return owner && computerMembers.includes(owner) ? null : owner
}
export function playController(
  board: StoredBoard,
  seat = board.turn,
  computerMembers: readonly string[] = [],
): string | null {
  if (!seat || !board.contract) return null
  return seatController(board, seat === dummySeat(board) ? board.contract.declarer : seat, computerMembers)
}
export function legalCards(board: StoredBoard): Card[] {
  if (!board.turn || !['opening-lead', 'playing'].includes(board.phase))
    return []
  const hand = board.hands[board.turn]
  const suit = board.currentTrick?.[0]?.card[0]
  const following = hand.filter((card) => card[0] === suit)
  return [...(following.length ? following : hand)]
}
export function applyPlay(board: StoredBoard, seat: Seat, card: Card): boolean {
  if (seat !== board.turn || !legalCards(board).includes(card)) return false
  board.hands[seat].splice(board.hands[seat].indexOf(card), 1)
  const current = (board.currentTrick ??= [])
  current.push({ seat, card })
  board.phase = 'playing'
  board.turn = seats[(seats.indexOf(seat) + 1) % 4]
  if (current.length === 4) {
    const trump = board.contract!.denomination
    let winner = current[0]
    for (const entry of current.slice(1)) {
      if (
        (entry.card[0] === winner.card[0] &&
          ranks.indexOf(entry.card.slice(1) as (typeof ranks)[number]) >
            ranks.indexOf(winner.card.slice(1) as (typeof ranks)[number])) ||
        (entry.card[0] === trump && winner.card[0] !== trump)
      )
        winner = entry
    }
    const tricks = (board.tricks ??= [])
    tricks.push({ cards: current, winner: winner.seat })
    board.currentTrick = []
    board.turn = winner.seat
    if (tricks.length === 13) {
      board.phase = 'awaiting-score'
      board.turn = null
    }
  }
  return true
}
