import { sideOf } from '../scoring.ts'
import type { PlayInput, PlayDecision } from '../../shared/computer-play.ts'
import { conventionVersion } from '../../shared/conventions.ts'
import { ranks, suits } from '../../shared/protocol.ts'
import type { Card } from '../../shared/protocol.ts'

const rank = (card: Card) =>
  ranks.indexOf(card.slice(1) as (typeof ranks)[number])

export function suggestPlay(input: PlayInput): PlayDecision | null {
  const cards = [...input.legalCards].sort(
    (a, b) => rank(a) - rank(b) || suits.indexOf(a[0] as (typeof suits)[number]) - suits.indexOf(b[0] as (typeof suits)[number]),
  )
  if (!cards.length) return null
  const choose = (
    card: Card,
    rule: PlayDecision['rule'],
    reason: string,
  ): PlayDecision => ({
    seat: input.turn, card, rule, reason,
    version: input.version, conventionVersion,
  })
  if (!input.currentTrick.length) {
    const trump = input.contract.denomination
    const trumps = cards.filter(card => card[0] === trump)
    if (input.seat === input.contract.declarer && input.dummy && trumps.length) {
      const own = input.hand.filter(card => card[0] === trump)
      const dummy = input.dummy.hand.filter(card => card[0] === trump)
      const combined = [...own, ...dummy]
      const played = input.tricks
        .flatMap(trick => trick.cards)
        .filter(entry => entry.card[0] === trump).length
      const shortHand = own.length <= dummy.length ? input.hand : input.dummy.hand
      const longHand = own.length <= dummy.length ? input.dummy.hand : input.hand
      const shortRuff = shortHand.some(card => card[0] === trump) && suits.some(
        suit => suit !== trump &&
          !shortHand.some(card => card[0] === suit) &&
          longHand.some(card => card[0] === suit),
      )
      if (
        !shortRuff && combined.length + played < 13 &&
        ['A', 'K', 'Q'].every(r => combined.includes(`${trump}${r}` as Card))
      )
        return choose(trumps[0], 'draw-trump', '两手可见强将配合且没有短将手的将吃机会，先吊将。')
    }
    if (!input.tricks.length && trump !== 'NT' && trumps.length) {
      const singleton = cards.find(card =>
        card[0] !== trump && cards.filter(other => other[0] === card[0]).length === 1,
      )
      if (singleton)
        return choose(singleton, 'lead-singleton', '有将首攻非将单张，争取后续将吃。')
    }
    for (const suit of suits) {
      const holding = cards.filter(card => card[0] === suit).reverse()
      if (
        holding.length >= 3 && rank(holding[0]) >= 8 &&
        rank(holding[0]) - rank(holding[1]) === 1 &&
        rank(holding[1]) - rank(holding[2]) === 1
      )
        return choose(holding[0], 'lead-sequence', '从至少三张大牌连张的顶张首引。')
    }
  }
  if (input.currentTrick.length >= 2) {
    const beats = (a: Card, b: Card) => a[0] === b[0]
      ? rank(a) > rank(b)
      : a[0] === input.contract.denomination
    const winner = input.currentTrick.reduce((best, entry) =>
      beats(entry.card, best.card) ? entry : best,
    )
    if (input.currentTrick.length === 3 && sideOf(winner.seat) === sideOf(input.turn))
      return choose(cards[0], 'keep-partner', '第四家保留搭档已经取得的赢墩。')
    const winning = cards.find(card => beats(card, winner.card))
    if (winning)
      return choose(winning, 'win-cheap', '使用能超过当前最大牌的最低合法牌争墩。')
  }
  return choose(cards[0], 'play-low', '从合法牌中保守选择小牌。')
}
