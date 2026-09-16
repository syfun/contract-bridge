import {
  AuctionContext,
  bid,
  pass,
  major,
  isBid,
  sameSide,
  rank,
} from './auction-context.ts'
import type { Suit } from './auction-context.ts'
import type { AuctionEntry, Call, Seat } from '../../shared/protocol.ts'

function enemyOpening(entries: AuctionEntry[], seat: Seat) {
  const enemy = entries.filter(
    (e) => !sameSide(e.seat, seat) && e.call.kind !== 'pass',
  )
  if (
    enemy.length !== 1 ||
    !isBid(enemy[0].call) ||
    enemy[0].call.denomination === 'NT' ||
    rank(enemy[0].call) > rank(bid(2, 'S'))
  )
    return null
  return enemy[0].call.denomination
}
export function overcall(c: AuctionContext) {
  const enemy = enemyOpening(c.input.auction, c.input.seat)
  if (!enemy) return c.choose('C07', pass) ?? c.fallback()
  const h = c.hcp
  let r
  if (h >= 15 && h <= 18 && c.balanced && c.stopped(enemy)) {
    r = c.choose('C01', bid(1, 'NT'))
    if (r) return r
  }
  if (
    h >= 12 &&
    c.lengths[enemy] <= 2 &&
    c.longest.every((s) => s === enemy || c.lengths[s] >= (major(s) ? 4 : 3))
  ) {
    r = c.choose('C02', { kind: 'double' })
    if (r) return r
  }
  for (const s of c.longest) {
    const call = c.minimum(s)
    if (
      s === enemy ||
      c.lengths[s] < 5 ||
      c.honors(s, ['A', 'K', 'Q', 'J', '10']) < 2 ||
      !call ||
      call.level > 2 ||
      h > 16 ||
      h < (call.level === 1 ? 8 : 10)
    )
      continue
    r = c.choose('C03', call)
    if (r) return r
  }
  return c.choose('C07', pass) ?? c.fallback()
}
export function competitiveResponse(
  c: AuctionContext,
  own: Call[],
  prefix: AuctionEntry[],
) {
  const enemy = enemyOpening(prefix, c.input.seat)
  if (!enemy) return c.choose('C07', pass) ?? c.fallback()
  if (own.length !== 1)
    return (
      c.choose(own[0].kind === 'double' ? 'C04' : 'C05', pass) ?? c.fallback()
    )
  const first = own[0]
  if (first.kind === 'double') {
    for (const s of c.longest) {
      const call = c.minimum(s)
      if (s !== enemy && call && call.level <= 3) {
        const r = c.choose('C04', call)
        if (r) return r
      }
    }
  }
  if (isBid(first)) {
    const enemyBid = prefix.findLast((entry) => isBid(entry.call))!.call
    if (!isBid(enemyBid)) return c.fallback()
    const minimumLevel =
      enemyBid.level +
      (rank(bid(1, first.denomination)) <= rank(bid(1, enemyBid.denomination))
        ? 1
        : 0)
    if (first.level !== minimumLevel)
      return c.choose('C07', pass) ?? c.fallback()
    if (first.denomination === 'NT' && first.level === 1)
      return c.choose('C05', c.hcp >= 10 ? bid(3, 'NT') : pass) ?? c.fallback()
    const suit = first.denomination
    if (suit !== 'NT' && suit !== enemy && first.level <= 2) {
      if (c.lengths[suit] >= 3 && c.hcp >= 6) {
        const min = c.minimum(suit)
        const level =
          c.hcp >= 17 && major(suit)
            ? 4
            : min
              ? min.level + (c.hcp >= 10 && c.hcp <= 16 ? 1 : 0)
              : 8
        if (level <= 3 || (level === 4 && major(suit) && c.hcp >= 17)) {
          const r = c.choose('C05', bid(level, suit))
          if (r) return r
        }
      }
      return c.choose('C05', pass) ?? c.fallback()
    }
  }
  return c.choose('C07', pass) ?? c.fallback()
}

// 公开承诺只取已识别阶段；人工叫品及转移承接不算自然套长。
function naturalPromises(entries: AuctionEntry[]) {
  const promises = new Map<Seat, Partial<Record<Suit, number>>>()
  const first = entries[0]
  const set = (seat: Seat, s: Suit, length: number) => {
    const old = promises.get(seat) ?? {}
    old[s] = Math.max(old[s] ?? 0, length)
    promises.set(seat, old)
  }
  if (!first || !isBid(first.call)) return promises
  const open = first.call
  if (open.denomination === 'NT') {
    if (open.level !== 1) return promises
    const request = entries[1]?.call,
      answer = entries[2]?.call,
      continuation = entries[3]?.call
    if (!request || !isBid(request) || request.level !== 2) return promises
    if (request.denomination === 'C') {
      if (
        answer &&
        isBid(answer) &&
        answer.level === 2 &&
        major(answer.denomination)
      ) {
        set(entries[2].seat, answer.denomination, 4)
        if (
          continuation &&
          isBid(continuation) &&
          continuation.denomination === answer.denomination &&
          [3, 4].includes(continuation.level)
        )
          set(entries[3].seat, answer.denomination, 4)
      }
    }
    // 转移应叫公开五张，但开叫人的机械承接不承诺任何支持长度。
    if (['D', 'H'].includes(request.denomination))
      set(entries[1].seat, request.denomination === 'D' ? 'H' : 'S', 5)
    return promises
  }
  const suit = open.denomination
  if (open.level === 2 && suit === 'C') return promises
  if (open.level > 2) return promises
  set(first.seat, suit, open.level === 2 ? 6 : major(suit) ? 5 : 3)
  for (let i = 1; i < Math.min(entries.length, 3); i++) {
    const e = entries[i]
    if (!isBid(e.call) || e.call.denomination === 'NT') continue
    const s = e.call.denomination
    if (i === 1) {
      if (s === suit && e.call.level <= (major(s) ? 4 : 5))
        set(e.seat, s, major(s) ? 3 : 5)
      else if (open.level === 1 && e.call.level <= 2)
        set(e.seat, s, suit === 'S' && s === 'H' && e.call.level === 2 ? 5 : 4)
    } else {
      const reply = entries[1].call
      if (!isBid(reply)) continue
      if (s === suit && e.call.level <= 3 && reply.denomination !== suit)
        set(e.seat, s, 6)
      else if (s === reply.denomination && major(s)) set(e.seat, s, 4)
      else if (s !== suit && s !== reply.denomination && e.call.level <= 2)
        set(e.seat, s, 4)
    }
  }
  return promises
}
export function interrupted(
  c: AuctionContext,
  firstOwn: number,
  interference: number,
) {
  const entries = c.input.auction
  const before = entries
    .slice(firstOwn, interference)
    .filter((e) => sameSide(e.seat, c.input.seat))
  const promises = naturalPromises(before)
  // 任一己方座位在干扰后自然加叫已公开叫过的同伴花色，即消耗唯一竞争机会。
  const consumed = entries.slice(interference).some((e, offset) => {
    if (
      !sameSide(e.seat, c.input.seat) ||
      !isBid(e.call) ||
      e.call.denomination === 'NT'
    )
      return false
    const call = e.call
    return entries
      .slice(firstOwn, interference + offset)
      .some(
        (prior) =>
          prior.seat !== e.seat &&
          sameSide(prior.seat, e.seat) &&
          isBid(prior.call) &&
          prior.call.denomination === call.denomination &&
          prior.call.level < call.level &&
          (promises.get(prior.seat)?.[call.denomination as Suit] ?? 0) > 0,
      )
  })
  if (!consumed && c.hcp >= 10) {
    for (const s of c.longest.filter(major)) {
      const lengths = [...promises.values()].map((p) => p[s] ?? 0)
      const call = c.minimum(s)
      if (
        lengths.length === 2 &&
        lengths.every((n) => n > 0) &&
        lengths[0] + lengths[1] >= 8 &&
        call &&
        call.level <= 3
      ) {
        const r = c.choose('C06', call)
        if (r) return r
      }
    }
  }
  return c.choose('C07', pass) ?? c.fallback()
}
