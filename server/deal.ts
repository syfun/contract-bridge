import { randomInt } from 'node:crypto'
import { seats, suits, ranks } from '../shared/protocol.ts'
import type {
  BoardView,
  Card,
  Member,
  RoomState,
  Seat,
} from '../shared/protocol.ts'

export interface StoredBoard {
  number: number
  dealer: Seat
  vulnerability: BoardView['vulnerability']
  turn: Seat
  phase: 'auction'
  occupants: Record<Seat, string | null>
  hands: Record<Seat, Card[]>
}

export function shuffledDeck(): Card[] {
  const deck: Card[] = suits.flatMap((suit) =>
    ranks.map((rank) => `${suit}${rank}` as Card),
  )
  for (let index = deck.length - 1; index > 0; index--) {
    const other = randomInt(index + 1)
    ;[deck[index], deck[other]] = [deck[other], deck[index]]
  }
  return deck
}

export function dealBoard(members: Member[], deck: Card[]): StoredBoard {
  if (
    deck.length !== 52 ||
    new Set(deck).size !== 52 ||
    deck.some((card) => !/^[SHDC](?:[2-9]|10|[JQKA])$/.test(card))
  )
    throw Error('发牌必须是完整且不重复的 52 张牌')
  const hands = {} as Record<Seat, Card[]>
  const occupants = {} as Record<Seat, string | null>
  for (const [index, seat] of seats.entries()) {
    hands[seat] = deck.slice(index * 13, (index + 1) * 13)
    occupants[seat] = members.find((member) => member.seat === seat)?.id ?? null
  }
  return {
    number: 1,
    dealer: 'north',
    vulnerability: 'none',
    turn: 'north',
    phase: 'auction',
    occupants,
    hands,
  }
}

// 明确列举公开字段，内部手牌和未来存档字段不会被对象展开意外传出。
export function visibleBoard(
  board: StoredBoard,
  selfId: string,
): Pick<RoomState, 'board' | 'hand'> {
  const publicSeats = {} as BoardView['seats']
  for (const seat of seats) {
    publicSeats[seat] = {
      memberId: board.occupants[seat],
      controller: board.occupants[seat] ? 'human' : 'computer',
      cardCount: board.hands[seat].length,
    }
  }
  const ownSeat = seats.find((seat) => board.occupants[seat] === selfId)
  return {
    board: {
      number: board.number,
      dealer: board.dealer,
      vulnerability: board.vulnerability,
      turn: board.turn,
      phase: board.phase,
      seats: publicSeats,
    },
    hand: ownSeat ? [...board.hands[ownSeat]] : [],
  }
}
