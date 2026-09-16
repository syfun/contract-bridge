import type { AuctionEntry, BoardView, Call, Card, Seat } from './protocol.ts'

export interface AuctionInput {
  version: number
  seat: Seat
  dealer: Seat
  vulnerability: BoardView['vulnerability']
  hand: Card[]
  auction: AuctionEntry[]
  legalCalls: Call[]
}
export interface AuctionDecision {
  call: Call
  rule: string
  version: number
  conventionVersion: string
  // 仅供服务端审计；不得广播包含私有牌力的依据。
  reason: string
}
