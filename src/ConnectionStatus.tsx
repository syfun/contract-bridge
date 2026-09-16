import { useEffect, useState } from 'react'
import type { Member } from '../shared/protocol.ts'

function WaitingCountdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000))
  return remaining > 0 ? `离线 · 等待重连 ${remaining} 秒` : '离线 · 等待服务端接管'
}

export function ConnectionStatus({ member }: { member: Member }) {
  const connection = member.connection
  return (
    <span className={`member-connection ${connection.status}`}>
      {connection.status === 'online'
        ? '在线 · 真人控制'
        : connection.status === 'taken-over'
          ? '离线 · 电脑接管，座位保留'
          : <WaitingCountdown key={connection.deadline} deadline={connection.deadline!} />}
    </span>
  )
}
