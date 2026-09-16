import { ranks, seats, seatNames, suits } from '../shared/protocol.ts'
import type { Card, RoomState, Seat } from '../shared/protocol.ts'

const suitSymbols = { S: '♠', H: '♥', D: '♦', C: '♣' }
const suitNames = { S: '黑桃', H: '红桃', D: '方块', C: '梅花' }
const vulnerabilityNames = {
  none: '双方无局',
  'north-south': '南北有局',
  'east-west': '东西有局',
  both: '双方有局',
}
function cardOrder(card: Card) {
  return (
    suits.indexOf(card[0] as (typeof suits)[number]) * 13 -
    ranks.indexOf(card.slice(1) as (typeof ranks)[number])
  )
}

export function PlayTable({
  state,
  locked,
  onChoose,
}: {
  state: RoomState
  locked: boolean
  onChoose: (seat: Seat) => void
}) {
  const self = state.members.find((member) => member.id === state.selfId)
  const board = state.board
  if (board && !self?.seat)
    return (
      <section className="panel waiting">
        <span aria-hidden="true">♣</span>
        <h2>等待下一副入座</h2>
        <p>
          本副已经开始，你的加入信息已保存。
          <br />
          当前无法选座或查看手牌。
        </p>
      </section>
    )
  return (
    <div className="play-area">
      {board && (
        <section className="board-summary" aria-label="本副信息">
          <strong>第 {board.number} 副</strong>
          <span>发牌人：{seatNames[board.dealer]}家</span>
          <span>{vulnerabilityNames[board.vulnerability]}</span>
          <span>阶段：叫牌</span>
        </section>
      )}
      <section className="table" aria-label="四方座位">
        {seats.map((seat) => {
          const member = state.members.find((m) => m.seat === seat)
          const mine = member?.id === state.selfId
          const label = member?.nickname ?? (board ? '电脑牌手' : '虚位以待')
          return (
            <button
              key={seat}
              className={`seat ${seat} ${mine ? 'mine' : ''} ${board?.turn === seat ? 'acting' : ''}`}
              disabled={locked || !!member || !!board}
              onClick={() => onChoose(seat)}
              aria-label={`${seatNames[seat]}家，${board ? `${label}，${board.seats[seat].cardCount} 张牌` : (member?.nickname ?? '空位，点击入座')}`}
            >
              <span className="direction">{seatNames[seat]}</span>
              <strong>{label}</strong>
              <small>
                {member
                  ? `${mine ? '你 · ' : ''}${member.id === state.hostId ? '房主' : '已入座'}`
                  : board
                    ? '电脑座位'
                    : '点击入座'}
              </small>
              {board && (
                <span className="card-count">
                  {board.seats[seat].cardCount} 张牌
                  {board.turn === seat ? ' · 行动方' : ''}
                </span>
              )}
            </button>
          )
        })}
        <div className="table-center">
          <span aria-hidden="true">♣</span>
          <h3>{board ? `${seatNames[board.turn]}家叫牌` : '等待牌友入座'}</h3>
          <p>南北一队 · 东西一队</p>
        </div>
      </section>
      {board && (
        <section className="panel hand-panel" aria-label="本人手牌">
          <div className="hand-heading">
            <h2>{self?.seat && seatNames[self.seat]}家手牌</h2>
            <small>仅你可见 · {state.hand.length} 张</small>
          </div>
          <ul className="hand-cards">
            {[...state.hand]
              .sort((a, b) => cardOrder(a) - cardOrder(b))
              .map((card) => {
                const suit = card[0] as keyof typeof suitSymbols
                return (
                  <li
                    key={card}
                    className={`playing-card ${suit === 'H' || suit === 'D' ? 'red' : ''}`}
                    aria-label={`${suitNames[suit]} ${card.slice(1)}`}
                  >
                    <strong>{card.slice(1)}</strong>
                    <span aria-hidden="true">{suitSymbols[suit]}</span>
                  </li>
                )
              })}
          </ul>
          <p className="muted">已发牌。叫牌操作及电脑自动行动将在后续开放。</p>
        </section>
      )}
    </div>
  )
}
