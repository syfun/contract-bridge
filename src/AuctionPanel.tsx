import { doublingNames } from './contract-labels.ts'
import { useState } from 'react'
import { seatNames } from '../shared/protocol.ts'
import type { BoardView, Call } from '../shared/protocol.ts'

const denominationNames = {
  C: '♣ 梅花',
  D: '♦ 方块',
  H: '♥ 红桃',
  S: '♠ 黑桃',
  NT: 'NT 无将',
}
function callLabel(call: Call) {
  if (call.kind === 'bid')
    return `${call.level} ${denominationNames[call.denomination]}`
  return { pass: '不叫 Pass', double: '加倍 X', redouble: '再加倍 XX' }[
    call.kind
  ]
}
export function AuctionPanel({
  board,
  locked,
  onCall,
}: {
  board: BoardView
  locked: boolean
  onCall: (call: Call) => void
}) {
  const [selection, setSelection] = useState('')
  const bids = board.legalCalls.filter((call) => call.kind === 'bid')
  const selected = bids.find((call) => callLabel(call) === selection) ?? bids[0]
  const contract = board.contract
  return (
    <section className="auction-panel" aria-label="叫牌与定约">
      <h2>
        {board.phase === 'auction'
          ? '叫牌'
          : board.phase === 'passed-out'
            ? '四家不叫'
            : '定约成立'}
      </h2>
      <p aria-live="polite">
        {board.phase === 'auction' && board.turn
          ? `${seatNames[board.turn]}家叫牌${board.legalCalls.length ? ' · 轮到你' : ''}`
          : board.phase === 'passed-out'
            ? '本副结束，无定约。'
            : contract &&
              `${contract.level} ${denominationNames[contract.denomination]} · ${doublingNames[contract.doubling]}`}
      </p>
      {contract && (
        <p>
          庄家：{seatNames[contract.declarer]}家<br />
          首攻方：{seatNames[contract.openingLeader]}家
        </p>
      )}
      {board.phase === 'auction' && (
        <>
          {board.legalCalls.length > 0 && (
            <div className="auction-controls">
              <label htmlFor="bid-choice">合法定约叫品</label>
              <select
                id="bid-choice"
                disabled={locked || !selected}
                value={selected ? callLabel(selected) : ''}
                onChange={(event) => setSelection(event.target.value)}
              >
                {bids.length ? (
                  bids.map((call) => (
                    <option key={callLabel(call)}>{callLabel(call)}</option>
                  ))
                ) : (
                  <option value="">已到最高叫品</option>
                )}
              </select>
              <button
                className="primary"
                disabled={locked || !selected}
                onClick={() => selected && onCall(selected)}
              >
                确认叫牌
              </button>
              <div className="call-actions">
                {(['pass', 'double', 'redouble'] as const).map((kind) => (
                  <button
                    key={kind}
                    disabled={
                      locked ||
                      !board.legalCalls.some((call) => call.kind === kind)
                    }
                    onClick={() => onCall({ kind })}
                  >
                    {callLabel({ kind })}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="muted">
            {board.legalCalls.length
              ? '仅可提交合法叫品；加倍用于对方定约，再加倍用于本方已被加倍的定约。'
              : '等待当前行动方叫牌。'}
            正常轮次不限时。
          </p>
        </>
      )}
      {board.phase === 'opening-lead' && (
        <p className="muted">请选择合法牌并确认首攻；首攻提交后公开明手。</p>
      )}
      <details className="auction-history" open>
        <summary>公开叫牌记录 · {board.auction.length} 次</summary>
        {board.auction.length ? (
          <ol>
            {board.auction.map((entry, index) => (
              <li key={index}>
                <span>
                  {index + 1}. {seatNames[entry.seat]}家
                </span>
                <strong>{callLabel(entry.call)}</strong>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">尚未叫牌。</p>
        )}
      </details>
    </section>
  )
}
