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
export interface RoomState {
  code: string
  version: number
  hostId: string
  selfId: string
  members: Member[]
}
export type Command = { credential: string; operationId: string } & (
  | { kind: 'create'; nickname: string }
  | { kind: 'join'; nickname: string; code: string; expectedVersion: number }
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
