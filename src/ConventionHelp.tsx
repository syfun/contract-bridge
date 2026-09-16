import { useRef } from 'react'
import {
  conventions,
  conventionVersion,
  conventionNotes,
  conventionSections,
} from '../shared/conventions.ts'

const plain = (value: string) => value.replaceAll('`', '').replace(/^- /, '')
export function ConventionHelp() {
  const dialog = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button onClick={() => dialog.current?.showModal()}>电脑叫牌约定</button>
      <dialog
        ref={dialog}
        className="convention-help"
        aria-labelledby="convention-title"
      >
        <header>
          <div>
            <h2 id="convention-title">电脑叫牌约定</h2>
            <small>{conventionVersion}</small>
          </div>
          <button onClick={() => dialog.current?.close()}>返回牌桌</button>
        </header>
        <p>
          项目简化自然叫牌：五张高花、15～17 点 1NT、强 2♣、弱二阶、Stayman
          与高花转移。各阶段按规则顺序取首个条件满足且合法的叫品。
        </p>
        <details>
          <summary>共同定义、优先级与简化边界</summary>
          {conventionNotes.map((note, i) => (
            <p key={i}>{plain(note)}</p>
          ))}
        </details>
        {[...new Set(conventions.map((rule) => rule.section))].map(
          (section) => (
            <section key={section}>
              <h3>{section}</h3>
              <p>
                {plain(
                  conventionSections.find((item) => item.title === section)
                    ?.intro ?? '',
                )}
              </p>
              <dl>
                {conventions
                  .filter((rule) => rule.section === section)
                  .map((rule) => (
                    <div key={rule.id}>
                      <dt>{rule.id}</dt>
                      <dd>{plain(rule.condition)}</dd>
                    </div>
                  ))}
              </dl>
            </section>
          ),
        )}
        <p>
          G05 的逼叫退路及 C07 不承诺新的点力或牌型。不探索满贯，不将 4NT 当作问
          A；这套简化策略不代表普通牌友水平。
        </p>
        <button onClick={() => dialog.current?.close()}>返回牌桌</button>
      </dialog>
    </>
  )
}
