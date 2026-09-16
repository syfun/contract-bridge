export const seats = ['north', 'east', 'south', 'west'] as const
export type Seat = (typeof seats)[number]
export const seatNames: Record<Seat, string> = {
  north: '北',
  east: '东',
  south: '南',
  west: '西',
}
export interface Member {
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
export interface BoardView {
  number: number
  dealer: Seat
  vulnerability: 'none' | 'north-south' | 'east-west' | 'both'
  turn: Seat
  phase: 'auction'
  seats: Record<
    Seat,
    {
      memberId: string | null
      controller: 'human' | 'computer'
      cardCount: number
    }
  >
}
export interface RoomState {
  code: string
  version: number
  hostId: string
  selfId: string
  members: Member[]
  board: BoardView | null
  hand: Card[]
}
export type Command = { credential: string; operationId: string } & (
  | { kind: 'create'; nickname: string }
  | { kind: 'join'; nickname: string; code: string; expectedVersion: number }
  | { kind: 'start'; code: string; expectedVersion: number }
  | { kind: 'seat'; code: string; expectedVersion: number; seat: Seat }
)
export type ErrorCode =
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
