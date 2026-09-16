import { doublingNames } from './contract-labels.ts'
import { ranks, seats, seatNames, suits } from '../shared/protocol.ts'
import type { BoardView, Scores } from '../shared/protocol.ts'
import { suitSymbols } from './card-label.ts'

const signed = (points: number) => (points > 0 ? `+${points}` : String(points))
export function ScoreTotals({ scores }: { scores: Scores }) {
  return (
    <section className="score-totals" aria-label="房间累计分">
      <h2>房间累计分</h2>
      <div>
        <span>
          南北 <strong>{signed(scores['north-south'])}</strong>
        </span>
        <span>
          东西 <strong>{signed(scores['east-west'])}</strong>
        </span>
      </div>
      <small>成绩按方位保留</small>
    </section>
  )
}
export function ScorePanel({ board }: { board: BoardView }) {
  const score = board.score
  if (!score) return null
  const contract = board.contract
  const difference = score.declarerTricks - score.requiredTricks
  return (
    <section className="panel score-panel" aria-label="本副结算">
      <span className="eyebrow">第 {board.number} 副 · 已结算</span>
      <h2>
        {contract
          ? difference < 0
            ? `宕 ${-difference} 墩`
            : difference
              ? `成约 · 超 ${difference} 墩`
              : '恰好成约'
          : '四家不叫 · 零分结算'}
      </h2>
      {contract && (
        <>
          <p>
            {contract.level}{' '}
            {contract.denomination === 'NT'
              ? 'NT 无将'
              : suitSymbols[contract.denomination]}{' '}
            · {seatNames[contract.declarer]}家做庄 ·{' '}
            {doublingNames[contract.doubling]}
          </p>
          <p>
            庄家方{score.vulnerable ? '有局' : '无局'} · 完成{' '}
            {score.declarerTricks} 墩 / 需要 {score.requiredTricks} 墩
          </p>
          <dl className="score-items">
            {score.items.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{signed(item.points)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <p className="board-score">
        本副：南北 <strong>{signed(score.delta['north-south'])}</strong> · 东西{' '}
        <strong>{signed(score.delta['east-west'])}</strong>
      </p>
      {board.reviewHands && (
        <details className="review-hands" open>
          <summary>四家原始手牌 · 每家 13 张</summary>
          <div className="review-grid">
            {seats.map((seat) => (
              <section key={seat} aria-label={`${seatNames[seat]}家原始手牌`}>
                <h3>{seatNames[seat]}家</h3>
                {suits.map((suit) => {
                  const cards = board
                    .reviewHands![seat].filter((card) => card[0] === suit)
                    .sort(
                      (a, b) =>
                        ranks.indexOf(b.slice(1) as (typeof ranks)[number]) -
                        ranks.indexOf(a.slice(1) as (typeof ranks)[number]),
                    )
                  return (
                    <p
                      key={suit}
                      className={suit === 'H' || suit === 'D' ? 'red' : ''}
                    >
                      <span>{suitSymbols[suit]}</span>{' '}
                      {cards.map((card) => card.slice(1)).join(' ') || '—'}
                    </p>
                  )
                })}
              </section>
            ))}
          </div>
        </details>
      )}
      <p className="muted">
        本副成绩已保存，可在下方查看公开出牌记录与叫牌记录。
      </p>
    </section>
  )
}
