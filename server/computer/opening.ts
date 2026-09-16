import { AuctionContext, bid, pass, major } from './auction-context.ts'

export function opening(c: AuctionContext) {
  const h = c.hcp
  if (h >= 22) {
    const r = c.choose('O01', bid(2, 'C'))
    if (r) return r
  }
  if (h >= 20 && h <= 21 && c.balanced && c.noFiveMajor) {
    const r = c.choose('O02', bid(2, 'NT'))
    if (r) return r
  }
  if (h >= 15 && h <= 17 && c.balanced && c.noFiveMajor) {
    const r = c.choose('O03', bid(1, 'NT'))
    if (r) return r
  }
  if (h >= 12 && h <= 21) {
    const high = c.longest.find((s) => major(s) && c.lengths[s] >= 5)
    const low =
      c.lengths.C === 3 && c.lengths.D === 3
        ? 'C'
        : c.lengths.D >= c.lengths.C
          ? 'D'
          : 'C'
    const r = c.choose('O04', bid(1, high ?? low))
    if (r) return r
  }
  if (h >= 6 && h <= 10) {
    for (const suit of c.longest) {
      if (
        suit === 'C' ||
        c.lengths[suit] !== 6 ||
        c.honors(suit, ['A', 'K', 'Q']) < 2
      )
        continue
      if (['S', 'H'].some((s) => s !== suit && c.lengths[s as 'S' | 'H'] >= 4))
        continue
      const r = c.choose('O05', bid(2, suit))
      if (r) return r
    }
  }
  return c.choose('O06', pass) ?? c.fallback()
}
