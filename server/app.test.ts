import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { io, type Socket } from 'socket.io-client'
import { createApp } from './app.ts'
import type { Command, Result, RoomState } from '../shared/protocol.ts'

test(
  '同源服务提供页面，选座与发牌按身份推送，错误及重连快照不泄露暗牌',
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
    const snapshot = async (credential: string): Promise<RoomState> => {
      const result = await (await fetch(`${url}/api/rooms/${code}`, {
        headers: { Authorization: `Bearer ${credential}` },
      })).json() as Result
      if (result.status !== 'accepted') throw Error(result.message)
      return result.state
    }
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
      expectedVersion: (await snapshot(host)).version,
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
    assert.deepEqual(recovered.state, { ...bState, version: recovered.state.version })

    const hostSeated = once(a.socket, 'state')
    const guestSeated = once(recovered.socket, 'state')
    const hostSeat = await submit({
      kind: 'seat',
      credential: host,
      operationId: 'host-seat',
      code,
      expectedVersion: (await snapshot(host)).version,
      seat: 'north',
    })
    assert.equal(hostSeat.status, 'accepted')
    await Promise.all([hostSeated, guestSeated])
    const hostJoined = once(a.socket, 'state')
    const guestJoined = once(recovered.socket, 'state')
    const waiting = await submit({
      kind: 'join',
      credential: outsider,
      operationId: 'waiting',
      code,
      nickname: '等待者',
      expectedVersion: (await snapshot(host)).version,
    })
    assert.equal(waiting.status, 'accepted')
    await Promise.all([hostJoined, guestJoined])
    const observer = await connect(outsider)
    const hostDeal = once(a.socket, 'state')
    const guestDeal = once(recovered.socket, 'state')
    const waitingDeal = once(observer.socket, 'state')
    const started = await submit({
      kind: 'start',
      credential: host,
      operationId: 'start',
      code,
      expectedVersion: (await snapshot(host)).version,
    })
    if (started.status !== 'accepted') throw Error(started.message)
    const [hostState] = await hostDeal
    const [guestState] = await guestDeal
    const [waitingState] = await waitingDeal
    assert.deepEqual(started.state, hostState)
    assert.equal(hostState.hand.length, 13)
    assert.equal(guestState.hand.length, 13)
    assert.deepEqual(waitingState.hand, [])
    assert.equal(new Set([...hostState.hand, ...guestState.hand]).size, 26)
    for (const state of [hostState, guestState, waitingState]) {
      assert.deepEqual(Object.keys(state).sort(), [
        'board',
        'code',
        'hand',
        'hostId',
        'members',
        'pause',
        'scores',
        'selfId',
        'version',
      ])
      assert.deepEqual(Object.keys(state.board!).sort(), [
        'auction',
        'contract',
        'currentTrick',
        'dealer',
        'dummy',
        'legalCalls',
        'legalCards',
        'number',
        'phase',
        'reviewHands',
        'score',
        'seats',
        'tricks',
        'turn',
        'vulnerability',
      ])
      for (const seat of Object.values(state.board!.seats))
        assert.deepEqual(Object.keys(seat).sort(), [
          'cardCount',
          'controller',
          'memberId',
          'ready',
        ])
    }
    const stale = await submit({
      kind: 'start',
      credential: host,
      operationId: 'stale',
      code,
      expectedVersion: started.state.version - 1,
    })
    assert.deepEqual(stale, {
      status: 'stale_state',
      message: '房间状态已更新，请重新操作。',
    })
    recovered.socket.disconnect()
    const restoredDeal = await connect(guest)
    assert.deepEqual(restoredDeal.state, { ...guestState, version: restoredDeal.state.version })
    assert.deepEqual(await snapshot(guest), restoredDeal.state)
    const hostCall = once(a.socket, 'state')
    const guestCall = once(restoredDeal.socket, 'state')
    const waitingCall = once(observer.socket, 'state')
    const called = await submit({
      kind: 'call',
      credential: host,
      code,
      operationId: 'call',
      expectedVersion: (await snapshot(host)).version,
      call: { kind: 'bid', level: 1, denomination: 'H' },
    })
    if (called.status !== 'accepted') throw Error(called.message)
    const updates = await Promise.all([hostCall, guestCall, waitingCall])
    for (const [state] of updates) {
      assert.deepEqual(state.board!.auction, [
        { seat: 'north', call: { kind: 'bid', level: 1, denomination: 'H' } },
      ])
      assert.equal(state.board!.turn, 'east')
    }
    assert.deepEqual(updates[0][0].hand, hostState.hand)
    assert.deepEqual(updates[1][0].hand, guestState.hand)
    assert.deepEqual(updates[2][0].hand, [])
    assert.deepEqual(updates[0][0].board!.legalCalls, [])
    assert.ok(
      updates[1][0].board!.legalCalls.some((call) => call.kind === 'double'),
    )
    assert.deepEqual(updates[2][0].board!.legalCalls, [])
    restoredDeal.socket.disconnect()
    const final = (await connect(guest)).state
    assert.deepEqual(final, { ...updates[1][0], version: final.version })
  },
)
