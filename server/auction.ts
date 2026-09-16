import { denominations, seats } from '../shared/protocol.ts'
import type { Call, Seat } from '../shared/protocol.ts'
import type { StoredBoard } from './deal.ts'

type Bid = Extract<Call, { kind: 'bid' }>
const nextSeat = (seat: Seat): Seat => seats[(seats.indexOf(seat) + 1) % 4]
const sameSide = (a: Seat, b: Seat) =>
  seats.indexOf(a) % 2 === seats.indexOf(b) % 2
const bidRank = (bid: Bid) =>
  (bid.level - 1) * 5 + denominations.indexOf(bid.denomination)

export function isCall(value: unknown): value is Call {
  if (!value || typeof value !== 'object' || !('kind' in value)) return false
  if (
    value.kind === 'pass' ||
    value.kind === 'double' ||
    value.kind === 'redouble'
  )
    return true
  return (
    value.kind === 'bid' &&
    'level' in value &&
    typeof value.level === 'number' &&
    Number.isInteger(value.level) &&
    value.level >= 1 &&
    value.level <= 7 &&
    'denomination' in value &&
    denominations.some((denomination) => denomination === value.denomination)
  )
}
export function legalCalls(board: StoredBoard): Call[] {
  if (board.phase !== 'auction' || !board.turn) return []
  const lastBid = (board.auction ?? []).findLast(
    (entry) => entry.call.kind === 'bid',
  )
  const minimum = lastBid?.call.kind === 'bid' ? bidRank(lastBid.call) : -1
  const calls: Call[] = [{ kind: 'pass' }]
  const lastAction = (board.auction ?? []).findLast(
    (entry) => entry.call.kind !== 'pass',
  )
  if (lastAction?.call.kind === 'bid' && !sameSide(board.turn, lastAction.seat))
    calls.push({ kind: 'double' })
  if (
    lastAction?.call.kind === 'double' &&
    !sameSide(board.turn, lastAction.seat)
  )
    calls.push({ kind: 'redouble' })
  for (let level = 1; level <= 7; level++) {
    for (const denomination of denominations) {
      const bid: Bid = { kind: 'bid', level, denomination }
      if (bidRank(bid) > minimum) calls.push(bid)
    }
  }
  return calls
}
export function applyCall(board: StoredBoard, call: Call): boolean {
  const legal = legalCalls(board).find(
    (candidate) =>
      candidate.kind === call.kind &&
      (candidate.kind !== 'bid' ||
        (call.kind === 'bid' &&
          candidate.level === call.level &&
          candidate.denomination === call.denomination)),
  )
  if (!legal || !board.turn) return false
  board.auction ??= []
  board.auction.push({ seat: board.turn, call: legal })
  board.turn = nextSeat(board.turn)
  const lastBid = board.auction.findLast((entry) => entry.call.kind === 'bid')
  if (!lastBid && board.auction.length === 4) {
    board.phase = 'passed-out'
    board.turn = null
  } else if (
    lastBid?.call.kind === 'bid' &&
    board.auction.slice(-3).every((entry) => entry.call.kind === 'pass')
  ) {
    const denomination = lastBid.call.denomination
    const declarer = board.auction.find(
      (entry) =>
        sameSide(entry.seat, lastBid.seat) &&
        entry.call.kind === 'bid' &&
        entry.call.denomination === denomination,
    )!.seat
    const openingLeader = nextSeat(declarer)
    const lastAction = board.auction.findLast(
      (entry) => entry.call.kind !== 'pass',
    )!
    const doubling =
      lastAction.call.kind === 'redouble'
        ? 'redoubled'
        : lastAction.call.kind === 'double'
          ? 'doubled'
          : 'undoubled'
    board.contract = {
      level: lastBid.call.level,
      denomination,
      doubling,
      declarer,
      openingLeader,
    }
    board.phase = 'opening-lead'
    board.turn = openingLeader
  }
  return true
}
