import { ConnectionStatus } from './ConnectionStatus.tsx'
import { ConventionHelp } from './ConventionHelp.tsx'
import { ScoreTotals } from './ScorePanel.tsx'
import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { seats, seatNames } from '../shared/protocol.ts'
import type {
  Call,
  Card,
  Command,
  JoinVersion,
  Result,
  RoomState,
  Seat,
} from '../shared/protocol.ts'
import './App.css'
import { AuctionPanel } from './AuctionPanel.tsx'
import { PlayTable } from './PlayTable.tsx'

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
  const wasDisconnected = useRef(false)
  const [restoring, setRestoring] = useState(Boolean(session?.code))

  function save(value: Session) {
    localStorage.setItem(storageKey, JSON.stringify(value))
    setSession(value)
  }
  function leaveSession() {
    localStorage.removeItem(storageKey)
    setSession(null)
    setState(null)
    setConnected(false)
    setRestoring(false)
    wasDisconnected.current = false
    setMessage('已离开房间，座位归属已释放，本桌累计分保留。可重新加入。')
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
      wasDisconnected.current = true
      setConnected(false)
      setMessage('连接中断，正在重连。服务端检测掉线后等待 30 秒，之后由电脑接管；你的座位仍会保留。')
    })
    socket.on('membership_ended', leaveSession)
    socket.on('connect_error', async () => {
      setConnected(false)
      setMessage('暂时无法恢复房间，请检查网络或重试。')
      setRestoring(false)
      try {
        const result: Result = await fetch(`/api/rooms/${session.code}`, {
          headers: { Authorization: `Bearer ${session.credential}` },
        }).then(response => response.json())
        if (result.status === 'unauthorized') leaveSession()
      } catch { /* 连接失败时保留原身份，等待重试。 */ }
    })
    socket.on('presence_error', (message: string) => {
      setConnected(false)
      setMessage(message)
    })
    socket.on('state', (next: RoomState) => {
      setConnected(true)
      update(next)
      if (wasDisconnected.current && next.members.find((member) => member.id === next.selfId)?.connection.status === 'online') {
        setMessage('已重连并取回座位控制；电脑已提交的操作保留，请按当前轮次继续。')
        wasDisconnected.current = false
      }
      setRestoring(false)
    })
    return () => {
      socket.removeAllListeners()
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
        if (command.kind === 'leave') { leaveSession(); return }
        save({ credential: command.credential, code: result.state.code })
        update(result.state)
        setMessage(
          command.kind === 'release'
            ? '离线座位已释放；请重新准备下一副。'
            : command.kind === 'pause'
            ? '牌桌已暂停，进度已保存。'
            : command.kind === 'resume'
              ? '牌桌已恢复，从原位置继续。'
              : command.kind === 'ready'
                ? '准备已保存；全部真人准备后自动开始下一副。'
                : command.kind === 'play'
                  ? '出牌已保存。'
                  : command.kind === 'call'
                    ? '叫牌已保存。'
                    : command.kind === 'seat'
                      ? '座位已保存。'
                      : command.kind === 'start'
                        ? '本副已开始，手牌已保存。'
                        : result.state.board
                          ? '已加入，请等待下一副入座。'
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
        '尚未确认操作。请检查网络，再点击“重试操作”；重复提交不会重复执行操作。',
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
  function release(seat: Seat) {
    if (state && session) void send({ kind: 'release', seat, code: state.code,
      credential: session.credential, operationId: operationId(), expectedVersion: state.version })
  }
  function call(call: Call) {
    if (state && session)
      void send({
        kind: 'call',
        code: state.code,
        credential: session.credential,
        operationId: operationId(),
        expectedVersion: state.version,
        call,
      })
  }
  function play(seat: Seat, card: Card) {
    if (state && session)
      void send({
        kind: 'play',
        code: state.code,
        credential: session.credential,
        operationId: operationId(),
        expectedVersion: state.version,
        seat,
        card,
      })
  }
  function advanceBoard(kind: 'start' | 'ready' | 'pause' | 'resume' | 'leave') {
    if (state && session)
      void send({
        kind,
        code: state.code,
        credential: session.credential,
        operationId: operationId(),
        expectedVersion: state.version,
      })
  }
  const self = state?.members.find((m) => m.id === state.selfId)
  const actionLocked = busy || !!session?.pending || !connected || !!state?.pause || self?.connection.status !== 'online'
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
            : state?.pause
              ? '牌桌仍处于暂停状态，等待房主恢复。'
              : state?.board
                ? '身份与座位控制已恢复，请查看当前行动方与公开记录。'
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
                : state.board?.score
                  ? '本副已结束，请选择无归属座位'
                  : state.board
                  ? '请等待下一副入座'
                  : '请选择一个空位'}
              <br />
              <small>
                房主：
                {state.members.find((m) => m.id === state.hostId)?.nickname}
              </small>
            </p>
          </section>
          {state.board && (
            <section className={`pause-controls${state.pause ? ' is-paused' : ''}`} aria-label="牌桌暂停与恢复">
              <div role="status">
                <strong>{state.pause ? `牌桌已暂停 · ${{ host: '房主暂停', 'all-offline': '全员离线', restart: '服务重启恢复' }[state.pause.reason]}` : '牌桌进行中'}</strong>
                <p>{state.pause
                  ? '进度已保存，叫牌、出牌和下一副准备已停用。等待房主恢复后继续。'
                  : '正常轮次不限时，可由房主暂停整桌。'}</p>
              </div>
              {state.hostId === state.selfId ? (
                <button
                  className="primary"
                  disabled={busy || !!session?.pending || !connected}
                  onClick={() => advanceBoard(state.pause ? 'resume' : 'pause')}
                >
                  {state.pause ? '恢复牌桌' : '暂停牌桌'}
                </button>
              ) : <span className="muted">仅房主可暂停或恢复</span>}
            </section>
          )}
          <div className="room-layout">
            <PlayTable
              seatLocked={busy || !!session?.pending || !connected}
              state={state}
              locked={actionLocked}
              onChoose={choose}
              onPlay={play}
            />
            <aside className="panel members">
              <ConventionHelp />
              <ScoreTotals scores={state.scores} />
              {state.board && (
                <AuctionPanel
                  board={state.board}
                  locked={actionLocked}
                  onCall={call}
                />
              )}
              {state.board?.score && (
                <section className="ready-controls" aria-label="下一副准备">
                  <h2>准备下一副</h2>
                  <p className="muted">
                    看完结算后再准备，全部真人准备后自动发牌。
                  </p>
                  <ul className="ready-seats">
                    {seats.map((seat) => (
                      <li key={seat}>
                        <span>
                          {seatNames[seat]}家 ·{' '}
                          {state.board!.seats[seat].controller === 'computer'
                            ? state.board!.seats[seat].memberId ? '电脑接管' : '电脑牌手'
                            : state.members.find(
                                (m) =>
                                  m.id === state.board!.seats[seat].memberId,
                              )?.nickname}
                        </span>
                        <strong>
                          {state.board!.seats[seat].ready ? '已准备' : '未准备'}
                        </strong>
                      </li>
                    ))}
                  </ul>
                  {self?.seat &&
                  state.board.seats[self.seat].memberId === state.selfId ? (
                    <button
                      className="primary"
                      disabled={
                        actionLocked ||
                        state.board.seats[self.seat].ready
                      }
                      onClick={() => advanceBoard('ready')}
                    >
                      {state.board.seats[self.seat].ready
                        ? '已准备，等待其他牌友'
                        : '准备下一副'}
                    </button>
                  ) : (
                    <p className="muted">请选择无归属的电脑座位，再准备下一副。</p>
                  )}
                </section>
              )}
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
                        {m.seat
                          ? `${seatNames[m.seat]}家`
                          : state.board
                            ? '等待下一副'
                            : '正在选座'}
                      </small>
                      <ConnectionStatus member={m} />
                      {state.hostId === state.selfId && state.board?.score && m.seat && m.connection.status !== 'online' && (
                        <button disabled={busy || !!session?.pending || !connected} onClick={() => release(m.seat!)}>
                          释放{seatNames[m.seat]}家座位
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {!state.board && (
                <div className="start-controls">
                  {state.hostId === state.selfId ? (
                    <>
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          !!session?.pending ||
                          !connected ||
                          !self?.seat
                        }
                        onClick={() => advanceBoard('start')}
                      >
                        开始第一副
                      </button>
                      <p className="muted">
                        {self?.seat
                          ? '空位将由电脑牌手补齐；未入座的牌友需等待下一副。'
                          : '请先选择座位，再开始第一副。'}
                      </p>
                    </>
                  ) : (
                    <p className="muted">选好座位后，等待房主开局。</p>
                  )}
                </div>
              )}
              <button disabled={busy || !!session?.pending || !connected} onClick={() => advanceBoard('leave')}>
                退出房间并释放座位
              </button>
              <p className="room-note">
                同一浏览器刷新后会恢复身份和座位。
                <br />
                空位由电脑牌手自动叫牌、出牌；本副结束后请准备下一副。
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
