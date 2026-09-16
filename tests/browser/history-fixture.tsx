import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PlayTable } from '../../src/PlayTable.tsx'
import type { RoomState, Trick, Card } from '../../shared/protocol.ts'
import '../../src/index.css'
import '../../src/App.css'

// 固定公开牌例，浏览器测试通过更新输入模拟连续收到服务端快照。
const tricks: Trick[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'].map(rank => ({
  cards: [
    { seat: 'south', card: `S${rank}` as Card },
    { seat: 'west', card: `H${rank}` as Card },
    { seat: 'north', card: `D${rank}` as Card },
    { seat: 'east', card: `C${rank}` as Card },
  ],
  winner: 'south',
}))
const initial: RoomState = {
  code: 'ABC123', version: 1, selfId: 'self', hostId: 'self', pause: null,
  scores: { 'north-south': 0, 'east-west': 0 }, hand: ['SA'],
  members: [{ id: 'self', nickname: '测试牌手', seat: 'south', joinedOrder: 1, connection: { status: 'online', deadline: null } }],
  board: {
    number: 1, dealer: 'north', vulnerability: 'none', turn: 'south', phase: 'playing',
    tricks: tricks.slice(0, 9), currentTrick: [], score: null, reviewHands: null, dummy: null,
    legalCards: ['SA'], legalCalls: [], auction: [], contract: null,
    seats: {
      north: { memberId: null, controller: 'computer', ready: false, cardCount: 4 },
      east: { memberId: null, controller: 'computer', ready: false, cardCount: 4 },
      south: { memberId: 'self', controller: 'human', ready: false, cardCount: 4 },
      west: { memberId: null, controller: 'computer', ready: false, cardCount: 4 },
    },
  },
}
export function Fixture() {
  const [state, setState] = useState(initial)
  return <main>
    <button onClick={() => setState(s => ({ ...s, version: s.version + 1, board: { ...s.board!, tricks: tricks.slice(0, Math.min(12, s.board!.tricks.length + 1)), currentTrick: [{ seat: 'south', card: 'SA' }] } }))}>收到新出牌</button>
    <button onClick={() => setState(s => ({ ...initial, board: { ...initial.board!, number: s.board!.number + 1, tricks: [], currentTrick: [] } }))}>下一副</button>
    <button onClick={() => setState(s => ({ ...s, board: { ...s.board!, tricks, currentTrick: [], phase: 'awaiting-score' } }))}>完成十三墩</button>
    <div className="room-layout">
      <PlayTable state={state} locked={false} seatLocked onChoose={() => {}} onPlay={() => {}} />
      <aside className="panel members">房间信息</aside>
    </div>
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
