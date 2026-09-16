import type { GameService } from '../game-service.ts'
import assert from 'node:assert/strict'
import type { RoomState, Result } from '../../shared/protocol.ts'

// 重启新增暂停、连接状态和版本，原牌局及身份字段必须完整保留。
export function assertRecovered(actual: RoomState, before: RoomState) {
  assert.deepEqual(actual.pause, before.pause ?? (before.board ? { reason: 'restart' } : null))
  assert.equal(actual.version, before.version + 1)
  for (const member of actual.members) {
    assert.equal(member.connection.status, 'waiting')
    assert.equal(typeof member.connection.deadline, 'number')
  }
  assert.deepEqual(actual, {
    ...before,
    version: actual.version,
    pause: actual.pause,
    members: before.members.map((member, i) => ({ ...member, connection: actual.members[i].connection })),
    board: before.board ? { ...before.board, legalCalls: [], legalCards: [] } : null,
  })
}

export function assertRecoveredOperation(actual: Result, before: Result) {
  assert.equal(actual.status, 'accepted')
  assert.equal(before.status, 'accepted')
  if (actual.status !== 'accepted' || before.status !== 'accepted') return
  assert.equal(actual.appliedVersion, before.appliedVersion)
  assertRecovered(actual.state, before.state)
}

export function reconnectAndResume(service: GameService, code: string, identities: string[]) {
  for (const [i, credential] of identities.entries())
    assert.equal(service.connect(code, credential, `return-${i}`).status, 'accepted')
  const result = service.read(code, identities[0])
  assert.equal(result.status, 'accepted')
  if (result.status !== 'accepted') return
  assert.equal(service.execute({
    kind: 'resume', code, credential: identities[0], expectedVersion: result.state.version,
    operationId: `resume-${result.state.version}`,
  }).status, 'accepted')
}
