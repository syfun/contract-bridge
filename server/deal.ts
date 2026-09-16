import { dummySeat, legalCards, playController } from './play.ts'
import { legalCalls } from './auction.ts'
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
  turn: Seat | null
  phase: BoardView['phase']
  auction: BoardView['auction']
  contract: BoardView['contract']
  occupants: Record<Seat, string | null>
  currentTrick?: BoardView['currentTrick']
  tricks?: BoardView['tricks']
  score?: BoardView['score']
  ready?: Partial<Record<Seat, boolean>>
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

const vulnerabilities: BoardView['vulnerability'][] = [
  'none', 'north-south', 'east-west', 'both',
  'north-south', 'east-west', 'both', 'none',
  'east-west', 'both', 'none', 'north-south',
  'both', 'none', 'north-south', 'east-west',
]

export function dealBoard(
  members: Member[],
  deck: Card[],
  number = 1,
): StoredBoard {
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
    number,
    dealer: seats[(number - 1) % 4],
    vulnerability: vulnerabilities[(number - 1) % 16],
    turn: seats[(number - 1) % 4],
    phase: 'auction',
    auction: [],
    contract: null,
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
      ready: Boolean(
        board.score && (board.occupants[seat] === null || board.ready?.[seat]),
      ),
      memberId: board.occupants[seat],
      controller: board.occupants[seat] ? 'human' : 'computer',
      cardCount: board.hands[seat].length,
    }
  }
  const ownSeat = seats.find((seat) => board.occupants[seat] === selfId)
  return {
    board: {
      score: board.score ? structuredClone(board.score) : null,
      reviewHands: ownSeat && board.score ? originalHands(board) : null,
      number: board.number,
      dealer: board.dealer,
      vulnerability: board.vulnerability,
      turn: board.turn,
      phase: board.phase,
      seats: publicSeats,
      auction: board.auction ?? [],
      contract: board.contract ?? null,
      currentTrick: structuredClone(board.currentTrick ?? []),
      tricks: structuredClone(board.tricks ?? []),
      dummy:
        ownSeat &&
        (board.phase === 'playing' || board.phase === 'awaiting-score')
          ? {
              seat: dummySeat(board)!,
              hand: [...board.hands[dummySeat(board)!]],
            }
          : null,
      legalCards: playController(board) === selfId ? legalCards(board) : [],
      legalCalls: ownSeat === board.turn ? legalCalls(board) : [],
    },
    hand: ownSeat ? [...board.hands[ownSeat]] : [],
  }
}

// 已出牌记录加上剩余手牌可完整还原发牌，兼容没有原始手牌字段的旧存档。
function originalHands(board: StoredBoard): Record<Seat, Card[]> {
  const hands = structuredClone(board.hands)
  for (const entry of [
    ...(board.tricks ?? []).flatMap((trick) => trick.cards),
    ...(board.currentTrick ?? []),
  ])
    hands[entry.seat].push(entry.card)
  return hands
}
