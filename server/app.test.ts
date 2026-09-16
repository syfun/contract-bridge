import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { io, type Socket } from 'socket.io-client'
import { createApp } from './app.ts'
import type { Command, Result, RoomState } from '../shared/protocol.ts'

test(
  '同源服务提供页面，实时状态按身份隔离，重连读取最新座位',
  { timeout: 10000 },
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-http-'))
    const app = await createApp(join(dir, 'game.sqlite'))
    const url = await app.listen({ port: 0, host: '127.0.0.1' })
    t.after(async () => {
      await app.close()
      rmSync(dir, { recursive: true, force: true })
    })
    const identity = async () => {
      const result = (await (
        await fetch(`${url}/api/identity`, { method: 'POST' })
      ).json()) as { credential: string }
      return result.credential
    }
    const submit = async (command: Command): Promise<Result> =>
      (
        await fetch(`${url}/api/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(command),
        })
      ).json() as Promise<Result>
    assert.match(await (await fetch(url)).text(), /桥牌小聚/)
    const host = await identity()
    const guest = await identity()
    const outsider = await identity()
    const created = await submit({
      kind: 'create',
      credential: host,
      operationId: 'create',
      nickname: '房主',
    })
    if (created.status !== 'accepted') throw Error(created.message)
    const code = created.state.code
    const joined = await submit({
      kind: 'join',
      credential: guest,
      operationId: 'join',
      nickname: '客人',
      code,
      expectedVersion: 1,
    })
    if (joined.status !== 'accepted') throw Error(joined.message)
    const once = (socket: Socket, event: string) =>
      new Promise<[RoomState]>((resolve) =>
        socket.once(event, (value) => resolve([value])),
      )
    const connect = async (credential: string) => {
      const socket = io(url, {
        auth: { code, credential },
        autoConnect: false,
        reconnection: false,
      })
      t.after(() => {
        socket.disconnect()
      })
      const initial = once(socket, 'state')
      socket.connect()
      const [state] = (await initial) as [RoomState]
      return { socket, state }
    }
    const a = await connect(host)
    const b = await connect(guest)
    assert.equal(a.state.selfId, created.state.selfId)
    assert.equal(b.state.selfId, joined.state.selfId)
    const denied = io(url, {
      auth: { code, credential: outsider },
      autoConnect: false,
      reconnection: false,
    })
    t.after(() => {
      denied.disconnect()
    })
    const error = once(denied, 'connect_error')
    denied.connect()
    await error
    assert.equal(denied.connected, false)
    const aUpdate = once(a.socket, 'state')
    const bUpdate = once(b.socket, 'state')
    const seated = await submit({
      kind: 'seat',
      credential: guest,
      operationId: 'seat',
      code,
      expectedVersion: 2,
      seat: 'east',
    })
    assert.equal(seated.status, 'accepted')
    const [aState] = (await aUpdate) as [RoomState]
    const [bState] = (await bUpdate) as [RoomState]
    assert.equal(aState.members[1].seat, 'east')
    assert.equal(bState.members[1].seat, 'east')
    assert.notEqual(aState.selfId, bState.selfId)
    b.socket.disconnect()
    const recovered = await connect(guest)
    assert.deepEqual(recovered.state, bState)
  },
)
