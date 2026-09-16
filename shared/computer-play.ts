import type { AuctionEntry, BoardView, Card, Contract, PlayEntry, Seat, Trick } from './protocol.ts'

export interface PlayInput {
  version: number
  // seat 为电脑控制者，turn 为当前行动手牌（可能是明手）。
  seat: Seat
  turn: Seat
  hand: Card[]
  dummy: { seat: Seat; hand: Card[] } | null
  contract: Contract
  vulnerability: BoardView['vulnerability']
  auction: AuctionEntry[]
  currentTrick: PlayEntry[]
  tricks: Trick[]
  legalCards: Card[]
}
export const playRules = ['lead-sequence', 'lead-singleton', 'draw-trump', 'win-cheap', 'keep-partner', 'play-low'] as const
export interface PlayDecision {
  seat: Seat
  card: Card
  rule: (typeof playRules)[number]
  version: number
  conventionVersion: string
  reason: string
}
