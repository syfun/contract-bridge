import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scoreContract } from './scoring.ts'
import type { Contract, BoardView } from '../shared/protocol.ts'

// 独立牌例按 WBF 第 77 条手工推导；数字为庄家方分数。
// https://www.worldbridge.org/wp-content/uploads/2017/03/2017LawsofDuplicateBridge-paginated.pdf
const examples: [
  number,
  Contract['denomination'],
  Contract['doubling'],
  number,
  number,
  number,
][] = [
  // 阶数、花色、加倍状态、完成墩数、无局分、有局分。
  [1, 'C', 'undoubled', 7, 70, 70],
  [1, 'D', 'undoubled', 8, 90, 90],
  [2, 'H', 'undoubled', 8, 110, 110],
  [2, 'S', 'undoubled', 9, 140, 140],
  [1, 'NT', 'undoubled', 8, 120, 120],
  [2, 'NT', 'undoubled', 9, 150, 150], // 超墩不能把部分定约变为成局。
  [3, 'NT', 'undoubled', 9, 400, 600],
  [4, 'H', 'undoubled', 10, 420, 620],
  [5, 'C', 'undoubled', 11, 400, 600],
  [1, 'NT', 'doubled', 7, 180, 180],
  [1, 'NT', 'redoubled', 7, 560, 760],
  [1, 'C', 'redoubled', 7, 230, 230],
  [1, 'C', 'doubled', 8, 240, 340],
  [1, 'C', 'redoubled', 8, 430, 630],
  [2, 'H', 'doubled', 8, 470, 670], // 加倍后的定约墩分达到成局。
  [2, 'H', 'doubled', 9, 570, 870],
  [2, 'H', 'redoubled', 9, 840, 1240],
  [6, 'NT', 'undoubled', 12, 990, 1440],
  [7, 'NT', 'undoubled', 13, 1520, 2220],
  [6, 'S', 'doubled', 13, 1310, 1860],
  [7, 'NT', 'redoubled', 13, 2280, 2980],
  [4, 'S', 'undoubled', 9, -50, -100],
  [4, 'S', 'undoubled', 6, -200, -400],
  [4, 'S', 'doubled', 9, -100, -200],
  [4, 'S', 'doubled', 8, -300, -500],
  [4, 'S', 'doubled', 7, -500, -800],
  [4, 'S', 'doubled', 6, -800, -1100],
  [4, 'S', 'doubled', 5, -1100, -1400],
  [4, 'S', 'redoubled', 9, -200, -400],
  [4, 'S', 'redoubled', 8, -600, -1000],
  [4, 'S', 'redoubled', 7, -1000, -1600],
  [4, 'S', 'redoubled', 6, -1600, -2200],
  [7, 'NT', 'redoubled', 0, -7000, -7600],
  [6, 'S', 'undoubled', 11, -50, -100], // 未完成满贯不能得奖励。
]
for (const [
  level,
  denomination,
  doubling,
  tricks,
  nonVulnerable,
  vulnerable,
] of examples) {
  test(`${level}${denomination} ${doubling} 完成 ${tricks} 墩：无局 ${nonVulnerable}，有局 ${vulnerable}`, () => {
    for (const declarer of ['north', 'east', 'south', 'west'] as const) {
      const side =
        declarer === 'north' || declarer === 'south'
          ? 'north-south'
          : 'east-west'
      for (const vulnerability of [
        'none',
        'north-south',
        'east-west',
        'both',
      ] as const satisfies readonly BoardView['vulnerability'][]) {
        const expected =
          vulnerability === 'both' || vulnerability === side
            ? vulnerable
            : nonVulnerable
        const result = scoreContract(
          { level, denomination, doubling, declarer, openingLeader: 'east' },
          tricks,
          vulnerability,
        )
        assert.equal(result.declarerScore, expected)
        assert.equal(result.delta[side], expected)
        assert.equal(result.delta['north-south'] + result.delta['east-west'], 0)
        assert.equal(
          result.items.reduce((sum, item) => sum + item.points, 0),
          expected,
        )
      }
    }
  })
}
