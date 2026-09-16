import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { Server } from 'socket.io'
import { resolve } from 'node:path'
import { ComputerRunner } from './computer/runner.ts'
import { GameService } from './game-service.ts'

export async function createApp(databasePath: string) {
  const service = new GameService(databasePath)
  const app = Fastify({ bodyLimit: 8192 })
  const io = new Server(app.server, { maxHttpBufferSize: 8192 })
  const broadcast = (roomCode: string) => {
    // 每个连接重新授权并生成自己的状态；不能广播发起者的 selfId。
    for (const socket of io.sockets.sockets.values()) {
      const { code, credential } = socket.data
      if (code === roomCode) {
        const visible = service.read(code, credential)
        if (visible.status === 'accepted') socket.emit('state', visible.state)
      }
    }
  }
  const computer = new ComputerRunner(service, broadcast)
  await app.register(fastifyStatic, { root: resolve('dist') })
  app.post('/api/identity', (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try {
      return { credential: service.issueIdentity() }
    } catch {
      return reply
        .code(503)
        .send({ status: 'storage_failure', message: '无法保存身份，请重试。' })
    }
  })
  app.get<{ Params: { code: string } }>(
    '/api/rooms/:code',
    (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      const credential =
        request.headers.authorization?.replace(/^Bearer /, '') ?? ''
      return service.read(request.params.code, credential)
    },
  )
  app.get<{ Params: { code: string } }>(
    '/api/rooms/:code/join-version',
    (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      const credential =
        request.headers.authorization?.replace(/^Bearer /, '') ?? ''
      return service.joinVersion(request.params.code, credential)
    },
  )
  app.post('/api/commands', (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const result = service.execute(request.body)
    if (result.status === 'accepted') {
      broadcast(result.state.code)
      void computer.advance(result.state.code)
    }
    return result
  })
  io.use((socket, next) => {
    const { code, credential } = socket.handshake.auth
    if (typeof code !== 'string' || typeof credential !== 'string')
      return next(new Error('无效身份'))
    const result = service.read(code, credential)
    if (result.status !== 'accepted') return next(new Error(result.message))
    socket.data = { code, credential }
    next()
  })
  io.on('connection', (socket) => {
    const result = service.read(socket.data.code, socket.data.credential)
    if (result.status === 'accepted') socket.emit('state', result.state)
  })
  app.addHook('preClose', async () => {
    await computer.close()
    await new Promise<void>((resolve) => io.close(() => resolve()))
  })
  app.addHook('onClose', async () => {
    service.close()
  })
  return app
}
