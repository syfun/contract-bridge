import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { io } from 'socket.io-client'
import { createApp } from './app.ts'
import type { Result, RoomState } from '../shared/protocol.ts'

test('退出提交后通知该身份所有连接离房，其他身份收到转交快照，旧连接无法恢复', { timeout: 10000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-replace-http-'))
  const app = await createApp(join(dir, 'room.sqlite'))
  const url = await app.listen({ host: '127.0.0.1', port: 0 })
  const identities = await Promise.all([0, 1].map(async () => (await app.inject({ method: 'POST', url: '/api/identity' })).json().credential as string))
  let n = 0
  async function send(i: number, action: object) {
    const result = (await app.inject({ method: 'POST', url: '/api/commands', payload: { credential: identities[i], operationId: `op-${n++}`, ...action } })).json<Result>()
    if (result.status !== 'accepted') throw Error(result.message)
    return result
  }
  let state = (await send(0, { kind: 'create', nickname: '房主' })).state
  state = (await send(1, { kind: 'join', code: state.code, expectedVersion: state.version, nickname: '牌友' })).state
  const sockets = [0, 0, 1].map(i => io(url, { auth: { code: state.code, credential: identities[i] }, autoConnect: false, reconnection: false }))
  t.after(async () => {
    for (const socket of sockets) socket.disconnect()
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  })
  for (const socket of sockets) {
    const initial = new Promise<RoomState>(resolve => socket.once('state', resolve))
    socket.connect()
    state = await initial
  }
  const ended = sockets.slice(0, 2).map(socket => new Promise<void>(resolve => socket.once('membership_ended', resolve)))
  const successor = new Promise<RoomState>(resolve => sockets[2].once('state', resolve))
  const leave = { kind: 'leave', code: state.code, expectedVersion: state.version }
  await send(0, leave)
  await Promise.all(ended)
  const next = await successor
  assert.equal(next.members.length, 1)
  assert.equal(next.hostId, next.selfId)
  const read = (await app.inject({ url: `/api/rooms/${state.code}`, headers: { authorization: `Bearer ${identities[0]}` } })).json<Result>()
  assert.equal(read.status, 'unauthorized')
  const rejected = new Promise<Error>(resolve => sockets[0].once('connect_error', resolve))
  sockets[0].connect()
  assert.match((await rejected).message, /退出|释放/)
})
