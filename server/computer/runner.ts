import { Worker } from 'node:worker_threads'
import type {
  AuctionDecision,
  AuctionInput,
} from '../../shared/computer-auction.ts'
import type { GameService } from '../game-service.ts'

// 一个独立计算线程服务各桌，每桌最多一个未完成计算；不传存档或身份凭据。
export class ComputerAuctionRunner {
  private service: GameService
  private broadcast: (code: string) => void
  private worker?: Worker
  private sequence = 0
  private closed = false
  private pending = new Map<
    number,
    {
      resolve: (value: AuctionDecision | null) => void
      reject: (error: Error) => void
    }
  >()
  private running = new Map<string, Promise<void>>()
  private retries = new Map<string, ReturnType<typeof setTimeout>>()
  constructor(service: GameService, broadcast: (code: string) => void) {
    this.service = service
    this.broadcast = broadcast
  }
  private compute(input: AuctionInput): Promise<AuctionDecision | null> {
    if (!this.worker) {
      const worker = new Worker(new URL('./auction-worker.ts', import.meta.url))
      this.worker = worker
      worker.on('message', ({ id, decision }) => {
        this.pending.get(id)?.resolve(decision)
        this.pending.delete(id)
      })
      const failed = (error: Error) => {
        if (this.worker !== worker) return
        this.worker = undefined
        for (const job of this.pending.values()) job.reject(error)
        this.pending.clear()
        void worker.terminate()
      }
      worker.on('error', failed)
      worker.on('exit', () => failed(new Error('电脑计算线程已退出')))
    }
    return new Promise((resolve, reject) => {
      const id = this.sequence++
      this.pending.set(id, { resolve, reject })
      this.worker!.postMessage({ id, input })
    })
  }
  advance(code: string): Promise<void> {
    if (this.closed) return Promise.resolve()
    const running = this.running.get(code)
    if (running) return running
    const retry = this.retries.get(code)
    if (retry) {
      clearTimeout(retry)
      this.retries.delete(code)
    }
    const task = this.run(code)
      .catch(() => {
        if (!this.closed)
          this.retries.set(
            code,
            setTimeout(() => {
              void this.advance(code)
            }, 1000),
          )
      })
      .finally(() => this.running.delete(code))
    this.running.set(code, task)
    return task
  }
  private async run(code: string) {
    while (!this.closed) {
      const turn = this.service.computerTurn(code)
      if (!turn) return
      const decision = await this.compute(turn.input)
      if (this.closed || !decision) return
      const result = this.service.submitComputerCall(turn, decision)
      if (result.status === 'accepted') this.broadcast(code)
      else if (result.status === 'storage_failure')
        throw Error('电脑叫牌保存失败')
      else if (
        result.status !== 'stale_state' &&
        result.status !== 'unauthorized'
      )
        return
      // 过期或控制权交接后重新取快照，不重用旧建议。
    }
  }
  async close() {
    this.closed = true
    for (const timer of this.retries.values()) clearTimeout(timer)
    this.retries.clear()
    const worker = this.worker
    this.worker = undefined
    for (const job of this.pending.values()) job.resolve(null)
    this.pending.clear()
    if (worker) await worker.terminate()
    await Promise.all(this.running.values())
  }
}
