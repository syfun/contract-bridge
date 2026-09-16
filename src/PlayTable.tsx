import { ConnectionStatus } from './ConnectionStatus.tsx'
import { ScorePanel } from './ScorePanel.tsx'
import { HandPanel } from './HandPanel.tsx'
import { cardLabel } from './card-label.ts'
import { seats, seatNames } from '../shared/protocol.ts'
import type { Card, RoomState, Seat } from '../shared/protocol.ts'

const vulnerabilityNames = {
  none: '双方无局',
  'north-south': '南北有局',
  'east-west': '东西有局',
  both: '双方有局',
}
export function PlayTable({
  state,
  locked,
  onChoose,
  onPlay,
}: {
  state: RoomState
  locked: boolean
  onChoose: (seat: Seat) => void
  onPlay: (seat: Seat, card: Card) => void
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
          <span>
            阶段：
            {board.phase === 'auction'
              ? '叫牌'
              : board.score
                ? '本副结束'
                : board.phase === 'playing'
                  ? '打牌'
                  : board.phase === 'awaiting-score'
                    ? '待结算'
                    : '等待首攻'}
          </span>
        </section>
      )}
      {board?.score && <ScorePanel board={board} />}
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
              {member && member.connection.status !== 'online' && <ConnectionStatus member={member} />}
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
          <h3>
            {board
              ? board.turn
                ? `${seatNames[board.turn]}家${board.phase === 'auction' ? '叫牌' : board.phase === 'opening-lead' ? '首攻' : '出牌'}`
                : board.phase === 'scored'
                  ? '十三墩完成，已结算'
                  : board.phase === 'awaiting-score'
                    ? '十三墩完成，待结算'
                    : '四家不叫，本副结束'
              : '等待牌友入座'}
          </h3>
          <p>南北一队 · 东西一队</p>
        </div>
      </section>
      {board && (
        <>
          <section className="panel trick-panel" aria-label="公开出牌记录">
            <h2>
              {board.score
                ? '公开出牌记录'
                : `当前墩 · 第 ${Math.min(board.tricks.length + 1, 13)} 墩`}
            </h2>
            <p>
              {board.currentTrick.length
                ? board.currentTrick
                    .map(
                      (entry) =>
                        `${seatNames[entry.seat]}家 ${cardLabel(entry.card)}`,
                    )
                    .join(' · ')
                : board.phase === 'scored' || board.phase === 'awaiting-score'
                  ? '十三墩已全部完成。'
                  : board.phase === 'passed-out'
                    ? '本副四家不叫，无出牌记录。'
                    : '等待首引。'}
            </p>
            <p>
              南北{' '}
              {
                board.tricks.filter(
                  (trick) =>
                    trick.winner === 'north' || trick.winner === 'south',
                ).length
              }{' '}
              墩 · 东西{' '}
              {
                board.tricks.filter(
                  (trick) => trick.winner === 'east' || trick.winner === 'west',
                ).length
              }{' '}
              墩
            </p>
            <details open>
              <summary>完整出牌记录 · {board.tricks.length} 墩</summary>
              <ol>
                {board.tricks.map((trick, index) => (
                  <li key={index}>
                    第 {index + 1} 墩：
                    {trick.cards
                      .map(
                        (entry) =>
                          `${seatNames[entry.seat]} ${cardLabel(entry.card)}`,
                      )
                      .join(' → ')}
                    ；{seatNames[trick.winner]}家赢墩
                  </li>
                ))}
              </ol>
            </details>
          </section>
          {!board.score && board.dummy && (
            <HandPanel
              key={`dummy-${state.version}`}
              hand={board.dummy.hand}
              seat={board.dummy.seat}
              dummy
              legal={board.turn === board.dummy.seat ? board.legalCards : []}
              locked={locked}
              onPlay={onPlay}
            />
          )}
          {!board.score && self?.seat && self.seat !== board.dummy?.seat && (
            <HandPanel
              key={`own-${state.version}`}
              hand={state.hand}
              seat={self.seat}
              legal={board.turn === self.seat ? board.legalCards : []}
              locked={locked}
              onPlay={onPlay}
            />
          )}
        </>
      )}
    </div>
  )
}
