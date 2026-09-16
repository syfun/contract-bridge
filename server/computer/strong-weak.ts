import {
  AuctionContext,
  bid,
  pass,
  major,
  isBid,
  game,
  sameCall,
} from './auction-context.ts'
import type { Call } from '../../shared/protocol.ts'

export function strongWeak(c: AuctionContext, own: Call[]) {
  const open = own[0]
  if (!isBid(open)) return c.fallback()
  const h = c.hcp
  if (open.denomination !== 'C') {
    if (own.length === 1 && open.denomination !== 'NT')
      return (
        c.choose(
          'W01',
          h >= 16 && c.lengths[open.denomination] >= 3
            ? bid(
                major(open.denomination) ? 4 : 3,
                major(open.denomination) ? open.denomination : 'NT',
              )
            : pass,
        ) ?? c.fallback()
      )
    if (
      own.length === 2 &&
      (own[1].kind === 'pass' ||
        sameCall(
          own[1],
          bid(
            major(open.denomination) ? 4 : 3,
            major(open.denomination) ? open.denomination : 'NT',
          ),
        ))
    )
      return c.choose('W02', pass) ?? c.fallback()
    return c.fallback()
  }
  if (own.length === 1) return c.choose('S01', bid(2, 'D')) ?? c.fallback(true)
  if (!sameCall(own[1], bid(2, 'D'))) return c.fallback()
  if (own.length === 2) {
    if (c.balanced && c.noFiveMajor) {
      const r = c.choose('S02', bid(h >= 25 ? 3 : 2, 'NT'))
      if (r) return r
    }
    for (const s of c.longest)
      if (c.lengths[s] >= 4) {
        const r = c.choose('S02', c.minimum(s))
        if (r) return r
      }
    return c.fallback(true)
  }
  if (own.length === 3) {
    const second = own[2]
    if (
      !isBid(second) ||
      ![
        bid(2, 'NT'),
        bid(3, 'NT'),
        bid(2, 'H'),
        bid(2, 'S'),
        bid(3, 'C'),
        bid(3, 'D'),
      ].some((call) => sameCall(call, second))
    )
      return c.fallback()
    if (game(second) || h <= 3) return c.choose('S03', pass) ?? c.fallback()
    if (major(second.denomination) && c.lengths[second.denomination] >= 4)
      return c.choose('S03', bid(4, second.denomination)) ?? c.fallback()
    return c.choose('S03', bid(3, 'NT')) ?? c.fallback()
  }
  return c.fallback()
}
