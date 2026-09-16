import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suggestAuction } from './computer/auction-strategy.ts'
import { legalCalls, applyCall } from './auction.ts'
import { dealBoard } from './deal.ts'
import { ranks, suits, seats } from '../shared/protocol.ts'
import type { Card, Call } from '../shared/protocol.ts'
import type { AuctionInput } from '../shared/computer-auction.ts'

function hand(text: string): Card[] {
  return text
    .split('/')
    .flatMap((part, i) =>
      [...part]
        .filter((r) => r !== '-')
        .map((r) => `${suits[i]}${r === 'T' ? '10' : r}` as Card),
    )
}
function input(cards: string, calls: string[] = []): AuctionInput {
  const board = dealBoard(
    [],
    suits.flatMap((s) => ranks.map((r) => `${s}${r}` as Card)),
  )
  for (const call of calls) assert.ok(applyCall(board, parse(call)), call)
  return {
    version: calls.length,
    seat: board.turn!,
    dealer: board.dealer,
    vulnerability: board.vulnerability,
    hand: hand(cards),
    auction: board.auction,
    legalCalls: legalCalls(board),
  }
}
function parse(text: string): Call {
  if (text === 'P') return { kind: 'pass' }
  if (text === 'X') return { kind: 'double' }
  if (text === 'XX') return { kind: 'redouble' }
  return {
    kind: 'bid',
    level: Number(text[0]),
    denomination: text.slice(1) as 'C' | 'D' | 'H' | 'S' | 'NT',
  }
}
test('O03：16 HCP 均型无五张高花开叫 1NT', () => {
  const result = suggestAuction(input('AK3/QJ4/KQ32/J54'))!
  assert.deepEqual(result.call, parse('1NT'))
  assert.equal(result.rule, 'O03')
})

const hands: Record<string, string> = {
  A: 'AK3/QJ4/KQ32/J54',
  B: 'AKJ54/KQ3/A32/54',
  C: 'AKQ3/AK4/AQ32/K5',
  D: '84/KQJ976/32/754',
  E: 'K84/QJ76/K32/A54',
  F: 'Q84/KJ76/Q32/754',
  G: 'KQ84/AJ76/K32/54',
  H: 'KJ876/Q43/32/754',
  I: 'KJ876/A43/Q32/54',
  J: 'KQ876/A43/K32/Q4',
  K: '84/973/8632/7542',
  L: 'KQJ876/A43/32/54',
  M: 'AKQ876/A43/K2/54',
  N: 'KQJ876/AK3/A2/K4',
  O: 'KQ4/AJ3/KQ32/A54',
  P: 'KQ4/AJ3/KQ32/K54',
  Q: 'KQJ876/43/32/754',
  R: 'KQ4/AJ76/K32/Q54',
  S: 'KQ4/AJ76/2/KQ543',
  T: 'AKQ876/AK3/A2/K4',
  U: 'AKQJ76/AK3/A2/K4',
  V: '84/973/KQJ632/54',
  W: 'Q84/J76/32/KQ754',
  X: 'KQ4/AJ76/K32/654',
  Y: 'KQ4/AJ76/KQ32/A5',
  Z: 'AKQ4/AK3/KQ32/54',
  AA: '84/AQ3/K32/KJ754',
  AB: '84/QJ3/K32/J7542',
  AC: '8/AKJ4/K32/AQ754',
  AD: 'KQ84/AJ76/2/K543',
  AE: '84/QJ3/K32/K7542',
  AF: 'K84/AJ976/K32/Q4',
  AG: 'KQ876/AJ76/K32/5',
}

function check(
  label: string,
  cards: string,
  sequence: string[],
  expected: string,
  rule: string,
) {
  test(label, () => {
    const view = input(hands[cards] ?? cards, sequence)
    assert.equal(view.hand.length, 13)
    assert.equal(new Set(view.hand).size, 13)
    for (const vulnerability of [
      'none',
      'north-south',
      'east-west',
      'both',
    ] as const) {
      for (const shift of [0, 1, 2, 3]) {
        const rotate = (seat: (typeof seats)[number]) =>
          seats[(seats.indexOf(seat) + shift) % 4]
        const rotated = {
          ...view,
          vulnerability,
          seat: rotate(view.seat),
          dealer: rotate(view.dealer),
          auction: view.auction.map((e) => ({ ...e, seat: rotate(e.seat) })),
        }
        for (let repeat = 0; repeat < 20; repeat++) {
          const result = suggestAuction(rotated)!
          assert.deepEqual(result?.call, parse(expected))
          assert.equal(result.rule, rule)
          assert.equal(result.version, view.version)
          assert.ok(
            rotated.legalCalls.some(
              (call) => JSON.stringify(call) === JSON.stringify(result.call),
            ),
          )
        }
      }
    }
  })
}
for (const [cards, expected, rule] of [
  ['C', '2C', 'O01'],
  ['T', '2C', 'O01'],
  ['Z', '2NT', 'O02'],
  ['B', '1S', 'O04'],
  ['E', '1C', 'O04'],
  ['Y', '1D', 'O04'],
  ['D', '2H', 'O05'],
  ['Q', '2S', 'O05'],
  ['V', '2D', 'O05'],
  ['L', '2S', 'O05'],
  ['K', 'P', 'O06'],
  ['H', 'P', 'O06'],
])
  check(`${rule} 开叫 ${cards}`, cards, [], expected, rule)

const team = (sequence: string) =>
  sequence.split(' ').flatMap((call) => [call, 'P'])
for (const [sequence, cards, expected, rule] of [
  ['1S', 'F', '2S', 'R01'],
  ['1S', 'I', '3S', 'R01'],
  ['1S', 'J', '4S', 'R01'],
  ['1C', 'G', '1H', 'R02'],
  ['1C', 'H', '1S', 'R02'],
  ['1D', 'O', '3NT', 'R03'],
  ['1D', 'E', '1H', 'R02'],
  ['1S', 'AA', '2C', 'R04'],
  ['1S', 'S', '4S', 'R01'],
  ['1C', 'W', '2C', 'R05'],
  ['1S', 'AB', '1NT', 'R06'],
  ['1H', 'K', 'P', 'R07'],
])
  check(`${rule} ${sequence} ${cards}`, cards, team(sequence), expected, rule)
for (const [sequence, cards, expected, rule] of [
  ['1S 4S', 'B', 'P', 'B01'],
  ['1S 2S', 'B', '3S', 'B02'],
  ['1S 3S', 'B', '4S', 'B02'],
  ['1D 2D', 'Y', '3NT', 'B03'],
  ['1C 2NT', 'E', 'P', 'B03'],
  ['1C 1H', 'E', '2H', 'B04'],
  ['1D 1S', 'Y', '2NT', 'B05'],
  ['1C 1S', 'E', '1NT', 'B05'],
  ['1S 1NT', 'M', '3S', 'B06'],
  ['1S 1NT', 'N', '4S', 'B06'],
  ['1C 1S', 'S', '2C', 'G05'],
  ['1C 1S', 'AC', '2H', 'B07'],
  ['1S 1NT', 'B', '2NT', 'B08'],
  ['1C 1H 2H', 'G', '4H', 'F01'],
  ['1C 1H 2H', 'F', 'P', 'F01'],
  ['1C 1S 1NT', 'J', '3NT', 'F02'],
  ['1C 1S 1NT', 'H', 'P', 'F02'],
  ['1S 1NT 3S', 'AE', '4S', 'F03'],
  ['1S 1NT 3S', 'K', 'P', 'F03'],
  ['1C 1S 2H', 'AG', '4H', 'F04'],
  ['1D 2C 3D', 'W', 'P', 'G05'],
  ['1C 1S 4NT', 'K', 'P', 'G05'],
])
  check(`${rule} ${sequence} ${cards}`, cards, team(sequence), expected, rule)

for (const [sequence, cards, expected, rule] of [
  ['1NT', 'H', '2H', 'N01'],
  ['1NT', 'I', '2H', 'N01'],
  ['1NT', 'J', '2H', 'N01'],
  ['1NT', 'D', '2D', 'N01'],
  ['1NT', 'F', '2C', 'N02'],
  ['1NT', 'G', '2C', 'N02'],
  ['1NT 2D', 'A', '2H', 'N03'],
  ['1NT 2C', 'R', '2H', 'N04'],
  ['1NT 2C', 'A', '2D', 'N04'],
  ['1NT 2H 2S', 'H', 'P', 'N05'],
  ['1NT 2H 2S', 'I', '3NT', 'N05'],
  ['1NT 2H 2S', 'J', '3NT', 'N05'],
  ['1NT 2H 2S', 'L', '4S', 'N05'],
  ['1NT 2C 2H', 'F', '3H', 'N06'],
  ['1NT 2C 2H', 'G', '4H', 'N06'],
  ['1NT 2C 2D', 'G', '3NT', 'N06'],
  ['1NT 2H 2S 3NT', 'A', '4S', 'N07'],
  ['1NT 2C 2H 3H', 'R', 'P', 'N08'],
  ['1NT', 'K', 'P', 'N09'],
  ['1NT', 'W', '2NT', 'N09'],
  ['1NT', 'O', '3NT', 'N09'],
  ['2NT', 'K', 'P', 'N10'],
  ['2NT', 'H', '3NT', 'N10'],
])
  check(`${rule} ${sequence} ${cards}`, cards, team(sequence), expected, rule)
for (const [sequence, cards, expected, rule] of [
  ['2C', 'K', '2D', 'S01'],
  ['2C 2D', 'C', '3NT', 'S02'],
  ['2C 2D', 'T', '2S', 'S02'],
  ['2C 2D 2S', 'K', 'P', 'S03'],
  ['2C 2D 2S', 'G', '4S', 'S03'],
  ['2C 2D 2S', 'E', '3NT', 'S03'],
  ['2S', 'A', '4S', 'W01'],
  ['2S', 'K', 'P', 'W01'],
  ['2D', 'A', '3NT', 'W01'],
  ['2H 4H', 'D', 'P', 'W02'],
  ['2H 2NT', 'D', 'P', 'G05'],
])
  check(`${rule} ${sequence} ${cards}`, cards, team(sequence), expected, rule)
for (const [sequence, cards, expected, rule] of [
  ['1H', 'A', '1NT', 'C01'],
  ['1D', 'AD', 'X', 'C02'],
  ['1H', 'L', '1S', 'C03'],
  ['1S', 'AA', '2C', 'C03'],
  ['1D X P', 'H', '1S', 'C04'],
  ['1D X P', 'K', '2C', 'C04'],
  ['1H 1S P', 'F', '2S', 'C05'],
  ['1H 1S P', 'E', '3S', 'C05'],
  ['1H 1S P', 'B', '4S', 'C05'],
  ['1H 1NT P', 'I', '3NT', 'C05'],
  ['1H P 2H 2S', 'AF', '3H', 'C06'],
  ['1NT X', 'F', 'P', 'C07'],
  ['1NT P 2D 2S', 'A', 'P', 'C07'],
  ['2C 2H', 'K', 'P', 'C07'],
  ['1NT P 2D X', 'A', 'P', 'C07'],
  ['1NT P 2C P 2H X', 'G', 'P', 'C07'],
  ['1H P 2H 2S 3H 3S', 'F', 'P', 'C07'],
])
  check(
    `${rule} 竞争 ${sequence} ${cards}`,
    cards,
    sequence.split(' '),
    expected,
    rule,
  )

// 仅用独立 HCP 定义构造边界牌；期望叫品由约定表人工列定。
function shapedHand(lengths: number[], points: number): string {
  const faces = '23456789TJQKA'
  const options = lengths.map((length) => {
    const byPoints = new Map<number, string>()
    for (let mask = 0; mask < 8192; mask++) {
      let cards = '',
        hcp = 0
      for (let i = 0; i < 13; i++)
        if (mask & (1 << i)) {
          cards += faces[i]
          hcp += Math.max(0, i - 8)
        }
      if (cards.length === length && !byPoints.has(hcp))
        byPoints.set(hcp, cards)
    }
    return [...byPoints]
  })
  function find(index: number, remaining: number): string[] | null {
    if (index === 4) return remaining === 0 ? [] : null
    for (const [hcp, cards] of options[index]) {
      if (hcp > remaining) continue
      const rest = find(index + 1, remaining - hcp)
      if (rest) return [cards, ...rest]
    }
    return null
  }
  const result = find(0, points)
  assert.ok(result)
  return result.join('/')
}
for (const [points, expected, rule] of [
  [11, 'P', 'O06'],
  [12, '1C', 'O04'],
  [14, '1C', 'O04'],
  [15, '1NT', 'O03'],
  [17, '1NT', 'O03'],
  [18, '1C', 'O04'],
  [19, '1C', 'O04'],
  [20, '2NT', 'O02'],
  [21, '2NT', 'O02'],
  [22, '2C', 'O01'],
] as const)
  check(
    `开叫均型边界 ${points}`,
    shapedHand([4, 3, 3, 3], points),
    [],
    expected,
    rule,
  )
for (const [points, expected, rule] of [
  [5, 'P', 'R07'],
  [6, '2S', 'R01'],
  [9, '2S', 'R01'],
  [10, '3S', 'R01'],
  [12, '3S', 'R01'],
  [13, '4S', 'R01'],
] as const)
  check(
    `R01 三张支持边界 ${points}`,
    shapedHand([3, 3, 4, 3], points),
    team('1S'),
    expected,
    rule,
  )
for (const [points, expected] of [
  [10, '2NT'],
  [12, '2NT'],
  [13, '3NT'],
] as const)
  check(
    `R03 均型边界 ${points}`,
    shapedHand([3, 3, 3, 4], points),
    team('1D'),
    expected,
    'R03',
  )
for (const [points, expected] of [
  [12, 'P'],
  [15, 'P'],
  [16, '3S'],
  [18, '3S'],
  [19, '4S'],
  [21, '4S'],
] as const)
  check(
    `B02 二阶加叫边界 ${points}`,
    shapedHand([5, 3, 3, 2], points),
    team('1S 2S'),
    expected,
    'B02',
  )
for (const [points, expected] of [
  [12, 'P'],
  [14, 'P'],
  [15, '4S'],
  [21, '4S'],
] as const)
  check(
    `B02 三阶邀请边界 ${points}`,
    shapedHand([5, 3, 3, 2], points),
    team('1S 3S'),
    expected,
    'B02',
  )
for (const [points, expected] of [
  [12, '1NT'],
  [14, '1NT'],
  [15, '2NT'],
  [19, '2NT'],
  [20, '3NT'],
  [21, '3NT'],
] as const)
  check(
    `B05 自然无将边界 ${points}`,
    shapedHand([3, 3, 3, 4], points),
    team('1C 1S'),
    expected,
    'B05',
  )
for (const [points, expected] of [
  [12, '2S'],
  [15, '2S'],
  [16, '3S'],
  [18, '3S'],
  [19, '4S'],
  [21, '4S'],
] as const)
  check(
    `B06 六张套边界 ${points}`,
    shapedHand([6, 3, 2, 2], points),
    team('1S 1NT'),
    expected,
    'B06',
  )
for (const [points, expected] of [
  [12, 'P'],
  [15, 'P'],
  [16, '2NT'],
  [18, '2NT'],
  [19, '3NT'],
  [21, '3NT'],
] as const)
  check(
    `B08 五张套边界 ${points}`,
    shapedHand([5, 3, 3, 2], points),
    team('1S 1NT'),
    expected,
    'B08',
  )
for (const length of [5, 6])
  for (const [points, five, six] of [
    [0, 'P', 'P'],
    [7, 'P', 'P'],
    [8, '2NT', '3S'],
    [9, '2NT', '3S'],
    [10, '3NT', '4S'],
  ] as const)
    check(
      `N05 转移 ${length} 张 ${points}`,
      shapedHand([length, 3, 2, 8 - length], points),
      team('1NT 2H 2S'),
      length === 5 ? five : six,
      'N05',
    )
for (const [points, expected] of [
  [15, '3S'],
  [16, '3S'],
  [17, '4S'],
] as const)
  check(
    `N07 2NT 邀请八张配合 ${points}`,
    shapedHand([3, 3, 4, 3], points),
    team('1NT 2H 2S 2NT'),
    expected,
    'N07',
  )
for (const [points, expected] of [
  [15, 'P'],
  [16, 'P'],
  [17, '3NT'],
] as const)
  check(
    `N07 无配合邀请 ${points}`,
    shapedHand([2, 3, 4, 4], points),
    team('1NT 2H 2S 2NT'),
    expected,
    'N07',
  )
for (const [points, expected] of [
  [22, '2NT'],
  [24, '2NT'],
  [25, '3NT'],
] as const)
  check(
    `S02 强无将边界 ${points}`,
    shapedHand([4, 3, 3, 3], points),
    team('2C 2D'),
    expected,
    'S02',
  )
for (const [points, expected] of [
  [0, 'P'],
  [3, 'P'],
  [4, '4S'],
] as const)
  check(
    `S03 四张支持边界 ${points}`,
    shapedHand([4, 3, 3, 3], points),
    team('2C 2D 2S'),
    expected,
    'S03',
  )
check(
  'S03 三张支持不算八张配合',
  shapedHand([3, 3, 4, 3], 4),
  team('2C 2D 2S'),
  '3NT',
  'S03',
)
for (const [points, expected] of [
  [15, 'P'],
  [16, '4S'],
] as const)
  check(
    `W01 三张支持边界 ${points}`,
    shapedHand([3, 3, 4, 3], points),
    team('2S'),
    expected,
    'W01',
  )
check('W01 两张支持不足', shapedHand([2, 4, 4, 3], 16), team('2S'), 'P', 'W01')

test('G01 无合法行动不建议；候选不合法时不机械抬阶', () => {
  const view = input(hands.A)
  assert.equal(suggestAuction({ ...view, legalCalls: [] }), null)
  const withoutNT = {
    ...view,
    legalCalls: view.legalCalls.filter(
      (c) => !(c.kind === 'bid' && c.level === 1 && c.denomination === 'NT'),
    ),
  }
  assert.deepEqual(suggestAuction(withoutNT)!.call, parse('1D'))
})
test('四座次及四局况均使用同样点力门槛与约定', () => {
  const view = input(hands.F, team('1NT'))
  for (const vulnerability of [
    'none',
    'north-south',
    'east-west',
    'both',
  ] as const)
    for (const shift of [0, 1, 2, 3]) {
      const order = ['north', 'east', 'south', 'west'] as const
      const moved = {
        ...view,
        vulnerability,
        dealer: order[shift],
        seat: order[(shift + 2) % 4],
        auction: view.auction.map((entry) => ({
          ...entry,
          seat: order[(order.indexOf(entry.seat) + shift) % 4],
        })),
      }
      assert.equal(suggestAuction(moved)!.rule, 'N02')
      assert.deepEqual(suggestAuction(moved)!.call, parse('2C'))
    }
})
for (const [points, expected, rule] of [
  [5, 'P', 'R07'],
  [6, '1H', 'R02'],
  [9, '1H', 'R02'],
  [10, '1H', 'R02'],
] as const)
  check(
    `R02 四张高花 ${points}`,
    shapedHand([3, 4, 3, 3], points),
    team('1C'),
    expected,
    rule,
  )
for (const [points, expected, rule] of [
  [9, '1NT', 'R06'],
  [10, '2H', 'R04'],
  [12, '2H', 'R04'],
  [13, '2H', 'R04'],
] as const)
  check(
    `R04 五张红桃 ${points}`,
    shapedHand([2, 5, 3, 3], points),
    team('1S'),
    expected,
    rule,
  )
check(
  'R04 红桃差一张则选梅花',
  shapedHand([2, 4, 3, 4], 10),
  team('1S'),
  '2C',
  'R04',
)
for (const [points, expected, rule] of [
  [5, 'P', 'R07'],
  [6, '2C', 'R05'],
  [9, '2C', 'R05'],
  [10, '3C', 'R05'],
  [12, '3C', 'R05'],
  [13, '5C', 'R05'],
] as const)
  check(
    `R05 非均型低花支持 ${points}`,
    shapedHand([3, 3, 1, 6], points),
    team('1C'),
    expected,
    rule,
  )
for (const [points, expected] of [
  [12, '2H'],
  [15, '2H'],
  [16, '3H'],
  [18, '3H'],
  [19, '4H'],
  [21, '4H'],
] as const)
  check(
    `B04 四张高花支持 ${points}`,
    shapedHand([3, 4, 3, 3], points),
    team('1C 1H'),
    expected,
    'B04',
  )
for (const [points, expected] of [
  [12, 'P'],
  [18, 'P'],
  [19, '3NT'],
  [21, '3NT'],
] as const)
  check(
    `B03 低花加叫 ${points}`,
    shapedHand([3, 3, 4, 3], points),
    team('1D 2D'),
    expected,
    'B03',
  )
for (const [points, expected] of [
  [14, 'P'],
  [15, '3NT'],
  [21, '3NT'],
] as const)
  check(
    `B03 2NT 邀请 ${points}`,
    shapedHand([3, 3, 3, 4], points),
    team('1C 2NT'),
    expected,
    'B03',
  )
for (const [points, expected, rule] of [
  [16, '2C', 'G05'],
  [17, '2H', 'B07'],
] as const)
  check(
    `B07 逆叫边界 ${points}`,
    shapedHand([1, 4, 3, 5], points),
    team('1C 1S'),
    expected,
    rule,
  )
for (const [points, expected] of [
  [12, 'P'],
  [13, '4H'],
] as const)
  check(
    `F01 合计24/25 ${points}`,
    shapedHand([3, 4, 3, 3], points),
    team('1C 1H 2H'),
    expected,
    'F01',
  )
for (const [points, expected] of [
  [12, 'P'],
  [13, '3NT'],
] as const)
  check(
    `F02 合计24/25 ${points}`,
    shapedHand([4, 3, 3, 3], points),
    team('1C 1S 1NT'),
    expected,
    'F02',
  )
for (const [points, expected] of [
  [8, 'P'],
  [9, '4S'],
] as const)
  check(
    `F03 合计24/25 ${points}`,
    shapedHand([2, 3, 3, 5], points),
    team('1S 1NT 3S'),
    expected,
    'F03',
  )
check(
  'F03 一张支持不足',
  shapedHand([1, 4, 3, 5], 10),
  team('1S 1NT 3S'),
  'P',
  'F03',
)
for (const [points, expected] of [
  [7, 'P'],
  [8, '4H'],
] as const)
  check(
    `F04 合计24/25 ${points}`,
    shapedHand([4, 4, 3, 2], points),
    team('1C 1S 2H'),
    expected,
    'F04',
  )
check(
  'F04 三张支持不足',
  shapedHand([4, 3, 3, 3], 13),
  team('1C 1S 2H'),
  'P',
  'F04',
)
for (const [points, expected, rule] of [
  [7, 'P', 'N09'],
  [8, '2C', 'N02'],
  [9, '2C', 'N02'],
  [10, '2C', 'N02'],
] as const)
  check(
    `N02 四张高花 ${points}`,
    shapedHand([4, 3, 3, 3], points),
    team('1NT'),
    expected,
    rule,
  )
for (const [points, expected] of [
  [8, '3H'],
  [9, '3H'],
  [10, '4H'],
] as const)
  check(
    `N06 有配合 ${points}`,
    shapedHand([3, 4, 3, 3], points),
    team('1NT 2C 2H'),
    expected,
    'N06',
  )
for (const [points, expected] of [
  [8, '2NT'],
  [9, '2NT'],
  [10, '3NT'],
] as const)
  check(
    `N06 无配合 ${points}`,
    shapedHand([4, 3, 3, 3], points),
    team('1NT 2C 2H'),
    expected,
    'N06',
  )
for (const [points, expected] of [
  [15, 'P'],
  [16, 'P'],
  [17, '4H'],
] as const)
  check(
    `N08 邀请 ${points}`,
    shapedHand([3, 4, 3, 3], points),
    team('1NT 2C 2H 3H'),
    expected,
    'N08',
  )
for (const [points, expected] of [
  [0, 'P'],
  [7, 'P'],
  [8, '2NT'],
  [9, '2NT'],
  [10, '3NT'],
] as const)
  check(
    `N09 无高花 ${points}`,
    shapedHand([3, 3, 4, 3], points),
    team('1NT'),
    expected,
    'N09',
  )
for (const [points, expected] of [
  [15, 'P'],
  [16, 'P'],
  [17, '3NT'],
] as const)
  check(
    `N09 接受邀请 ${points}`,
    shapedHand([3, 3, 4, 3], points),
    team('1NT 2NT'),
    expected,
    'N09',
  )
for (const [points, expected] of [
  [0, 'P'],
  [4, 'P'],
  [5, '3NT'],
] as const)
  check(
    `N10 首次应叫 ${points}`,
    shapedHand([3, 3, 4, 3], points),
    team('2NT'),
    expected,
    'N10',
  )
check(
  'N04 两门四张先红桃',
  shapedHand([4, 4, 3, 2], 16),
  team('1NT 2C'),
  '2H',
  'N04',
)
check(
  'N04 仅四张黑桃',
  shapedHand([4, 3, 3, 3], 16),
  team('1NT 2C'),
  '2S',
  'N04',
)
check('O05 五张套不弱开叫', 'KQJ87/943/32/754', [], 'P', 'O06')
check('O05 七张套不弱开叫', 'KQJ8765/43/32/54', [], 'P', 'O06')
check('O05 另一四张高花不弱开叫', 'KQJ876/9432/3/54', [], 'P', 'O06')
check('O05 质量不足不弱开叫', 'KJ9876/A43/32/54', [], 'P', 'O06')
check('C01 敌花无止张不争叫无将', 'AK3/943/KQ32/KJ4', ['1H'], 'P', 'C07')
check('C01 十八点有止张', 'P', ['1H'], '1NT', 'C01')
check('C01 十九点不用宽范围争叫', 'O', ['1H'], 'P', 'C07')
check('C02 未叫高花差一张不技术加倍', 'KQ8/AJ76/32/K543', ['1D'], 'P', 'C07')
check('C03 质量不足不能争叫', 'A9876/432/K32/54', ['1H'], 'P', 'C07')
check('C03 超二阶不争叫', 'AA', ['2S'], 'P', 'C07')
check('C07 敌方1NT不套用自然花色竞争', 'AD', ['1NT'], 'P', 'C07')
check('C07 敌方多次非Pass不再进入首次争叫', 'AD', ['1C', 'P', '1D'], 'P', 'C07')
for (const [points, expected] of [
  [5, 'P'],
  [6, '2S'],
  [9, '2S'],
  [10, '3S'],
  [16, '3S'],
  [17, '4S'],
] as const)
  check(
    `C05 支持 ${points}`,
    shapedHand([3, 3, 4, 3], points),
    ['1H', '1S', 'P'],
    expected,
    'C05',
  )
check(
  'C05 两张支持不足',
  shapedHand([2, 3, 4, 4], 13),
  ['1H', '1S', 'P'],
  'P',
  'C05',
)
check(
  'C06 九点不能竞争',
  shapedHand([5, 3, 3, 2], 9),
  ['1S', 'P', '2S', '3H'],
  'P',
  'C07',
)
check(
  'C06 十点可竞争一次',
  shapedHand([5, 3, 3, 2], 10),
  ['1S', 'P', '2S', '3H'],
  '3S',
  'C06',
)
check('G05 强开叫后的未知跳叫不能套用 S03', 'G', team('2C 2D 3H'), 'P', 'G05')
check(
  'C07 未定义的跳争叫不产生 C05 支持义务',
  'F',
  ['1C', '2H', 'P'],
  'P',
  'C07',
)
check(
  'G05 自然再叫的跳叫不推断逆叫承诺',
  'KQ/AJ76/K5432/54',
  team('1C 1D 2H'),
  'P',
  'G05',
)
check('G05 已加叫低花后的新高花不套用 B07', 'G', team('1C 2C 2H'), 'P', 'G05')
check('O05 五点不弱开叫', '84/KQ9876/32/754', [], 'P', 'O06')
check('O05 十点弱开叫', 'A4/KQJ976/32/754', [], '2H', 'O05')
check('O05 十一点不弱开叫', 'A4/KQJ976/J2/754', [], 'P', 'O06')
check('O03 低花5332可开无将', shapedHand([3, 3, 5, 2], 15), [], '1NT', 'O03')
check('O04 4441不算均型', shapedHand([4, 4, 4, 1], 16), [], '1D', 'O04')
check('O04 低花四四先方块', shapedHand([3, 2, 4, 4], 12), [], '1D', 'O04')
check('O04 高花五五先黑桃', shapedHand([5, 5, 2, 1], 12), [], '1S', 'O04')
check(
  'N01 高花五五先转移黑桃',
  shapedHand([5, 5, 2, 1], 6),
  team('1NT'),
  '2H',
  'N01',
)
check(
  'N07 六张目标套加两张支持接受邀请',
  shapedHand([2, 3, 4, 4], 17),
  team('1NT 2H 2S 3S'),
  '4S',
  'N07',
)
check(
  'N07 六张目标套邀请低限不再抬高',
  shapedHand([2, 3, 4, 4], 16),
  team('1NT 2H 2S 3S'),
  'P',
  'N07',
)
check(
  'N07 五张目标套三无将不改二张支持',
  shapedHand([2, 3, 4, 4], 17),
  team('1NT 2H 2S 3NT'),
  'P',
  'N07',
)
check(
  'N08 无将邀请高限接受',
  shapedHand([3, 3, 4, 3], 17),
  team('1NT 2C 2D 2NT'),
  '3NT',
  'N08',
)
check(
  'N08 无将邀请低限拒绝',
  shapedHand([3, 3, 4, 3], 16),
  team('1NT 2C 2D 2NT'),
  'P',
  'N08',
)
check('C01 十四点不争叫无将', 'AK3/QJ4/K432/J54', ['1H'], 'P', 'C07')
check('C01 十五点有止张争叫无将', 'AK3/QJ4/KQ32/654', ['1H'], '1NT', 'C01')
check('C02 十一点不技术加倍', 'KJ84/AJ76/2/Q543', ['1D'], 'P', 'C07')
check('C02 十二点技术加倍', 'KQ84/AJ76/2/Q543', ['1D'], 'X', 'C02')
check('C03 一阶七点不足', 'KQ876/432/Q32/54', ['1H'], 'P', 'C07')
check(
  'F02 二阶应叫后的最低2NT仅承诺12点',
  '84/AQ3/K32/J9754',
  team('1S 2C 2NT'),
  'P',
  'F02',
)
check(
  'F02 二阶应叫后合计下限25可成局',
  '84/AQ3/K32/KJ754',
  team('1S 2C 2NT'),
  '3NT',
  'F02',
)
check('C03 一阶八点可争叫', 'KQ876/432/K32/54', ['1H'], '1S', 'C03')
check('C03 一阶十六点可争叫', 'KQJ87/A32/KQJ3/2', ['1H'], '1S', 'C03')
check('C03 一阶十七点不争叫', 'KQJ87/AJ2/KQJ3/2', ['1H'], 'P', 'C07')
check('C03 二阶九点不足', '84/Q93/K32/KJ754', ['1S'], 'P', 'C07')
check('C03 二阶十点可争叫', '84/K93/K32/KJ754', ['1S'], '2C', 'C03')
check('C03 二阶十六点可争叫', '84/KQ3/AK2/KJ754', ['1S'], '2C', 'C03')
check('C03 二阶十七点不争叫', '84/AQ3/AK2/KJ754', ['1S'], 'P', 'C07')
test('G01 没有当前行动权不能返回建议', () => {
  assert.equal(suggestAuction({ ...input(hands.A), seat: 'east' }), null)
})
