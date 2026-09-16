import { suggestPlay } from './play-strategy.ts'
import type { PlayInput } from '../../shared/computer-play.ts'
import { parentPort } from 'node:worker_threads'
import { suggestAuction } from './auction-strategy.ts'
import type { AuctionInput } from '../../shared/computer-auction.ts'

parentPort!.on(
  'message',
  ({ id, input }: { id: number; input: AuctionInput | PlayInput }) => {
    parentPort!.postMessage({ id, decision: 'legalCalls' in input ? suggestAuction(input) : suggestPlay(input) })
  },
)
