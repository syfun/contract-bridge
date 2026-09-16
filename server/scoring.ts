import type {
  BoardScore,
  BoardView,
  Contract,
  Seat,
  Side,
} from '../shared/protocol.ts'

export function sideOf(seat: Seat): Side {
  return seat === 'north' || seat === 'south' ? 'north-south' : 'east-west'
}

// WBF Laws of Duplicate Bridge，第 77 条：每副独立计分。
export function scoreContract(
  contract: Contract | null,
  declarerTricks: number,
  vulnerability: BoardView['vulnerability'],
): BoardScore {
  if (!contract)
    return {
      declarerSide: null,
      declarerTricks: 0,
      requiredTricks: 0,
      vulnerable: false,
      items: [],
      declarerScore: 0,
      delta: { 'north-south': 0, 'east-west': 0 },
    }
  const declarerSide = sideOf(contract.declarer)
  const vulnerable = vulnerability === 'both' || vulnerability === declarerSide
  const requiredTricks = contract.level + 6
  const difference = declarerTricks - requiredTricks
  const factor = { undoubled: 1, doubled: 2, redoubled: 4 }[contract.doubling]
  const items: BoardScore['items'] = []
  if (difference < 0) {
    const down = -difference
    const penalty =
      factor === 1
        ? down * (vulnerable ? 100 : 50)
        : (vulnerable
            ? 200 + (down - 1) * 300
            : 100 + Math.min(down - 1, 2) * 200 + Math.max(down - 3, 0) * 300) *
          (factor / 2)
    items.push({ label: `宕墩罚分（${down} 墩）`, points: -penalty })
  } else {
    const trickValue =
      contract.denomination === 'C' || contract.denomination === 'D' ? 20 : 30
    const trickPoints =
      (contract.level * trickValue +
        (contract.denomination === 'NT' ? 10 : 0)) *
      factor
    items.push({ label: '定约墩分', points: trickPoints })
    if (difference)
      items.push({
        label: `超墩分（${difference} 墩）`,
        points:
          difference *
          (factor === 1 ? trickValue : ((vulnerable ? 200 : 100) * factor) / 2),
      })
    items.push(
      trickPoints >= 100
        ? { label: '成局奖励', points: vulnerable ? 500 : 300 }
        : { label: '部分定约奖励', points: 50 },
    )
    if (contract.level >= 6)
      items.push({
        label: contract.level === 6 ? '小满贯奖励' : '大满贯奖励',
        points: (contract.level === 6 ? 500 : 1000) * (vulnerable ? 1.5 : 1),
      })
    if (factor > 1)
      items.push({
        label: factor === 2 ? '加倍成约奖励' : '再加倍成约奖励',
        points: factor === 2 ? 50 : 100,
      })
  }
  const declarerScore = items.reduce((sum, item) => sum + item.points, 0)
  const northSouth =
    declarerSide === 'north-south' ? declarerScore : -declarerScore
  return {
    declarerSide,
    declarerTricks,
    requiredTricks,
    vulnerable,
    items,
    declarerScore,
    delta: { 'north-south': northSouth, 'east-west': -northSouth },
  }
}
