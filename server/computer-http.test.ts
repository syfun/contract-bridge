import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { io } from 'socket.io-client'
import { createApp } from './app.ts'
import type { RoomState, Result } from '../shared/protocol.ts'

test(
  'HTTP 开局自动启动 Worker，电脑结果持久化后推送本人状态',
  { timeout: 10000 },
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-computer-http-'))
    const app = await createApp(join(dir, 'room.sqlite'))
    const url = await app.listen({ host: '127.0.0.1', port: 0 })
    t.after(async () => {
      await app.close()
      rmSync(dir, { recursive: true, force: true })
    })
    const post = async (path: string, body: object) =>
      (
        await fetch(url + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).json()
    const { credential } = (await post('/api/identity', {})) as {
      credential: string
    }
    let state: RoomState
    let sequence = 0
    const send = async (action: object) => {
      const result = (await post('/api/commands', {
        credential,
        code: state?.code,
        expectedVersion: state?.version,
        operationId: String(sequence++),
        ...action,
      })) as Result
      if (result.status !== 'accepted') assert.fail(result.message)
      state = result.state
      return state
    }
    await send({ kind: 'create', nickname: '西家真人' })
    await send({ kind: 'seat', seat: 'west' })
    const socket = io(url, {
      auth: { code: state!.code, credential },
      autoConnect: false,
      reconnection: false,
    })
    t.after(() => socket.disconnect())
    const connected = new Promise<void>((resolve) =>
      socket.once('state', () => resolve()),
    )
    socket.connect()
    await connected
    const updates: RoomState[] = []
    const arrived = new Promise<RoomState>((resolve) =>
      socket.on('state', (next: RoomState) => {
        updates.push(next)
        if (next.board?.turn === 'west' && next.board.auction.length === 3)
          resolve(next)
      }),
    )
    await send({ kind: 'start' })
    const next = await arrived
    assert.equal(next.selfId, state!.selfId)
    assert.deepEqual(next.hand, state!.hand)
    assert.equal(next.version, state!.version + 3)
    assert.equal(next.board!.reviewHands, null)
    assert.equal(updates.length, 4)
    assert.ok(updates.every((item) => !JSON.stringify(item).includes('HCP')))
    const snapshot = (await (
      await fetch(`${url}/api/rooms/${next.code}`, {
        headers: { Authorization: `Bearer ${credential}` },
      })
    ).json()) as Result
    if (snapshot.status !== 'accepted') assert.fail(snapshot.message)
    assert.deepEqual(snapshot.state, next)
  },
)
