/**
 * 计划意图 · 采集面板（阶段 B + E）
 * ============================================================
 * 用户在周程页说一句话，引擎把它归类成四类**可执行**的意图：
 *
 *   · 提要求   「周四下午别排东西」      → 存成偏好校正规则
 *   · 加一件事 「帮我加个周三晚上的实验」 → 存成 UserTask（立刻排进去）
 *   · 拿掉一块 「删掉周日下午的自习」     → 记进排除清单（重排也不回来）
 *   · 问原因   「为什么周三排这么多」     → 指向阶段头的理由
 *
 * ── 为什么必须回显再确认 ─────────────────────────────────────
 * 中文表达无穷，规则解析必然不完备。让用户当场看到「引擎理解成什么」，
 * 理解错了立刻能改 —— 这比「等排程结果不对了再回来猜是哪条规则的问题」便宜得多。
 *
 * ── 解析不出怎么办 ──────────────────────────────────────────
 * **不猜**：如实说没看懂，给几个例子；用户仍可「先原话记下来」（记为备注），
 * 保证信号不丢失。这是项目一以贯之的「不猜」纪律在交互上的落点。
 */
import { useState } from 'react';
import type { BlockKind, DayOfWeek } from '@/types';
import type { CorrectionRule, TimeWindow } from '@/lib/planner/corrections';
import { summarizeCorrections } from '@/lib/planner/corrections';
import { parsePlanIntent, INTENT_HINTS, type PlanIntent, type TaskDraft } from './planIntent.ts';
import { asNoteDraft, PARSE_HINTS, type CorrectionDraft } from './parseCorrection.ts';
import { makeRuleId } from './store.ts';
import { toMinutes } from '@/constants/time';

const DAY_OPTIONS: Array<{ d: DayOfWeek; label: string }> = [
  { d: 1, label: '一' }, { d: 2, label: '二' }, { d: 3, label: '三' },
  { d: 4, label: '四' }, { d: 5, label: '五' }, { d: 6, label: '六' }, { d: 7, label: '日' },
];

const KIND_OPTIONS: Array<{ k: BlockKind; label: string }> = [
  { k: 'study', label: '自习' },
  { k: 'activity', label: '活动' },
  { k: 'meal', label: '用餐' },
];

const DAY_CN = ['一', '二', '三', '四', '五', '六', '日'];

interface Props {
  /** 存一条排程要求 */
  onAdd: (rule: CorrectionRule) => void;
  /** 加一件事 */
  onAddTask: (task: TaskDraft) => void;
  /** 拿掉某几天（可限类型）的安排 */
  onRemoveBlocks: (days: DayOfWeek[], blockKind?: BlockKind) => void;
}

export function CorrectionCapture({ onAdd, onAddTask, onRemoveBlocks }: Props) {
  const [text, setText] = useState('');
  const [intent, setIntent] = useState<PlanIntent | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  // 手动表单
  const [days, setDays] = useState<DayOfWeek[]>([]);
  const [from, setFrom] = useState('13:00');
  const [to, setTo] = useState('18:00');
  const [kind, setKind] = useState<BlockKind | ''>('');

  function reset() {
    setText('');
    setIntent(null);
  }

  function handleParse() {
    setIntent(parsePlanIntent(text));
  }

  function commitDraft(d: CorrectionDraft, utterance?: string) {
    onAdd({
      id: makeRuleId(),
      kind: d.kind,
      payload: d.payload,
      active: true,
      source: utterance ? 'text' : 'ui',
      utterance,
      createdAt: new Date().toISOString(),
      mapsTo: d.mapsTo,
      ...(d.axisKey ? { axisKey: d.axisKey } : {}),
      ...(d.scenarioKey ? { scenarioKey: d.scenarioKey } : {}),
    });
    reset();
  }

  function submitManual() {
    if (days.length === 0) return;
    const startMin = toMinutes(from);
    const endMin = toMinutes(to);
    if (!(endMin > startMin)) return;
    const win: TimeWindow = { startMin, endMin, label: '自定义' };
    if (kind) {
      commitDraft({ kind: 'avoid_kind', payload: { kind: 'avoid_kind', blockKind: kind, window: win }, mapsTo: 'policy' });
    } else {
      commitDraft({ kind: 'unavailable_slot', payload: { kind: 'unavailable_slot', days, window: win }, mapsTo: 'policy' });
    }
    setDays([]); setKind(''); setManualOpen(false);
  }

  /** 把「提要求」的草稿渲染成一句人话（复用 summarizeCorrections，避免两套措辞） */
  function draftPreview(d: CorrectionDraft) {
    return summarizeCorrections([{
      id: 'preview', kind: d.kind, payload: d.payload, active: true,
      source: 'text', createdAt: '', mapsTo: d.mapsTo,
    }])[0];
  }

  return (
    <div className="panel px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-[13.5px] font-semibold text-ink">跟梨宝说一句</h3>
        <span className="text-[11.5px] text-ink-faint">
          提要求、加事、删安排、问原因，都行
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={text}
          onChange={(e) => { setText(e.target.value); setIntent(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleParse(); }}
          placeholder="例如：周四下午别排东西 / 帮我加个周三晚上的实验"
          className="min-w-0 flex-1 rounded-md border border-ink/15 bg-white px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-brand"
        />
        <button
          type="button"
          onClick={handleParse}
          disabled={!text.trim()}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
        >
          解析
        </button>
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          className="rounded-md bg-white px-2.5 py-1.5 text-[12px] text-ink-soft ring-1 ring-ink/15 hover:bg-slate-50"
        >
          {manualOpen ? '收起手选' : '手动选'}
        </button>
      </div>

      {/* ── ① 提要求 ── */}
      {intent?.type === 'constraint' && (
        <div className="mt-2 rounded-md bg-emerald-50 px-2.5 py-2 text-[11.5px] text-emerald-900">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">我理解成：</span>
            <span>{draftPreview(intent.draft).title}</span>
            <span className="text-emerald-700/70">（{draftPreview(intent.draft).group}）</span>
          </div>
          <div className="mt-1.5 flex gap-2">
            <button type="button" onClick={() => commitDraft(intent.draft, text.trim())}
              className="rounded bg-emerald-700 px-2.5 py-1 text-[11.5px] font-medium text-white">
              就是这样，记下来
            </button>
            <button type="button" onClick={reset}
              className="rounded bg-white px-2.5 py-1 text-[11.5px] text-emerald-900 ring-1 ring-emerald-700/30">
              不对
            </button>
          </div>
        </div>
      )}

      {/* ── ② 加一件事 ── */}
      {intent?.type === 'add-task' && (
        <div className="mt-2 rounded-md bg-blue-50 px-2.5 py-2 text-[11.5px] text-blue-900">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">我理解成：</span>
            <span>加一件事「{intent.task.title}」</span>
            <span className="text-blue-700/70">
              {intent.task.dayOfWeek ? `周${DAY_CN[intent.task.dayOfWeek - 1]}` : '交给引擎找空档'}
              {intent.task.startMin != null
                ? ` ${Math.floor(intent.task.startMin / 60)}:${String(intent.task.startMin % 60).padStart(2, '0')}`
                : ''}
              {' · '}{intent.task.durationMin} 分钟
            </span>
          </div>
          <div className="mt-1.5 flex gap-2">
            <button type="button" onClick={() => { onAddTask(intent.task); reset(); }}
              className="rounded bg-blue-700 px-2.5 py-1 text-[11.5px] font-medium text-white">
              加进去
            </button>
            <button type="button" onClick={reset}
              className="rounded bg-white px-2.5 py-1 text-[11.5px] text-blue-900 ring-1 ring-blue-700/30">
              不对
            </button>
          </div>
        </div>
      )}

      {/* ── ③ 拿掉一块 ── */}
      {intent?.type === 'remove-block' && (
        <div className="mt-2 rounded-md bg-rose-50 px-2.5 py-2 text-[11.5px] text-rose-900">
          <div>
            <span className="font-medium">我理解成：</span>
            拿掉{intent.days.map((d) => `周${DAY_CN[d - 1]}`).join('、')}
            {intent.blockKind ? '的部分安排' : '的安排'}
          </div>
          <div className="mt-1.5 flex gap-2">
            <button type="button" onClick={() => { onRemoveBlocks(intent.days, intent.blockKind); reset(); }}
              className="rounded bg-rose-700 px-2.5 py-1 text-[11.5px] font-medium text-white">
              就这么办
            </button>
            <button type="button" onClick={reset}
              className="rounded bg-white px-2.5 py-1 text-[11.5px] text-rose-900 ring-1 ring-rose-700/30">
              不对
            </button>
          </div>
        </div>
      )}

      {/* ── ④ 问原因 ── */}
      {intent?.type === 'explain' && (
        <div className="mt-2 rounded-md bg-slate-50 px-2.5 py-2 text-[11.5px] text-ink-soft ring-1 ring-ink/10">
          这个问题的答案就在上面阶段头的**「为什么这么排」**里 —— 那里每一条都是引擎
          排程时真实用到的依据（画像、校历、你的要求），不是事后编的解释。
          <button type="button" onClick={reset} className="ml-1.5 underline">知道了</button>
        </div>
      )}

      {/* ── ⑤ 没看懂 ── */}
      {intent?.type === 'unknown' && (
        <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-2 text-[11.5px] text-amber-900">
          <div>这句梨宝没看懂。可以换个说法试试：</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {[...INTENT_HINTS, ...PARSE_HINTS].slice(0, 6).map((h) => (
              <button key={h} type="button" onClick={() => { setText(h); setIntent(null); }}
                className="rounded bg-white px-2 py-0.5 text-[11px] text-amber-900 ring-1 ring-amber-700/25">
                {h}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => { commitDraft(asNoteDraft(text), text.trim()); }}
            className="mt-1.5 rounded bg-amber-700 px-2.5 py-1 text-[11.5px] font-medium text-white"
          >
            先原话记下来（不影响排程）
          </button>
        </div>
      )}

      {/* ── 手动表单（保底路径） ── */}
      {manualOpen && (
        <div className="mt-2 rounded-md border border-ink/10 bg-slate-50/60 px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11.5px] text-ink-soft">
            <span className="font-medium text-ink">哪些天</span>
            <div className="flex gap-1">
              {DAY_OPTIONS.map(({ d, label }) => {
                const on = days.includes(d);
                return (
                  <button key={d} type="button"
                    onClick={() => setDays(on ? days.filter((x) => x !== d) : [...days, d])}
                    className={`h-6 w-6 rounded text-[11.5px] ${on ? 'bg-slate-800 text-white' : 'bg-white text-ink-soft ring-1 ring-ink/15'}`}>
                    {label}
                  </button>
                );
              })}
            </div>
            <span className="font-medium text-ink">时段</span>
            <input type="time" value={from} onChange={(e) => setFrom(e.target.value)}
              className="rounded border border-ink/15 bg-white px-1.5 py-0.5 text-[11.5px]" />
            <span>–</span>
            <input type="time" value={to} onChange={(e) => setTo(e.target.value)}
              className="rounded border border-ink/15 bg-white px-1.5 py-0.5 text-[11.5px]" />
            <span className="font-medium text-ink">不排</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as BlockKind | '')}
              className="rounded border border-ink/15 bg-white px-1.5 py-0.5 text-[11.5px]">
              <option value="">任何事</option>
              {KIND_OPTIONS.map(({ k, label }) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          <button type="button" onClick={submitManual} disabled={days.length === 0}
            className="mt-2 rounded bg-slate-800 px-2.5 py-1 text-[11.5px] font-medium text-white disabled:opacity-40">
            添加
          </button>
        </div>
      )}
    </div>
  );
}
