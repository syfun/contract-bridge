export const seats = ['north', 'east', 'south', 'west'] as const
export type Seat = (typeof seats)[number]
export const seatNames: Record<Seat, string> = {
  north: '北',
  east: '东',
  south: '南',
  west: '西',
}
export interface Member {
  connection: { status: 'online' | 'waiting' | 'taken-over'; deadline: number | null }
  id: string
  nickname: string
  joinedOrder: number
  seat: Seat | null
}
export const suits = ['S', 'H', 'D', 'C'] as const
export const ranks = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
  'A',
] as const
export type Card = `${(typeof suits)[number]}${(typeof ranks)[number]}`
export const denominations = ['C', 'D', 'H', 'S', 'NT'] as const
export type Denomination = (typeof denominations)[number]
export type Call =
  | { kind: 'pass' | 'double' | 'redouble' }
  | { kind: 'bid'; level: number; denomination: Denomination }
export interface AuctionEntry {
  seat: Seat
  call: Call
}
export interface Contract {
  level: number
  denomination: Denomination
  doubling: 'undoubled' | 'doubled' | 'redoubled'
  declarer: Seat
  openingLeader: Seat
}
export interface PlayEntry {
  seat: Seat
  card: Card
}
export interface Trick {
  cards: PlayEntry[]
  winner: Seat
}
export type Side = 'north-south' | 'east-west'
export type Scores = Record<Side, number>
export interface BoardScore {
  declarerSide: Side | null
  declarerTricks: number
  requiredTricks: number
  vulnerable: boolean
  items: { label: string; points: number }[]
  declarerScore: number
  delta: Scores
}
export interface BoardView {
  number: number
  dealer: Seat
  vulnerability: 'none' | 'north-south' | 'east-west' | 'both'
  turn: Seat | null
  phase:
    | 'auction'
    | 'opening-lead'
    | 'playing'
    | 'awaiting-score'
    | 'passed-out'
    | 'scored'
  score: BoardScore | null
  reviewHands: Record<Seat, Card[]> | null
  dummy: { seat: Seat; hand: Card[] } | null
  currentTrick: PlayEntry[]
  tricks: Trick[]
  legalCards: Card[]
  auction: AuctionEntry[]
  contract: Contract | null
  legalCalls: Call[]
  seats: Record<
    Seat,
    {
      memberId: string | null
      controller: 'human' | 'computer'
      ready: boolean
      cardCount: number
    }
  >
}
export interface RoomState {
  pause: { reason: 'host' } | null
  code: string
  version: number
  scores: Scores
  hostId: string
  selfId: string
  members: Member[]
  board: BoardView | null
  hand: Card[]
}
export type Command = { credential: string; operationId: string } & (
  | { kind: 'create'; nickname: string }
  | { kind: 'join'; nickname: string; code: string; expectedVersion: number }
  | {
      kind: 'play'
      code: string
      expectedVersion: number
      seat: Seat
      card: Card
    }
  | { kind: 'call'; code: string; expectedVersion: number; call: Call }
  | { kind: 'pause'; code: string; expectedVersion: number }
  | { kind: 'resume'; code: string; expectedVersion: number }
  | { kind: 'ready'; code: string; expectedVersion: number }
  | { kind: 'start'; code: string; expectedVersion: number }
  | { kind: 'seat'; code: string; expectedVersion: number; seat: Seat }
)
export type ErrorCode =
  | 'paused'
  | 'illegal_action'
  | 'unauthorized'
  | 'stale_state'
  | 'storage_failure'
  | 'room_not_found'
  | 'duplicate_nickname'
  | 'seat_taken'
  | 'operation_conflict'
export type Result =
  | { status: 'accepted'; state: RoomState; appliedVersion?: number }
  | { status: ErrorCode; message: string }
export type JoinVersion =
  | { status: 'accepted'; version: number }
  | Exclude<Result, { status: 'accepted' }>
