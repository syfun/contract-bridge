import {
  AuctionContext,
  bid,
  pass,
  major,
  isBid,
  sameCall,
} from './auction-context.ts'
import type { Call } from '../../shared/protocol.ts'

export function notrump(c: AuctionContext, own: Call[]) {
  const open = own[0]
  if (!isBid(open)) return c.fallback()
  const h = c.hcp
  let r
  if (open.level === 2) {
    return (
      c.choose('N10', own.length === 1 && h >= 5 ? bid(3, 'NT') : pass) ??
      c.fallback()
    )
  }
  if (own.length === 1) {
    const suit = c.longest.find((s) => major(s) && c.lengths[s] >= 5)
    if (suit) {
      r = c.choose('N01', bid(2, suit === 'H' ? 'D' : 'H'))
      if (r) return r
    }
    if (c.noFiveMajor && h >= 8 && (c.lengths.S === 4 || c.lengths.H === 4)) {
      r = c.choose('N02', bid(2, 'C'))
      if (r) return r
    }
    return (
      c.choose('N09', h <= 7 ? pass : bid(h <= 9 ? 2 : 3, 'NT')) ?? c.fallback()
    )
  }
  const reply = own[1]
  if (!isBid(reply)) return c.fallback()
  const transfer = reply.level === 2 && ['D', 'H'].includes(reply.denomination)
  const stayman = sameCall(reply, bid(2, 'C'))
  const target = reply.denomination === 'D' ? 'H' : 'S'
  if (own.length === 2) {
    if (transfer) return c.choose('N03', bid(2, target)) ?? c.fallback(true)
    if (stayman)
      return (
        c.choose(
          'N04',
          bid(2, c.lengths.H === 4 ? 'H' : c.lengths.S === 4 ? 'S' : 'D'),
        ) ?? c.fallback(true)
      )
    if (reply.denomination === 'NT' && [2, 3].includes(reply.level))
      return (
        c.choose('N09', reply.level === 2 && h === 17 ? bid(3, 'NT') : pass) ??
        c.fallback()
      )
    return c.fallback()
  }
  const answer = own[2]
  const completedTransfer = transfer && sameCall(answer, bid(2, target))
  const completedStayman =
    stayman &&
    isBid(answer) &&
    answer.level === 2 &&
    ['D', 'H', 'S'].includes(answer.denomination)
  if (own.length === 3) {
    if (completedTransfer) {
      const call =
        h <= 7
          ? pass
          : c.lengths[target] >= 6
            ? bid(h <= 9 ? 3 : 4, target)
            : bid(h <= 9 ? 2 : 3, 'NT')
      return c.choose('N05', call) ?? c.fallback()
    }
    if (completedStayman && isBid(answer)) {
      const fit =
        major(answer.denomination) && c.lengths[answer.denomination] >= 4
      return (
        c.choose(
          'N06',
          fit
            ? bid(h <= 9 ? 3 : 4, answer.denomination)
            : bid(h <= 9 ? 2 : 3, 'NT'),
        ) ?? c.fallback()
      )
    }
    return c.fallback()
  }
  if (own.length === 4) {
    const continuation = own[3]
    if (completedTransfer) {
      if (sameCall(continuation, bid(3, 'NT')))
        return (
          c.choose('N07', c.lengths[target] >= 3 ? bid(4, target) : pass) ??
          c.fallback()
        )
      const ntInvite = sameCall(continuation, bid(2, 'NT'))
      const suitInvite = sameCall(continuation, bid(3, target))
      if (ntInvite || suitInvite) {
        const fit = c.lengths[target] + (ntInvite ? 5 : 6) >= 8
        const call =
          h === 17
            ? bid(fit ? 4 : 3, fit ? target : 'NT')
            : fit && ntInvite
              ? bid(3, target)
              : pass
        return c.choose('N07', call) ?? c.fallback()
      }
      if (
        sameCall(continuation, bid(4, target)) ||
        continuation.kind === 'pass'
      )
        return c.choose('N07', pass) ?? c.fallback()
    }
    if (completedStayman && isBid(answer)) {
      const ntInvite = sameCall(continuation, bid(2, 'NT'))
      const majorInvite =
        major(answer.denomination) &&
        sameCall(continuation, bid(3, answer.denomination))
      const call =
        h === 17 && (ntInvite || majorInvite)
          ? bid(ntInvite ? 3 : 4, ntInvite ? 'NT' : answer.denomination)
          : pass
      return c.choose('N08', call) ?? c.fallback()
    }
  }
  return c.fallback()
}
