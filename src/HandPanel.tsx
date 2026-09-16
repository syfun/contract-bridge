import { useState } from 'react'
import { ranks, suits, seatNames } from '../shared/protocol.ts'
import type { Card, Seat } from '../shared/protocol.ts'
const names = { S: '黑桃', H: '红桃', D: '方块', C: '梅花' }
import { cardLabel, suitSymbols } from './card-label.ts'
function order(card: Card) {
  return (
    suits.indexOf(card[0] as (typeof suits)[number]) * 13 -
    ranks.indexOf(card.slice(1) as (typeof ranks)[number])
  )
}
export function HandPanel({
  hand,
  seat,
  dummy,
  legal,
  locked,
  onPlay,
}: {
  hand: Card[]
  seat: Seat
  dummy?: boolean
  legal: Card[]
  locked: boolean
  onPlay: (seat: Seat, card: Card) => void
}) {
  const [selected, select] = useState<Card | null>(null)
  const playable = selected && legal.includes(selected)
  return (
    <section
      className="panel hand-panel"
      aria-label={dummy ? '明手手牌' : '本人手牌'}
    >
      <div className="hand-heading">
        <h2>
          {seatNames[seat]}家{dummy ? '明手' : '手牌'}
        </h2>
        <small>
          {dummy ? '公开 · 庄家操作' : '本人手牌'} · {hand.length} 张
        </small>
      </div>
      <ul className="hand-cards">
        {[...hand]
          .sort((a, b) => order(a) - order(b))
          .map((card) => {
            const suit = card[0] as keyof typeof suitSymbols
            return (
              <li key={card}>
                <button
                  className={`playing-card ${suit === 'H' || suit === 'D' ? 'red' : ''} ${selected === card ? 'selected' : ''}`}
                  aria-label={`${names[suit]} ${card.slice(1)}`}
                  aria-pressed={selected === card}
                  disabled={locked || !legal.includes(card)}
                  onClick={() => select(card)}
                >
                  <strong>{card.slice(1)}</strong>
                  <span aria-hidden="true">{suitSymbols[suit]}</span>
                </button>
              </li>
            )
          })}
      </ul>
      {legal.length > 0 && (
        <div className="play-confirm">
          <p aria-live="polite">
            {playable
              ? `已选 ${cardLabel(selected)}，请确认出牌。`
              : '请选择一张亮起的合法牌，再确认出牌。'}
          </p>
          <button
            className="primary"
            disabled={locked || !playable}
            onClick={() => {
              if (playable) {
                onPlay(seat, selected)
                select(null)
              }
            }}
          >
            确认出牌
          </button>
        </div>
      )}
      {dummy && <p className="muted">明手由庄家当前控制者操作。</p>}
    </section>
  )
}
