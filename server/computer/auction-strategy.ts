import { seats } from '../../shared/protocol.ts'
import type { AuctionInput } from '../../shared/computer-auction.ts'
import { response, rebid, followup } from './natural.ts'
import { AuctionContext, sameSide, isBid } from './auction-context.ts'
import { notrump } from './notrump.ts'
import { strongWeak } from './strong-weak.ts'
import { opening } from './opening.ts'
import { overcall, competitiveResponse, interrupted } from './competition.ts'

export function suggestAuction(input: AuctionInput) {
  if (
    !input.legalCalls.length ||
    input.seat !==
      seats[(seats.indexOf(input.dealer) + input.auction.length) % 4]
  )
    return null
  const c = new AuctionContext(input)
  const firstOwn = input.auction.findIndex(
    (e) => sameSide(e.seat, input.seat) && e.call.kind !== 'pass',
  )
  if (firstOwn === -1) {
    return input.auction.every((entry) => entry.call.kind === 'pass')
      ? opening(c)
      : overcall(c)
  }
  const interference = input.auction.findIndex(
    (e, i) =>
      i > firstOwn && !sameSide(e.seat, input.seat) && e.call.kind !== 'pass',
  )
  if (interference !== -1) return interrupted(c, firstOwn, interference)
  const own = input.auction
    .slice(firstOwn)
    .filter((e) => sameSide(e.seat, input.seat))
    .map((e) => e.call)
  const prefix = input.auction.slice(0, firstOwn)
  if (prefix.some((e) => e.call.kind !== 'pass'))
    return competitiveResponse(c, own, prefix)
  const open = own[0]
  if (!isBid(open)) return c.fallback()
  if (open.denomination === 'NT' && [1, 2].includes(open.level))
    return notrump(c, own)
  if (open.level === 2 && open.denomination !== 'NT') return strongWeak(c, own)
  if (open.level === 1 && open.denomination !== 'NT') {
    if (own.length === 1) return response(c, open)
    if (own.length === 2) return rebid(c, open, own[1])
    if (own.length === 3) return followup(c, open, own[1], own[2])
  }
  return c.fallback()
}
