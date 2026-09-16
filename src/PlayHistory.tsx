import { useLayoutEffect, useRef, useState } from 'react'
import { cardLabel } from './card-label.ts'
import { seatNames } from '../shared/protocol.ts'
import type { BoardView, Seat } from '../shared/protocol.ts'

const columns: Seat[] = ['east', 'south', 'west', 'north']

export function PlayHistory({ board }: { board: BoardView }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const [hasNewCards, setHasNewCards] = useState(false)
  const [atLatest, setAtLatest] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const cardCount = board.tricks.length * 4 + board.currentTrick.length
  function goToLatest() {
    following.current = true
    const list = scrollRef.current
    if (list) list.scrollTop = list.scrollHeight
    setAtLatest(true)
    setHasNewCards(false)
  }
  useLayoutEffect(() => {
    if (following.current) goToLatest()
    else setHasNewCards(true)
  }, [cardCount])
  useLayoutEffect(() => {
    if (following.current) goToLatest()
  }, [expanded])
  const rows = [
    ...board.tricks,
    ...((board.phase === 'playing' || board.phase === 'opening-lead') && board.tricks.length < 13
      ? [{ cards: board.currentTrick, winner: null }]
      : []),
  ]
  const northSouth = board.tricks.filter(t => t.winner === 'north' || t.winner === 'south').length
  return <section className={`panel history-panel ${expanded ? 'is-expanded' : ''}`} aria-label="公开出牌记录">
    <header className="history-heading">
      <div><h2>出牌记录</h2><p>第 {board.number} 副 · 南北 {northSouth} 墩 · 东西 {board.tricks.length - northSouth} 墩</p></div>
      <button className="history-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起记录' : '展开记录'}</button>
    </header>
    <div ref={scrollRef} className="history-scroll" role="region" aria-label="出牌记录列表" tabIndex={0}
      onScroll={event => {
        const list = event.currentTarget
        following.current = list.scrollHeight - list.clientHeight - list.scrollTop < 4
        setAtLatest(following.current)
        if (following.current) setHasNewCards(false)
      }}>
      <table className="history-table">
        <thead><tr><th scope="col">墩</th>{columns.map(seat => <th scope="col" key={seat}>{seatNames[seat]}</th>)}</tr></thead>
        <tbody>{rows.map((trick, index) => <tr key={index} className={trick.winner ? '' : 'current-trick'}>
          <th scope="row">{index + 1}{!trick.winner && <small>当前</small>}</th>
          {columns.map(seat => {
            const entry = trick.cards.find(card => card.seat === seat)
            return <td key={seat}>
              {entry && <>
                <span className={entry.card.startsWith('H') || entry.card.startsWith('D') ? 'red' : ''}>{cardLabel(entry.card)}</span>
                <small>{trick.cards[0]?.seat === seat && <span>首引</span>}{trick.winner === seat && <span>赢墩</span>}</small>
              </>}
            </td>
          })}
        </tr>)}</tbody>
      </table>
      {cardCount === 0 && <p className="history-empty">{board.phase === 'passed-out' ? '本副四家不叫，无出牌记录。' : '等待首引。'}</p>}
    </div>
    <div className="history-updates">
      <span role="status">{hasNewCards ? '有新出牌' : atLatest ? '已到最新' : '正在查看旧记录'}</span>
      <button onClick={goToLatest} disabled={atLatest}>回到最新</button>
    </div>
  </section>
}
