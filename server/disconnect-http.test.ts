import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { io, type Socket } from 'socket.io-client'
import { DatabaseSync } from 'node:sqlite'
import { createApp } from './app.ts'
import { seats, type RoomState, type Result } from '../shared/protocol.ts'

test('Socket.IO 检测最后断线、广播等待与接管，重连取回控制并恢复合法操作', { timeout: 10000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-disconnect-http-'))
  let now = 100_000
  const app = await createApp(join(dir, 'room.sqlite'), { now: () => now })
  const url = await app.listen({ host: '127.0.0.1', port: 0 })
  const sockets: Socket[] = []
  t.after(async () => {
    for (const socket of sockets) socket.disconnect()
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const identities: string[] = []
  let code = ''
  const read = async (i = 0): Promise<RoomState> => {
    const result = (await app.inject({ url: `/api/rooms/${code}`, headers: { authorization: `Bearer ${identities[i]}` } })).json<Result>()
    if (result.status !== 'accepted') throw Error(result.message)
    return result.state
  }
  let n = 0
  const send = async (i: number, action: object) => {
    const result = (await app.inject({ method: 'POST', url: '/api/commands', payload: {
      credential: identities[i], code, expectedVersion: code ? (await read()).version : 0,
      operationId: `op-${n++}`, ...action,
    } })).json<Result>()
    if (result.status !== 'accepted') throw Error(result.message)
    return result.state
  }
  for (let i = 0; i < 4; i++) {
    identities.push((await app.inject({ method: 'POST', url: '/api/identity' })).json().credential)
    if (!i) code = (await send(i, { kind: 'create', nickname: '房主' })).code
    else await send(i, { kind: 'join', nickname: seats[i] })
    await send(i, { kind: 'seat', seat: seats[i] })
  }
  const waitState = (socket: Socket, predicate: (state: RoomState) => boolean) => new Promise<RoomState>((resolve) => {
    const listener = (state: RoomState) => {
      if (predicate(state)) { socket.off('state', listener); resolve(state) }
    }
    socket.on('state', listener)
  })
  const connect = async (i: number) => {
    const socket = io(url, { auth: { code, credential: identities[i] }, autoConnect: false, reconnection: false })
    sockets.push(socket)
    const initial = waitState(socket, () => true)
    socket.connect()
    await initial
    return socket
  }
  const host = await connect(0)
  const east = await connect(1)
  const extra = await connect(1)
  await send(0, { kind: 'start' })
  extra.disconnect()
  const waiting = waitState(host, (state) => state.members[1].connection.status === 'waiting')
  east.disconnect()
  assert.equal((await waiting).members[1].connection.deadline, 130_000)
  await send(0, { kind: 'call', call: { kind: 'pass' } })
  const takenOver = waitState(host, (state) => state.members[1].connection.status === 'taken-over')
  const advanced = waitState(host, (state) => state.board!.auction.length === 2)
  now = 130_000
  assert.equal((await takenOver).board!.seats.east.controller, 'computer')
  const submitted = await advanced
  assert.equal(submitted.board!.turn, 'south')
  const returned = waitState(host, (state) => state.members[1].connection.status === 'online')
  const returnedEast = await connect(1)
  const restored = await returned
  assert.equal(restored.board!.seats.east.controller, 'human')
  assert.deepEqual(restored.board!.auction, submitted.board!.auction)
  assert.equal((await read(1)).hand.length, 13)
  assert.notDeepEqual((await read(1)).hand, restored.hand)
  const waitingAgain = waitState(host, (state) => state.members[1].connection.status === 'waiting')
  returnedEast.disconnect()
  await waitingAgain
  const db = new DatabaseSync(join(dir, 'room.sqlite'))
  try {
    db.exec("CREATE TRIGGER fail_reconnect BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'failure'); END")
    const retry = io(url, { auth: { code, credential: identities[1] }, autoConnect: false, reconnection: false })
    sockets.push(retry)
    const error = new Promise<string>((resolve) => retry.once('presence_error', resolve))
    const recovered = waitState(retry, (state) => state.members[1].connection.status === 'online')
    retry.connect()
    assert.match(await error, /保存失败/)
    assert.equal((await read()).members[1].connection.status, 'waiting')
    db.exec('DROP TRIGGER fail_reconnect')
    assert.equal((await recovered).board!.seats.east.controller, 'human')
  } finally {
    db.close()
  }
})
