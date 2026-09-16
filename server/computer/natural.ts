import {
  AuctionContext,
  bid,
  pass,
  major,
  isBid,
  game,
} from './auction-context.ts'
import type { Bid, Suit } from './auction-context.ts'
import type { Call } from '../../shared/protocol.ts'

export function response(c: AuctionContext, open: Bid) {
  const suit = open.denomination as Suit
  const h = c.hcp
  let r
  if (major(suit) && c.lengths[suit] >= 3 && h >= 6) {
    r = c.choose('R01', bid(h <= 9 ? 2 : h <= 12 ? 3 : 4, suit))
    if (r) return r
  }
  const one = c.longest.filter(
    (s) => s !== suit && c.lengths[s] >= 4 && c.minimum(s)?.level === 1,
  )
  if (
    c.lengths.H === 4 &&
    c.lengths.S === 4 &&
    one.includes('H') &&
    one.includes('S')
  ) {
    one.splice(one.indexOf('H'), 1)
    one.splice(one.indexOf('S'), 0, 'H')
  }
  if (h >= 6)
    for (const s of one) {
      r = c.choose('R02', bid(1, s))
      if (r) return r
    }
  if (!major(suit) && c.balanced && h >= 10) {
    r = c.choose('R03', bid(h <= 12 ? 2 : 3, 'NT'))
    if (r) return r
  }
  if (h >= 10)
    for (const s of c.longest) {
      if (
        s === suit ||
        c.lengths[s] < (suit === 'S' && s === 'H' ? 5 : 4) ||
        c.minimum(s)?.level !== 2
      )
        continue
      r = c.choose('R04', bid(2, s))
      if (r) return r
    }
  if (!major(suit) && c.lengths[suit] >= 5 && h >= 6) {
    r = c.choose('R05', bid(h <= 9 ? 2 : h <= 12 ? 3 : 5, suit))
    if (r) return r
  }
  if (h >= 6) {
    r = c.choose('R06', bid(1, 'NT'))
    if (r) return r
  }
  if (h < 6) {
    r = c.choose('R07', pass)
    if (r) return r
  }
  return c.fallback()
}

// 只从公开叫品识别 R 阶段，不从搭档手牌猜测其规则。
export function naturalResponse(open: Bid, call: Call) {
  if (!isBid(call)) return false
  if (call.denomination === open.denomination)
    return major(open.denomination)
      ? [2, 3, 4].includes(call.level)
      : [2, 3, 5].includes(call.level)
  if (call.denomination === 'NT')
    return (
      call.level === 1 ||
      (!major(open.denomination) && [2, 3].includes(call.level))
    )
  return call.level === 1
}
const suitRank = (s: string) => ['C', 'D', 'H', 'S'].indexOf(s)
export function recognizedResponse(open: Bid, call: Call) {
  return (
    naturalResponse(open, call) ||
    (isBid(call) &&
      call.denomination !== 'NT' &&
      call.denomination !== open.denomination &&
      call.level === 2 &&
      suitRank(call.denomination) < suitRank(open.denomination))
  )
}
export function rebid(c: AuctionContext, open: Bid, reply: Call) {
  if (reply.kind === 'pass') return c.fallback()
  if (!recognizedResponse(open, reply) || !isBid(reply)) return c.fallback()
  const h = c.hcp,
    suit = open.denomination as Suit,
    target = reply.denomination
  let r
  if (game(reply)) return c.choose('B01', pass) ?? c.fallback()
  if (target === suit && major(suit)) {
    const level =
      reply.level === 2 ? (h <= 15 ? 0 : h <= 18 ? 3 : 4) : h <= 14 ? 0 : 4
    r = c.choose('B02', level ? bid(level, suit) : pass)
    if (r) return r
  }
  if (target === suit && !major(suit)) {
    r = c.choose('B03', h >= 19 && c.balanced ? bid(3, 'NT') : pass)
    if (r) return r
  }
  if (target === 'NT' && reply.level === 2) {
    r = c.choose('B03', h >= 15 ? bid(3, 'NT') : pass)
    if (r) return r
  }
  const newSuit = target !== 'NT' && target !== suit
  if (newSuit && major(target) && c.lengths[target] >= 4) {
    r = c.choose('B04', bid(h <= 15 ? 2 : h <= 18 ? 3 : 4, target))
    if (r) return r
  }
  if (newSuit && c.balanced) {
    const call = h <= 14 ? c.minimum('NT') : bid(h <= 19 ? 2 : 3, 'NT')
    if (call && (h >= 15 || call.level <= 2)) {
      r = c.choose('B05', call)
      if (r) return r
    }
  }
  if (c.lengths[suit] >= 6) {
    const min = c.minimum(suit)
    const level =
      h >= 19 ? (major(suit) ? 4 : 5) : min ? min.level + (h >= 16 ? 1 : 0) : 8
    if (h >= 19 || level <= 3) {
      r = c.choose('B06', bid(level, suit))
      if (r) return r
    }
  }
  for (const s of c.longest) {
    const call = c.minimum(s)
    if (
      s === suit ||
      s === target ||
      c.lengths[s] < 4 ||
      !call ||
      call.level > 2
    )
      continue
    if (call.level === 2 && suitRank(s) > suitRank(suit) && h < 17) continue
    r = c.choose('B07', call)
    if (r) return r
  }
  if (target === 'NT' && reply.level === 1) {
    r = c.choose('B08', h <= 15 ? pass : bid(h <= 18 ? 2 : 3, 'NT'))
    if (r) return r
  }
  return c.fallback(newSuit)
}

export function followup(
  c: AuctionContext,
  open: Bid,
  reply: Call,
  second: Call,
) {
  if (
    !recognizedResponse(open, reply) ||
    !isBid(reply) ||
    !isBid(second) ||
    game(second)
  )
    return c.fallback()
  const suit = open.denomination,
    target = reply.denomination,
    last = second.denomination
  // B02/B04 自然加叫：来自对应表项的公开最小点力与承诺长度。
  if (major(last) && last === target && [2, 3].includes(second.level)) {
    const lower = second.level === 2 ? 12 : 16
    const promised = last === suit ? 5 : 4
    if (c.lengths[last] + promised >= 8)
      return (
        c.choose('F01', c.hcp + lower >= 25 ? bid(4, last) : pass) ??
        c.fallback()
      )
  }
  if (
    last === 'NT' &&
    second.level <= 2 &&
    (target === 'NT' || target !== suit)
  ) {
    const lower =
      target === 'NT' ? 16 : second.level === 1 || reply.level === 2 ? 12 : 15
    return (
      c.choose('F02', c.hcp + lower >= 25 ? bid(3, 'NT') : pass) ?? c.fallback()
    )
  }
  if (major(suit) && last === suit && second.level <= 3) {
    // 最低再叫二阶承诺 12，跳到三阶承诺 16。
    const lower = second.level === 3 ? 16 : 12
    return (
      c.choose(
        'F03',
        c.lengths[suit] >= 2 && c.hcp + lower >= 25 ? bid(4, suit) : pass,
      ) ?? c.fallback()
    )
  }
  if (
    major(last) &&
    last !== suit &&
    last !== target &&
    target !== suit &&
    !(target === 'NT' && reply.level !== 1) &&
    second.level ===
      reply.level +
        (suitRank(last) <= (target === 'NT' ? 4 : suitRank(target)) ? 1 : 0) &&
    second.level <= 2
  ) {
    const lower =
      second.level === 2 && suitRank(last) > suitRank(suit) ? 17 : 12
    return (
      c.choose(
        'F04',
        c.lengths[last] >= 4 && c.hcp + lower >= 25 ? bid(4, last) : pass,
      ) ?? c.fallback()
    )
  }
  return c.fallback()
}
