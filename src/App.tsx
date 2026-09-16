import { useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import { seats, seatNames } from '../shared/protocol.ts'
import type {
  Command,
  JoinVersion,
  Result,
  RoomState,
  Seat,
} from '../shared/protocol.ts'
import './App.css'

type Session = { credential: string; code?: string; pending?: Command }
const storageKey = 'bridge-session'
function loadSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? 'null')
  } catch {
    return null
  }
}
function operationId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('')
}

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession)
  const [state, setState] = useState<RoomState | null>(null)
  const [nickname, setNickname] = useState('')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(false)
  const [restoring, setRestoring] = useState(Boolean(session?.code))

  function save(value: Session) {
    localStorage.setItem(storageKey, JSON.stringify(value))
    setSession(value)
  }
  function update(next: RoomState) {
    setState((old) =>
      !old || next.code !== old.code || next.version >= old.version
        ? next
        : old,
    )
  }
  useEffect(() => {
    if (!session?.code) return
    const socket = io({
      auth: { code: session.code, credential: session.credential },
    })
    socket.on('connect', () => {
      setConnected(true)
      setMessage('')
    })
    socket.on('disconnect', () => {
      setConnected(false)
      setMessage('连接中断，正在重连。座位会为你保留。')
    })
    socket.on('connect_error', () => {
      setConnected(false)
      setMessage('暂时无法恢复房间，请检查网络或重试。')
      setRestoring(false)
    })
    socket.on('state', (next: RoomState) => {
      update(next)
      setRestoring(false)
    })
    return () => {
      socket.disconnect()
    }
  }, [session?.code, session?.credential])

  async function send(command: Command) {
    setBusy(true)
    setMessage('')
    try {
      save({
        credential: command.credential,
        code: session?.code,
        pending: command,
      })
      const response = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) throw Error('request failed')
      const result: Result = await response.json()
      if (result.status === 'accepted') {
        save({ credential: command.credential, code: result.state.code })
        update(result.state)
        setMessage(
          command.kind === 'seat'
            ? '座位已保存。'
            : '已进入房间，选一个座位吧。',
        )
      } else {
        setMessage(result.message)
        if (result.status !== 'storage_failure')
          save({ credential: command.credential, code: session?.code })
        if (result.status === 'stale_state' && session?.code) {
          const snapshot: Result = await fetch(`/api/rooms/${session.code}`, {
            headers: { Authorization: `Bearer ${command.credential}` },
          }).then((r) => r.json())
          if (snapshot.status === 'accepted') update(snapshot.state)
        }
      }
    } catch {
      setMessage(
        '尚未确认操作。请检查网络，再点击“重试操作”；重复提交不会重复入房或选座。',
      )
    } finally {
      setBusy(false)
    }
  }
  async function enter(kind: 'create' | 'join') {
    setBusy(true)
    try {
      let credential = session?.credential
      if (!credential) {
        const response = await fetch('/api/identity', {
          method: 'POST',
          signal: AbortSignal.timeout(10000),
        })
        if (!response.ok) throw Error('identity failed')
        const identity: { credential: string } = await response.json()
        credential = identity.credential
        save({ credential })
      }
      const base = {
        credential,
        operationId: operationId(),
        nickname: nickname.trim(),
      }
      if (kind === 'create') {
        await send({ ...base, kind })
      } else {
        const roomCode = code.trim().toUpperCase()
        const version: JoinVersion = await fetch(
          `/api/rooms/${roomCode}/join-version`,
          {
            headers: { Authorization: `Bearer ${credential}` },
            signal: AbortSignal.timeout(10000),
          },
        ).then((r) => r.json())
        if (version.status !== 'accepted') {
          setMessage(version.message)
          return
        }
        await send({
          ...base,
          kind,
          code: roomCode,
          expectedVersion: version.version,
        })
      }
    } catch {
      setMessage('无法保存身份，请检查网络和浏览器存储设置后重试。')
    } finally {
      setBusy(false)
    }
  }
  function choose(seat: Seat) {
    if (state && session)
      void send({
        kind: 'seat',
        code: state.code,
        credential: session.credential,
        operationId: operationId(),
        expectedVersion: state.version,
        seat,
      })
  }
  const self = state?.members.find((m) => m.id === state.selfId)
  return (
    <main>
      <header className="masthead">
        <div>
          <span className="brand-mark">♣</span>
          <h1>桥牌小聚</h1>
        </div>
        <span className="connection">
          {state
            ? connected
              ? '● 已连接'
              : '○ 正在连接'
            : '熟人之间，一桌好牌'}
        </span>
      </header>
      <div className="notice" role="status" aria-live="polite">
        {message ||
          (restoring
            ? '正在恢复你的房间和座位…'
            : '南北搭档，东西搭档。选好座位，等朋友到齐。')}
        {session?.pending && (
          <button disabled={busy} onClick={() => void send(session.pending!)}>
            重试操作
          </button>
        )}
      </div>
      {!state ? (
        <section className="entry">
          <div className="welcome">
            <span className="eyebrow">BRIDGE · 与朋友同桌</span>
            <h2>
              留一个位置，
              <br />
              等熟悉的牌友。
            </h2>
            <p>
              无需注册。在同一局域网打开这个地址，
              <br />
              用房间码相聚。
            </p>
            <div className="suits" aria-hidden="true">
              ♠ <span>♥</span> ♣ <span>♦</span>
            </div>
          </div>
          <form
            className="panel entry-form"
            onSubmit={(event) => {
              event.preventDefault()
              void enter('join')
            }}
          >
            <h2>{session?.code ? '恢复房间' : '加入一桌牌'}</h2>
            {session?.code ? (
              <>
                <p>房间 {session.code} 的身份已保存在此浏览器。</p>
                <button type="button" onClick={() => window.location.reload()}>
                  重新连接
                </button>
              </>
            ) : (
              <>
                <label htmlFor="nickname">你的昵称</label>
                <input
                  id="nickname"
                  autoComplete="nickname"
                  maxLength={20}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="让朋友认出你"
                  required
                />
                <button
                  className="primary"
                  type="button"
                  disabled={busy || !!session?.pending || !nickname.trim()}
                  onClick={() => void enter('create')}
                >
                  创建房间
                </button>
                <div className="divider">已有朋友建房？</div>
                <label htmlFor="room-code">房间码</label>
                <input
                  id="room-code"
                  autoCapitalize="characters"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="输入六位房间码"
                  required
                />
                <button
                  type="submit"
                  disabled={
                    busy ||
                    !!session?.pending ||
                    !nickname.trim() ||
                    code.trim().length !== 6
                  }
                >
                  加入房间
                </button>
              </>
            )}
          </form>
        </section>
      ) : (
        <>
          <section className="room-heading">
            <div>
              <span className="eyebrow">房间码 · 邀请朋友入座</span>
              <h2 className="room-code">{state.code}</h2>
            </div>
            <p>
              {self?.nickname}，
              {self?.seat
                ? `你已坐在${seatNames[self.seat]}家`
                : '请选择一个空位'}
              <br />
              <small>
                房主：
                {state.members.find((m) => m.id === state.hostId)?.nickname}
              </small>
            </p>
          </section>
          <div className="room-layout">
            <section className="table" aria-label="四方座位">
              {seats.map((seat) => {
                const member = state.members.find((m) => m.seat === seat)
                const mine = member?.id === state.selfId
                return (
                  <button
                    key={seat}
                    className={`seat ${seat} ${mine ? 'mine' : ''}`}
                    disabled={
                      busy || !!session?.pending || !connected || !!member
                    }
                    onClick={() => choose(seat)}
                    aria-label={`${seatNames[seat]}家，${member ? member.nickname : '空位，点击入座'}`}
                  >
                    <span className="direction">{seatNames[seat]}</span>
                    <strong>{member?.nickname ?? '虚位以待'}</strong>
                    <small>
                      {member
                        ? `${mine ? '你 · ' : ''}${member.id === state.hostId ? '房主' : '已入座'}`
                        : '点击入座'}
                    </small>
                  </button>
                )
              })}
              <div className="table-center">
                <span aria-hidden="true">♣</span>
                <h3>等待牌友入座</h3>
                <p>南北一队 · 东西一队</p>
              </div>
            </section>
            <aside className="panel members">
              <h2>
                本桌牌友 <small>{state.members.length} / 4</small>
              </h2>
              <p className="muted">按加入先后排列</p>
              <ol>
                {state.members.map((m) => (
                  <li key={m.id}>
                    <span className="order">{m.joinedOrder}</span>
                    <div>
                      <strong>
                        {m.nickname}
                        {m.id === state.selfId ? '（你）' : ''}
                      </strong>
                      <small>
                        {m.id === state.hostId ? '房主 · ' : ''}
                        {m.seat ? `${seatNames[m.seat]}家` : '正在选座'}
                      </small>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="room-note">
                同一浏览器刷新后会恢复身份和座位。
                <br />
                当前开放建房、入房和选座。
              </p>
            </aside>
          </div>
        </>
      )}
      <footer>
        桥牌小聚 <span>局域网相聚 · 无需注册</span>
      </footer>
    </main>
  )
}
