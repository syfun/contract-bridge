import { denominations, seats } from '../../shared/protocol.ts'
import type { Call, Denomination, Seat } from '../../shared/protocol.ts'
import type {
  AuctionDecision,
  AuctionInput,
} from '../../shared/computer-auction.ts'
import { conventionVersion, type RuleId } from '../../shared/conventions.ts'

export type Suit = Exclude<Denomination, 'NT'>
export type Bid = Extract<Call, { kind: 'bid' }>
export const suitOrder: Suit[] = ['S', 'H', 'D', 'C']
export const major = (s: Denomination): s is 'S' | 'H' => s === 'S' || s === 'H'
export const bid = (level: number, denomination: Denomination): Bid => ({
  kind: 'bid',
  level,
  denomination,
})
export const pass: Call = { kind: 'pass' }
export const isBid = (call: Call): call is Bid => call.kind === 'bid'
export const sameSide = (a: Seat, b: Seat) =>
  seats.indexOf(a) % 2 === seats.indexOf(b) % 2
export const rank = (call: Bid) =>
  (call.level - 1) * 5 + denominations.indexOf(call.denomination)
export const sameCall = (a: Call, b: Call) =>
  a.kind === b.kind &&
  (!isBid(a) ||
    (isBid(b) && a.level === b.level && a.denomination === b.denomination))
export const game = (call: Call) =>
  isBid(call) &&
  (call.denomination === 'NT'
    ? call.level >= 3
    : major(call.denomination)
      ? call.level >= 4
      : call.level >= 5)

export class AuctionContext {
  input: AuctionInput
  hcp: number
  lengths: Record<Suit, number>
  balanced: boolean
  constructor(input: AuctionInput) {
    this.input = input
    this.hcp = input.hand.reduce(
      (n, card) => n + ({ A: 4, K: 3, Q: 2, J: 1 }[card.slice(1)] ?? 0),
      0,
    )
    this.lengths = Object.fromEntries(
      suitOrder.map((s) => [s, input.hand.filter((c) => c[0] === s).length]),
    ) as Record<Suit, number>
    this.balanced = ['4333', '4432', '5332'].includes(
      Object.values(this.lengths)
        .sort((a, b) => b - a)
        .join(''),
    )
  }
  get noFiveMajor() {
    return this.lengths.S < 5 && this.lengths.H < 5
  }
  get longest() {
    return [...suitOrder].sort((a, b) => this.lengths[b] - this.lengths[a])
  }
  legal(call: Call) {
    return this.input.legalCalls.some((c) => sameCall(c, call))
  }
  minimum(suit: Denomination): Bid | undefined {
    return this.input.legalCalls.find(
      (call): call is Bid => isBid(call) && call.denomination === suit,
    )
  }
  honors(suit: Suit, ranks: string[]) {
    return this.input.hand.filter(
      (c) => c[0] === suit && ranks.includes(c.slice(1)),
    ).length
  }
  stopped(suit: Suit) {
    return [
      ['A', 1],
      ['K', 2],
      ['Q', 3],
      ['J', 4],
    ].some(
      ([r, length]) =>
        this.input.hand.includes(
          `${suit}${r}` as (typeof this.input.hand)[number],
        ) && this.lengths[suit] >= Number(length),
    )
  }
  choose(rule: RuleId, call: Call | undefined): AuctionDecision | undefined {
    if (!call || !this.legal(call)) return undefined
    return {
      call,
      rule,
      version: this.input.version,
      conventionVersion,
      reason: `${rule}；HCP=${this.hcp}；♠/♥/♦/♣=${suitOrder.map((s) => this.lengths[s]).join('/')}；依据自身手牌与公开叫牌记录`,
    }
  }
  fallback(forcing = false): AuctionDecision | null {
    if (forcing) {
      for (const suit of this.longest) {
        const call = this.minimum(suit)
        if (this.lengths[suit] >= 4 && call && call.level <= 3)
          return this.choose('G05', call)!
      }
      for (const level of [2, 3]) {
        const result = this.choose('G05', bid(level, 'NT'))
        if (result) return result
      }
    }
    const result = this.choose('G05', pass)
    if (result && forcing) result.reason += '；逼叫无法安全续叫'
    return result ?? null
  }
}
