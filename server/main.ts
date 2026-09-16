import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { networkInterfaces } from 'node:os'
import { createApp } from './app.ts'

const databasePath = resolve(process.env.BRIDGE_DB ?? 'data/bridge.sqlite')
mkdirSync(dirname(databasePath), { recursive: true })
const app = await createApp(databasePath)
const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
console.log(`桥牌小聚：http://localhost:${port}，数据：${databasePath}`)
for (const interfaces of Object.values(networkInterfaces())) {
  for (const address of interfaces ?? []) {
    if (address.family === 'IPv4' && !address.internal)
      console.log(`局域网：http://${address.address}:${port}`)
  }
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close()
  })
