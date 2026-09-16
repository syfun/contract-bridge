import { ConnectionStatus } from './ConnectionStatus.tsx'
import { ScorePanel } from './ScorePanel.tsx'
import { HandPanel } from './HandPanel.tsx'
import { PlayHistory } from './PlayHistory.tsx'
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
  seatLocked,
  onChoose,
  onPlay,
}: {
  state: RoomState
  locked: boolean
  seatLocked: boolean
  onChoose: (seat: Seat) => void
  onPlay: (seat: Seat, card: Card) => void
}) {
  const self = state.members.find((member) => member.id === state.selfId)
  const board = state.board
  if (board && !board.score && !self?.seat)
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
      <div className="play-surface">
        <div className="table-and-hands">
          <section className="table" aria-label="四方座位">
            {seats.map((seat) => {
              const member = state.members.find((m) => m.seat === seat)
              const mine = member?.id === state.selfId
              const label = member?.nickname ?? (board ? '电脑牌手' : '虚位以待')
              return (
                <button
                  key={seat}
                  className={`seat ${seat} ${mine ? 'mine' : ''} ${board?.turn === seat ? 'acting' : ''}`}
                  disabled={seatLocked || !!member || (!!board && !board.score)}
                  onClick={() => onChoose(seat)}
                  aria-label={`${seatNames[seat]}家，${board ? `${label}，${board.seats[seat].cardCount} 张牌` : (member?.nickname ?? '空位，点击入座')}`}
                >
                  <span className="direction">{seatNames[seat]}</span>
                  <strong>{label}</strong>
                  <small>
                    {member
                      ? `${mine ? '你 · ' : ''}${member.id === state.hostId ? '房主' : '已入座'}`
                      : board?.score
                        ? '点击接替，准备下一副'
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
        {board && board.phase !== 'auction' && (
          <PlayHistory key={`${state.code}-${board.number}`} board={board} />
        )}
      </div>
    </div>
  )
}
