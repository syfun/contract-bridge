import { playRules } from '../shared/computer-play.ts'
import type { PlayInput, PlayDecision } from '../shared/computer-play.ts'
import { scoreContract, sideOf } from './scoring.ts'
import { dummySeat, legalCards, applyPlay, playController } from './play.ts'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type {
  AuctionInput,
  AuctionDecision,
} from '../shared/computer-auction.ts'
import { conventionVersion, conventions } from '../shared/conventions.ts'
import { applyCall, isCall, legalCalls } from './auction.ts'
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

export interface ComputerTurn {
  code: string
  input: AuctionInput
}
export interface ComputerPlayTurn {
  code: string
  input: PlayInput
}
type ComputerAuthority = {
  kind: 'call' | 'play'
  handSeat?: PlayInput['turn']
  code: string
  seat: AuctionInput['seat']
  version: number
}

type StoredRoom = Omit<RoomState, 'selfId' | 'board' | 'hand' | 'scores' | 'pause'> & {
  pause?: RoomState['pause']
  scores?: RoomState['scores']
  board?: StoredBoard
}
// 在调用者的写事务内结算，结果存在即不再累计。
function settleRoom(room: StoredRoom): boolean {
  const board = room.board
  if (
    !board ||
    board.score ||
    !['passed-out', 'awaiting-score'].includes(board.phase)
  )
    return false
  const tricks = board.contract
    ? (board.tricks ?? []).filter(
        (trick) => sideOf(trick.winner) === sideOf(board.contract!.declarer),
      ).length
    : 0
  board.score = scoreContract(board.contract, tricks, board.vulnerability)
  room.scores ??= { 'north-south': 0, 'east-west': 0 }
  room.scores['north-south'] += board.score.delta['north-south']
  room.scores['east-west'] += board.score.delta['east-west']
  if (board.phase === 'awaiting-score') board.phase = 'scored'
  return true
}
function visibleRoom(room: StoredRoom, selfId: string): RoomState {
  const visible = room.board
    ? visibleBoard(room.board, selfId)
    : { board: null, hand: [] }
  return {
    scores: { ...(room.scores ?? { 'north-south': 0, 'east-west': 0 }) },
    pause: room.pause ?? null,
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
  private computerTurns = new WeakMap<ComputerTurn | ComputerPlayTurn, ComputerAuthority>()
  private db: DatabaseSync
  private deck: () => Card[]
  constructor(path: string, options: { deck?: () => Card[] } = {}) {
    this.deck = options.deck ?? shuffledDeck
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 1000;
      CREATE TABLE IF NOT EXISTS identities (hash TEXT PRIMARY KEY, room TEXT, member TEXT);
      CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (identity TEXT, id TEXT, command TEXT, version INTEGER, PRIMARY KEY(identity, id));`)
    // 第 05 票存档可能停在待结算或全体不叫；升级时一次性补齐结算。
    try {
      this.db.exec('BEGIN IMMEDIATE')
      const rows = this.db.prepare('SELECT code, state FROM rooms').all()
      for (const row of rows) {
        const room: StoredRoom = JSON.parse(String(row.state))
        if (settleRoom(room)) {
          room.version++
          this.db
            .prepare('UPDATE rooms SET state = ? WHERE code = ?')
            .run(JSON.stringify(room), String(row.code))
        }
      }
      this.db.exec('COMMIT')
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } finally {
        this.db.close()
      }
      throw error
    }
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
  // 仅服务端调度器可调用，不经 HTTP 暴露。逐字段投影，禁止传整个存档。
  computerTurn(code: string): ComputerTurn | null {
    const room = this.room(code)
    const board = room?.board
    if (
      room?.pause ||
      !board ||
      board.phase !== 'auction' ||
      !board.turn ||
      board.occupants[board.turn] !== null
    )
      return null
    const turn: ComputerTurn = {
      code,
      input: {
        version: room!.version,
        seat: board.turn,
        dealer: board.dealer,
        vulnerability: board.vulnerability,
        hand: [...board.hands[board.turn]],
        auction: structuredClone(board.auction),
        legalCalls: legalCalls(board),
      },
    }
    this.computerTurns.set(turn, {
      kind: 'call',
      code,
      seat: board.turn,
      version: room!.version,
    })
    return turn
  }
  computerPlayTurn(code: string): ComputerPlayTurn | null {
    const room = this.room(code)
    const board = room?.board
    if (room?.pause || !board || !['opening-lead', 'playing'].includes(board.phase) || !board.turn || !board.contract || playController(board) !== null)
      return null
    const dummy = dummySeat(board)!
    const controller = board.turn === dummy ? board.contract.declarer : board.turn
    const turn: ComputerPlayTurn = {
      code,
      input: {
        version: room!.version,
        seat: controller,
        turn: board.turn,
        hand: [...board.hands[controller]],
        dummy: board.phase === 'playing' ? { seat: dummy, hand: [...board.hands[dummy]] } : null,
        contract: { ...board.contract },
        vulnerability: board.vulnerability,
        auction: structuredClone(board.auction),
        currentTrick: structuredClone(board.currentTrick ?? []),
        tricks: structuredClone(board.tricks ?? []),
        legalCards: legalCards(board),
      },
    }
    this.computerTurns.set(turn, { kind: 'play', code, seat: controller, handSeat: board.turn, version: room!.version })
    return turn
  }
  submitComputerPlay(turn: ComputerPlayTurn, decision: PlayDecision): Result {
    const authority = this.computerTurns.get(turn)
    if (!authority || authority.kind !== 'play')
      return { status: 'unauthorized', message: '无效的电脑行动授权。' }
    if (!decision || decision.version !== authority.version || decision.conventionVersion !== conventionVersion || !playRules.includes(decision.rule) || typeof decision.reason !== 'string' || decision.reason.length > 2048)
      return { status: 'illegal_action', message: '电脑建议格式或输入版本无效。' }
    return this.executeCommand({ kind: 'play', code: authority.code, credential: '', operationId: `computer-${authority.version}-${authority.seat}`, expectedVersion: authority.version, seat: decision.seat, card: decision.card }, authority, decision)
  }
  submitComputerCall(turn: ComputerTurn, decision: AuctionDecision): Result {
    const authority = this.computerTurns.get(turn)
    if (!authority || authority.kind !== 'call')
      return { status: 'unauthorized', message: '无效的电脑行动授权。' }
    if (
      !decision ||
      decision.version !== authority.version ||
      decision.conventionVersion !== conventionVersion ||
      !conventions.some((rule) => rule.id === decision.rule) ||
      typeof decision.reason !== 'string' ||
      decision.reason.length > 2048
    )
      return {
        status: 'illegal_action',
        message: '电脑建议格式或输入版本无效。',
      }
    return this.executeCommand(
      {
        kind: 'call',
        code: authority.code,
        credential: '',
        operationId: `computer-${authority.version}-${authority.seat}`,
        expectedVersion: authority.version,
        call: decision.call,
      },
      authority,
      decision,
    )
  }
  execute(input: unknown): Result {
    return this.executeCommand(input)
  }
  private executeCommand(
    input: unknown,
    computer?: ComputerAuthority,
    decision?: AuctionDecision | PlayDecision,
  ): Result {
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
    if (
      !['create', 'join', 'seat', 'start', 'call', 'play', 'ready', 'pause', 'resume'].includes(
        command.kind,
      )
    )
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
    if (
      command.kind === 'play' &&
      (!seats.includes(command.seat) ||
        typeof command.card !== 'string' ||
        !/^[SHDC](?:[2-9]|10|[JQKA])$/.test(command.card))
    )
      return { status: 'illegal_action', message: '出牌格式不正确。' }
    const hash = computer
      ? `computer:${computer.code}:${computer.seat}`
      : digest(command.credential)
    // 不保存明文凭据；固定字段顺序使网络重试不依赖 JSON 键顺序。
    const actionFingerprint = JSON.stringify(
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
            : command.kind === 'play'
              ? [
                  command.kind,
                  command.code,
                  command.expectedVersion,
                  command.seat,
                  command.card,
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
    const fingerprint = computer
      ? JSON.stringify([actionFingerprint, decision])
      : actionFingerprint
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
      const identity = computer
        ? { room: computer.code, member: '' }
        : this.db
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
        const result: Result = computer
          ? {
              status: 'accepted',
              state: visibleRoom(this.room(computer.code)!, ''),
            }
          : this.read(String(identity.room), command.credential)
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
          if (
            computer &&
            (command.kind !== computer.kind ||
              !room.board ||
              room.board.occupants[computer.seat] !== null ||
              (computer.kind === 'call'
                ? room.board.phase !== 'auction' || room.board.turn !== computer.seat
                : !['opening-lead', 'playing'].includes(room.board.phase) ||
                  room.board.turn !== computer.handSeat ||
                  (room.board.turn === dummySeat(room.board) ? room.board.contract?.declarer : room.board.turn) !== computer.seat))
          )
            return reject('unauthorized', '电脑已失去该座位的行动权。')
          const member = computer
            ? { id: '', nickname: '', joinedOrder: 0, seat: computer.seat }
            : room.members.find((m) => m.id === memberId)
          if (!member) return reject('unauthorized', '你不属于这个房间。')
          if (room.pause && !['pause', 'resume', 'seat'].includes(command.kind))
            return reject('paused', '牌桌已暂停，请等待房主恢复。')
          if (command.kind === 'pause' || command.kind === 'resume') {
            if (memberId !== room.hostId)
              return reject('unauthorized', '只有房主可以暂停或恢复牌桌。')
            if (!room.board)
              return reject('illegal_action', '请先开始第一副。')
            if (command.kind === 'pause' ? !!room.pause : !room.pause)
              return reject('illegal_action', command.kind === 'pause' ? '牌桌已经暂停。' : '牌桌尚未暂停。')
            room.pause = command.kind === 'pause' ? { reason: 'host' } : null
          } else if (command.kind === 'ready') {
            const board = room.board
            if (!board?.score)
              return reject('illegal_action', '请在本副结算后准备。')
            if (!member.seat || board.occupants[member.seat] !== memberId)
              return reject('unauthorized', '你未参与本副，不能准备。')
            board.ready ??= {}
            board.ready[member.seat] = true
            if (
              seats.every(
                (seat) => board.occupants[seat] === null || board.ready?.[seat],
              )
            )
              room.board = dealBoard(
                room.members,
                this.deck(),
                board.number + 1,
              )
          } else if (command.kind === 'play') {
            if (
              !room.board ||
              !['opening-lead', 'playing'].includes(room.board.phase)
            )
              return reject('illegal_action', '当前不在出牌阶段。')
            if (computer ? command.seat !== computer.handSeat || playController(room.board, command.seat) !== null : playController(room.board, command.seat) !== memberId)
              return reject('unauthorized', '你无权操作这手牌。')
            if (!applyPlay(room.board, command.seat, command.card))
              return reject(
                'illegal_action',
                '请按轮次选择合法牌；有首引花色时必须跟牌。',
              )
          } else if (command.kind === 'call') {
            if (!room.board || room.board.phase !== 'auction')
              return reject('illegal_action', '当前不在叫牌阶段。')
            if (
              !member.seat ||
              (!computer && room.board.occupants[member.seat] !== memberId)
            )
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
      settleRoom(room)
      room.version++
      this.db
        .prepare(
          'INSERT INTO rooms(code, state) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET state = excluded.state',
        )
        .run(room.code, JSON.stringify(room))
      if (!computer)
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
