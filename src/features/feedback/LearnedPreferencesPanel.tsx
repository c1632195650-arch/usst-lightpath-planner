/**
 * 偏好校正 · 「引擎从你这里学到了什么」面板（阶段 B）
 * ============================================================
 * 透明性的落点。三条设计原则：
 *
 *   1. **用户必须能看到引擎理解成了什么** —— 每条都展示 `summarizeCorrections`
 *      生成的人话（「周四 13:00–18:00 不排任何事」），而不是内部字段名。
 *      理解错了才好在**这里**撤销，而不是等排程结果不对了再猜。
 *   2. **撤销 ≠ 删除** —— 撤销只是 `active:false`（置灰保留），可以「重新生效」。
 *      彻底删除是另一个按钮。这样用户不会因为误点丢掉自己说过的话。
 *   3. **如实说明本期不生效** —— 面板头部明确写「只记录、暂不影响排程」，
 *      避免用户提了要求却发现排程没变，以为功能坏了。
 */
import { useState } from 'react';
import type { CorrectionRule } from '@/lib/planner/corrections';
import { summarizeCorrections, countCorrections } from '@/lib/planner/corrections';
import { setActive, removeRule } from './store.ts';

interface Props {
  rules: CorrectionRule[];
  onChange: (rules: CorrectionRule[]) => void;
  /** 默认是否展开 */
  defaultOpen?: boolean;
}

export function LearnedPreferencesPanel({ rules, onChange, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const items = summarizeCorrections(rules);
  const stat = countCorrections(rules);

  function toggle(id: string, active: boolean) {
    onChange(setActive(rules, id, active, new Date().toISOString()));
  }
  function drop(id: string) {
    onChange(removeRule(rules, id));
  }

  return (
    <div className="panel px-4 py-3 sm:px-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-baseline gap-x-2 text-left"
      >
        <span className="text-[13.5px] font-semibold text-ink">
          {open ? '▾' : '▸'} 引擎从你这里学到了什么
        </span>
        <span className="text-[11.5px] text-ink-faint">
          {stat.active > 0
            ? `生效中 ${stat.active} 条${stat.revoked ? ` · 已撤销 ${stat.revoked} 条` : ''}`
            : '还没有记录'}
        </span>
      </button>

      {open && (
        <div className="mt-2">
          {/* 诚实说明：本期只记录，不反哺排程 */}
          <div className="rounded-md bg-slate-50 px-2.5 py-1.5 text-[11px] text-ink-soft ring-1 ring-ink/10">
            这些是你提过的要求，引擎已经记下来了。**当前版本只做记录与展示，还不会改变排程结果** ——
            等校验确认理解无误后才会生效。
          </div>

          {items.length === 0 ? (
            <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">
              还没有从你这里学到什么。在上面的「提个要求」里说一句试试，
              内容会慢慢累积在这里，你可以随时撤销。
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {items.map((it) => (
                <li
                  key={it.id}
                  className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md px-2.5 py-1.5 ring-1 ${
                    it.active
                      ? 'bg-white ring-ink/10'
                      : 'bg-slate-50/70 ring-ink/5 opacity-60'
                  }`}
                >
                  <span className={`text-[12.5px] font-medium ${it.active ? 'text-ink' : 'text-ink-soft line-through'}`}>
                    {it.title}
                  </span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] text-ink-soft">
                    {it.group}
                  </span>
                  {it.source === 'text' && it.utterance && (
                    <span className="text-[11px] text-ink-faint">你的原话：「{it.utterance}」</span>
                  )}
                  <span className="ml-auto flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggle(it.id, !it.active)}
                      className="rounded bg-white px-2 py-0.5 text-[11px] text-ink-soft ring-1 ring-ink/15 hover:bg-slate-50"
                    >
                      {it.active ? '撤销' : '重新生效'}
                    </button>
                    <button
                      type="button"
                      onClick={() => drop(it.id)}
                      className="rounded bg-white px-2 py-0.5 text-[11px] text-red-600 ring-1 ring-red-200 hover:bg-red-50"
                    >
                      删除
                    </button>
                  </span>
                  <span className="w-full text-[11px] text-ink-faint">{it.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
