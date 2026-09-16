import { parentPort } from 'node:worker_threads'
import { suggestAuction } from './auction-strategy.ts'
import type { AuctionInput } from '../../shared/computer-auction.ts'

parentPort!.on(
  'message',
  ({ id, input }: { id: number; input: AuctionInput }) => {
    parentPort!.postMessage({ id, decision: suggestAuction(input) })
  },
)
