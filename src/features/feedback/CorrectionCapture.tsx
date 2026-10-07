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
import { todayISO } from '@/lib/date';
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
  onRemoveBlocks: (days: DayOfWeek[], blockKind?: BlockKind, titleKw?: string) => void;
  /** 规则解析搞不定的句子 → 原句进本页排程对话抽屉（混合体默认路由，2026-10-07） */
  onAskSched?: (q: string) => void;
}

export function CorrectionCapture({ onAdd, onAddTask, onRemoveBlocks, onAskSched }: Props) {
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
    const parsed = parsePlanIntent(text, todayISO());
    // 混合体（2026-10-07，RAY：「输入要求解析，默认都是调用混合体」）：规则认不出
    // 的句子不再停在「没看懂」的静态示弱 —— 原句自动进**本页右侧排程对话抽屉**
    // （LLM 理解层接管，就地处理不跳页）。抽屉内部同样是混合体：对话里说得清的
    // 句子由本地规则快层（LbaoChat.fastTry）当场执行，认不出才走 LLM。
    if (parsed.type === 'unknown' && onAskSched && text.trim()) {
      onAskSched(text.trim());
      reset();
      return;
    }
    setIntent(parsed);
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
          提要求、加事、删安排、问原因都行；说不清的自动转排程对话
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
          className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
        >
          解析
        </button>
        {/* 2026-10-07（RAY）：手动逃生口 —— 跳过快速解析，原句直接进排程模式对话
            （本页右侧抽屉：LLM 理解 → 追问 → 草稿卡确认 → 执行）。
            默认路径已是混合体（解析自动路由），这个按钮留给「规则认错了想走对话」的场合 */}
        {onAskSched && (
          <button
            type="button"
            onClick={() => { const q = text.trim(); if (!q) return; onAskSched(q); reset(); }}
            disabled={!text.trim()}
            title="跳过快速解析，原句直接进排程模式对话（本页抽屉，会追问细节、出草稿让你确认）"
            className="rounded-md bg-white px-3 py-1.5 text-[12px] font-medium text-brand ring-1 ring-brand/30 transition hover:bg-brand/5 disabled:opacity-40"
          >
            排程模式接手
          </button>
        )}
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          className="rounded-md bg-white px-2.5 py-1.5 text-[12px] text-ink-soft ring-1 ring-ink/15 hover:bg-paper"
        >
          {manualOpen ? '收起手选' : '手动选'}
        </button>
      </div>

      {/* ── ① 提要求 ── */}
      {intent?.type === 'constraint' && (
        <div className="mt-2 rounded-md bg-ok-light px-2.5 py-2 text-[11.5px] text-ok">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">我理解成：</span>
            <span>{draftPreview(intent.draft).title}</span>
            <span className="text-ok/70">（{draftPreview(intent.draft).group}）</span>
          </div>
          <div className="mt-1.5 flex gap-2">
            <button type="button" onClick={() => commitDraft(intent.draft, text.trim())}
              className="rounded bg-ok px-2.5 py-1 text-[11.5px] font-medium text-white">
              就是这样，记下来
            </button>
            <button type="button" onClick={reset}
              className="rounded bg-white px-2.5 py-1 text-[11.5px] text-ok ring-1 ring-ok/30">
              不对
            </button>
          </div>
        </div>
      )}

      {/* ── ② 加一件事 ── */}
      {intent?.type === 'add-task' && (
        <div className="mt-2 rounded-md bg-brand-light px-2.5 py-2 text-[11.5px] text-brand">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">我理解成：</span>
            <span>加一件事「{intent.task.title}」</span>
            <span className="text-brand/70">
              {intent.task.dayOfWeek ? `周${DAY_CN[intent.task.dayOfWeek - 1]}` : '交给引擎找空档'}
              {intent.task.startMin != null
                ? ` ${Math.floor(intent.task.startMin / 60)}:${String(intent.task.startMin % 60).padStart(2, '0')}`
                : ''}
              {' · '}{intent.task.durationMin} 分钟
            </span>
          </div>
          <div className="mt-1.5 flex gap-2">
            <button type="button" onClick={() => { onAddTask(intent.task); reset(); }}
              className="rounded bg-brand px-2.5 py-1 text-[11.5px] font-medium text-white">
              加进去
            </button>
            <button type="button" onClick={reset}
              className="rounded bg-white px-2.5 py-1 text-[11.5px] text-brand ring-1 ring-brand/30">
              不对
            </button>
          </div>
        </div>
      )}

      {/* ── ③ 拿掉一块 ── */}
      {intent?.type === 'remove-block' && (
        <div className="mt-2 rounded-md bg-danger-light px-2.5 py-2 text-[11.5px] text-danger-text">
          <div>
            <span className="font-medium">我理解成：</span>
            {intent.titleKw ? (
              <span>拿掉所有「{intent.titleKw}」（包括没挂星期的）</span>
            ) : (
              <>
                拿掉{intent.days.map((d) => `周${DAY_CN[d - 1]}`).join('、')}
                {intent.blockKind ? '的部分安排' : '的安排'}
              </>
            )}
          </div>
          <div className="mt-1.5 flex gap-2">
            <button type="button" onClick={() => { onRemoveBlocks(intent.days, intent.blockKind, intent.titleKw); reset(); }}
              className="rounded bg-danger px-2.5 py-1 text-[11.5px] font-medium text-white">
              就这么办
            </button>
            <button type="button" onClick={reset}
              className="rounded bg-white px-2.5 py-1 text-[11.5px] text-danger-text ring-1 ring-danger/30">
              不对
            </button>
          </div>
        </div>
      )}

      {/* ── ④ 问原因 ── */}
      {intent?.type === 'explain' && (
        <div className="mt-2 rounded-md bg-paper px-2.5 py-2 text-[11.5px] text-ink-soft ring-1 ring-ink/10">
          这个问题的答案就在上面阶段头的**「为什么这么排」**里 —— 那里每一条都是引擎
          排程时真实用到的依据（画像、校历、你的要求），不是事后编的解释。
          <button type="button" onClick={reset} className="ml-1.5 underline">知道了</button>
        </div>
      )}

      {/* ── ⑤ 没看懂 ── */}
      {intent?.type === 'unknown' && (
        <div className="mt-2 rounded-md bg-warn-light px-2.5 py-2 text-[11.5px] text-warn-text">
          <div>这句梨宝没看懂。可以换个说法试试：</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {[...INTENT_HINTS, ...PARSE_HINTS].slice(0, 6).map((h) => (
              <button key={h} type="button" onClick={() => { setText(h); setIntent(null); }}
                className="rounded bg-white px-2 py-0.5 text-[11px] text-warn-text ring-1 ring-warn/25">
                {h}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => { commitDraft(asNoteDraft(text), text.trim()); }}
            className="mt-1.5 rounded bg-warn px-2.5 py-1 text-[11.5px] font-medium text-white"
          >
            先原话记下来（不影响排程）
          </button>
        </div>
      )}

      {/* ── 手动表单（保底路径） ── */}
      {manualOpen && (
        <div className="mt-2 rounded-md border border-ink/10 bg-paper/60 px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11.5px] text-ink-soft">
            <span className="font-medium text-ink">哪些天</span>
            <div className="flex gap-1">
              {DAY_OPTIONS.map(({ d, label }) => {
                const on = days.includes(d);
                return (
                  <button key={d} type="button"
                    onClick={() => setDays(on ? days.filter((x) => x !== d) : [...days, d])}
                    className={`h-6 w-6 rounded text-[11.5px] ${on ? 'bg-ink text-white' : 'bg-white text-ink-soft ring-1 ring-ink/15'}`}>
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
            className="mt-2 rounded bg-ink px-2.5 py-1 text-[11.5px] font-medium text-white disabled:opacity-40">
            添加
          </button>
        </div>
      )}
    </div>
  );
}
