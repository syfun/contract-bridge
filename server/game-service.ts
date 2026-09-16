import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { applyCall, isCall } from './auction.ts'
import { seats } from '../shared/protocol.ts'
import type {
  Command,
  JoinVersion,
  Result,
  RoomState,
} from '../shared/protocol.ts'

import { shuffledDeck, dealBoard, visibleBoard } from './deal.ts'
import type { StoredBoard } from './deal.ts'
import type { Card } from '../shared/protocol.ts'

type StoredRoom = Omit<RoomState, 'selfId' | 'board' | 'hand'> & {
  board?: StoredBoard
}
function visibleRoom(room: StoredRoom, selfId: string): RoomState {
  const visible = room.board
    ? visibleBoard(room.board, selfId)
    : { board: null, hand: [] }
  return {
    code: room.code,
    version: room.version,
    hostId: room.hostId,
    members: room.members.map((member) => ({ ...member })),
    selfId,
    ...visible,
  }
}
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex')

export class GameService {
  private db: DatabaseSync
  private deck: () => Card[]
  constructor(path: string, options: { deck?: () => Card[] } = {}) {
    this.deck = options.deck ?? shuffledDeck
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 1000;
      CREATE TABLE IF NOT EXISTS identities (hash TEXT PRIMARY KEY, room TEXT, member TEXT);
      CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (identity TEXT, id TEXT, command TEXT, version INTEGER, PRIMARY KEY(identity, id));`)
  }
  close() {
    this.db.close()
  }
  issueIdentity(): string {
    const credential = randomBytes(32).toString('base64url')
    this.db
      .prepare('INSERT INTO identities(hash) VALUES (?)')
      .run(digest(credential))
    return credential
  }
  private room(code: string): StoredRoom | undefined {
    const row = this.db
      .prepare('SELECT state FROM rooms WHERE code = ?')
      .get(code)
    return row ? JSON.parse(String(row.state)) : undefined
  }
  read(code: string, credential: string): Result {
    try {
      const identity = this.db
        .prepare('SELECT room, member FROM identities WHERE hash = ?')
        .get(digest(credential))
      if (!identity || identity.room !== code)
        return {
          status: 'unauthorized',
          message: '身份凭据无效或不属于这个房间。',
        }
      const room = this.room(code)
      if (!room)
        return {
          status: 'room_not_found',
          message: '房间不存在，请检查房间码。',
        }
      return {
        status: 'accepted',
        state: visibleRoom(room, String(identity.member)),
      }
    } catch {
      return { status: 'storage_failure', message: '读取失败，请稍后重试。' }
    }
  }
  joinVersion(code: string, credential: string): JoinVersion {
    try {
      const identity = this.db
        .prepare('SELECT room FROM identities WHERE hash = ?')
        .get(digest(credential))
      if (!identity || identity.room)
        return { status: 'unauthorized', message: '需要尚未入房的有效身份。' }
      const room = this.room(code)
      if (!room)
        return {
          status: 'room_not_found',
          message: '房间不存在，请检查房间码。',
        }
      return { status: 'accepted', version: room.version }
    } catch {
      return { status: 'storage_failure', message: '读取失败，请稍后重试。' }
    }
  }
  execute(input: unknown): Result {
    if (!input || typeof input !== 'object')
      return { status: 'illegal_action', message: '操作格式不正确。' }
    const command = input as Command
    if (
      typeof command.credential !== 'string' ||
      typeof command.operationId !== 'string' ||
      !command.operationId.length ||
      command.operationId.length > 128
    )
      return { status: 'illegal_action', message: '缺少有效身份或操作标识。' }
    if (!['create', 'join', 'seat', 'start', 'call'].includes(command.kind))
      return { status: 'illegal_action', message: '不支持的操作。' }
    if (
      command.kind !== 'create' &&
      (typeof command.code !== 'string' || !/^[A-Z0-9]{6}$/.test(command.code))
    )
      return {
        status: 'room_not_found',
        message: '房间码应为六位字母或数字。',
      }
    if (
      (command.kind === 'create' || command.kind === 'join') &&
      (typeof command.nickname !== 'string' ||
        !command.nickname.trim() ||
        command.nickname.trim().length > 20)
    )
      return { status: 'illegal_action', message: '昵称应为 1 至 20 个字符。' }
    if (
      (command.kind !== 'create' &&
        !Number.isSafeInteger(command.expectedVersion)) ||
      (command.kind === 'seat' && !seats.includes(command.seat))
    )
      return { status: 'illegal_action', message: '座位或状态版本不正确。' }
    if (command.kind === 'call' && !isCall(command.call))
      return { status: 'illegal_action', message: '叫品格式不正确。' }
    const hash = digest(command.credential)
    // 不保存明文凭据；固定字段顺序使网络重试不依赖 JSON 键顺序。
    const fingerprint = JSON.stringify(
      command.kind === 'create'
        ? [command.kind, command.nickname.trim()]
        : command.kind === 'join'
          ? [
              command.kind,
              command.code,
              command.nickname.trim(),
              command.expectedVersion,
            ]
          : command.kind === 'seat'
            ? [
                command.kind,
                command.code,
                command.expectedVersion,
                command.seat,
              ]
            : command.kind === 'call'
              ? [
                  command.kind,
                  command.code,
                  command.expectedVersion,
                  command.call.kind,
                  command.call.kind === 'bid' ? command.call.level : null,
                  command.call.kind === 'bid'
                    ? command.call.denomination
                    : null,
                ]
              : [command.kind, command.code, command.expectedVersion],
    )
    try {
      // 同步事务内无 await，操作在单一服务进程中顺序提交。
      this.db.exec('BEGIN IMMEDIATE')
      const reject = (
        status: Exclude<Result['status'], 'accepted'>,
        message: string,
      ): Result => {
        this.db.exec('ROLLBACK')
        return { status, message }
      }
      const identity = this.db
        .prepare('SELECT room, member FROM identities WHERE hash = ?')
        .get(hash)
      if (!identity) return reject('unauthorized', '身份凭据无效，请重新进入。')
      const previous = this.db
        .prepare(
          'SELECT command, version FROM operations WHERE identity = ? AND id = ?',
        )
        .get(hash, command.operationId)
      if (previous) {
        if (previous.command !== fingerprint)
          return reject('operation_conflict', '操作标识已用于其他操作。')
        this.db.exec('ROLLBACK')
        const result = this.read(String(identity.room), command.credential)
        return result.status === 'accepted'
          ? { ...result, appliedVersion: Number(previous.version) }
          : result
      }
      let room: StoredRoom
      let memberId = String(identity.member)
      if (command.kind === 'create') {
        if (identity.room) return reject('unauthorized', '该身份已经加入房间。')
        let code: string
        do {
          code = randomBytes(3).toString('hex').toUpperCase()
        } while (this.room(code))
        memberId = randomUUID()
        room = {
          code,
          version: 0,
          hostId: memberId,
          members: [
            {
              id: memberId,
              nickname: command.nickname.trim(),
              joinedOrder: 1,
              seat: null,
            },
          ],
        }
      } else {
        if (command.kind !== 'join' && identity.room !== command.code)
          return reject('unauthorized', '你无权操作这个房间。')
        const existing = this.room(command.code)
        if (!existing)
          return reject('room_not_found', '房间不存在，请检查房间码。')
        room = existing
        if (command.kind === 'join') {
          if (identity.room)
            return reject('unauthorized', '该身份已经加入房间。')
          if (command.expectedVersion !== room.version)
            return reject('stale_state', '房间状态已更新，请重新加入。')
          if (room.members.some((m) => m.nickname === command.nickname.trim()))
            return reject(
              'duplicate_nickname',
              '这个昵称已在房间中使用，请换一个。',
            )
          if (room.members.length >= 4)
            return reject('illegal_action', '房间已满，最多四名真人牌手。')
          memberId = randomUUID()
          room.members.push({
            id: memberId,
            nickname: command.nickname.trim(),
            joinedOrder: room.members.length + 1,
            seat: null,
          })
        } else {
          if (command.expectedVersion !== room.version)
            return reject('stale_state', '房间状态已更新，请重新操作。')
          const member = room.members.find((m) => m.id === memberId)
          if (!member) return reject('unauthorized', '你不属于这个房间。')
          if (command.kind === 'call') {
            if (!room.board || room.board.phase !== 'auction')
              return reject('illegal_action', '当前不在叫牌阶段。')
            if (!member.seat || room.board.occupants[member.seat] !== memberId)
              return reject('unauthorized', '你未参与本副，不能叫牌。')
            if (room.board.turn !== member.seat)
              return reject('illegal_action', '尚未轮到你叫牌。')
            if (!applyCall(room.board, command.call))
              return reject(
                'illegal_action',
                '这个叫品不合法，请选择提示中的操作。',
              )
          } else if (command.kind === 'start') {
            if (memberId !== room.hostId)
              return reject('unauthorized', '只有房主可以开局。')
            if (!member.seat)
              return reject('illegal_action', '房主请先选择座位。')
            if (room.board)
              return reject('illegal_action', '本副已开始，不能重复开局。')
            room.board = dealBoard(room.members, this.deck())
          } else {
            if (room.board)
              return reject(
                'illegal_action',
                '本副已开始，请等待下一副再选座。',
              )
            if (
              room.members.some(
                (m) => m.seat === command.seat && m.id !== memberId,
              )
            )
              return reject('seat_taken', '这个座位已有人，请选择空位。')
            member.seat = command.seat
          }
        }
      }
      room.version++
      this.db
        .prepare(
          'INSERT INTO rooms(code, state) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET state = excluded.state',
        )
        .run(room.code, JSON.stringify(room))
      this.db
        .prepare('UPDATE identities SET room = ?, member = ? WHERE hash = ?')
        .run(room.code, memberId, hash)
      this.db
        .prepare('INSERT INTO operations VALUES (?, ?, ?, ?)')
        .run(hash, command.operationId, fingerprint, room.version)
      this.db.exec('COMMIT')
      return {
        status: 'accepted',
        state: visibleRoom(room, memberId),
        appliedVersion: room.version,
      }
    } catch {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        /* BEGIN 失败时没有事务。 */
      }
      return {
        status: 'storage_failure',
        message: '保存失败，操作尚未确认，请重试。',
      }
    }
  }
}
