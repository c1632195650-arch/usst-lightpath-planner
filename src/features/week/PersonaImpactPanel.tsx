/**
 * 画像影响监测（2026-10-07 · 提案第13 条）
 * ============================================================
 * 需求（RAY 原话）：「排程条件里是否再增加一个监测用户画像数据对实际排程的影响，
 * 不过平时不要显示，需要鼠标点开才能看到。」
 *
 * 🔑 **这份数据本来就存在，不是新算的。**
 *   `lib/planner/buildPhases.ts:147` 的 `applyPersona()` 逐条返回
 *   `reasons: string[]`，文件头注释明写「每个决策都给出 reasons：用户能看懂
 *   **为什么给我排成这样**」，`:169` 又写「每条规则都刻意写得能读出来
 *   **哪一项画像 → 哪个参数变化**」。
 *
 *   问题是它被**截断**了：`WeekPlanHeader.tsx:45` 渲染的是
 *   `phase.reasons.slice(0, 3)` —— 第 4 条之后全部丢弃。所以本组件
 *   **只需要把截断改成全量展示**，不碰引擎、不新算任何东西。
 *
 * 为什么默认收起（RAY 要求的「平时不要显示」）：
 *   · 6~8 条理由对第一次打开周计划页的人是**噪音** —— 他此刻只想知道
 *     「这周怎么排的」，不是「为什么这么排」；
 *   · 但对「我改了画像，怎么没变化」这类疑问，它是唯一的答案来源。
 *   ⟹ 折中：入口常在但安静（一个数字徽标），点开才展开。
 *
 * 与可解释性纪律的关系：本项目一直坚持「生效了就必须说出来」，
 * 而这条规则把引擎已经算好的理由**藏起来**等于违背该纪律。本组件是它的补齐。
 *
 * 纯展示：不取数、不落库、不改任何 phase。数据全部由 `phase.reasons` 传入。
 */

import { useState } from 'react';
import type { Phase } from '@/types';

/** 理由文案里括号包着的分值，如「成就驱动偏高（58）」→ 抽出 58 供左栏展示。 */
const AXIS_RE = /（(\d{1,3})）/;

/**
 * 从理由文案里抽出「轴名 + 分值」。
 *
 * ⚠️ 为什么要解析字符串而不是让引擎直接给结构化字段：
 *   · `reasons` 是 `string[]`，**引擎侧契约锁死**（`types.ts` 不许改），
 *     要结构化就得改 `Phase` 类型 ⟹ 触碰 CY 所有的契约层；
 *   · 纯展示层解析文案**零契约改动**，代价只是几个正则。
 *   ⟹ 引擎若将来给结构化字段，这里换成直接读即可（届时删掉这段）。
 */
function parseAxis(reason: string): { axis: string; score: number | null } | null {
  // 只认带分值的那种（「…（58），…」），不带分值的多是偏好/阶段说明，另作一类
  const m = AXIS_RE.exec(reason);
  if (!m) return null;
  const score = Number(m[1]);
  // 轴名 = 第一个逗号/顿号/「，」之前的部分
  const head = reason.slice(0, m.index);
  const axis = head.split(/[、，,]/).filter(Boolean).pop() ?? '';
  return Number.isFinite(score) && axis ? { axis: axis.trim(), score } : null;
}

export function PersonaImpactPanel({
  phase,
  /** 跳去改画像的入口（目标页由调用方决定——组合根才知道 tab 路由） */
  onGoProfile,
}: {
  phase: Phase;
  onGoProfile?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const reasons = phase.reasons;
  if (reasons.length === 0) return null;

  return (
    <div className="mt-2 border-t border-ink/10 pt-2">
      {/* ── 入口行：平时只有这一行，安静、不抢注意力 ── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="你的画像怎样改变了这一周的排程"
        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium transition ${
          open
            ? 'bg-brand-light text-brand ring-1 ring-brand/25'
            : 'text-ink-faint hover:bg-ink/5 hover:text-ink-soft'
        }`}
      >
        <span
          className="inline-block text-[9px] transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : 'none' }}
          aria-hidden
        >
          ▶
        </span>
        画像影响排程
        {/* 徽标给「有几条」——用户点之前就知道点开能得到什么 */}
        <span
          className={`rounded-full px-1.5 text-[10px] font-semibold ${
            open ? 'bg-brand text-white' : 'bg-ink/8 text-ink-soft'
          }`}
        >
          {reasons.length}
        </span>
      </button>

      {/* ── 展开面板 ── */}
      {open && (
        <div className="mt-2 rounded-lg bg-ink/[0.03] p-2.5">
          <p className="text-[11.5px] leading-relaxed text-ink-faint">
            下面每一条都是<b className="text-ink-soft">引擎这次排程时真的用到的判断</b>
            （来自 <code className="font-mono">buildPhases.applyPersona</code>），文案就是引擎自己写的。
            改了画像再重排，这里会跟着变。
          </p>
          <ul className="mt-2 space-y-1">
            {reasons.map((r, i) => {
              const parsed = parseAxis(r);
              return (
                <li
                  key={i}
                  className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-start gap-2 text-[11.5px] leading-relaxed"
                >
                  <span className="flex items-baseline gap-1">
                    {parsed ? (
                      <>
                        <span className="font-medium text-brand">{parsed.axis}</span>
                        <span className="font-mono text-[10.5px] text-ink-faint">{parsed.score}</span>
                      </>
                    ) : (
                      <span className="text-ink-faint">其他</span>
                    )}
                  </span>
                  {/* 不再重复渲染分值：它已经在左栏单独显示了 */}
                  <span className="text-ink-soft">
                    {parsed ? r.replace(AXIS_RE, '') : r}
                  </span>
                </li>
              );
            })}
          </ul>
          {onGoProfile && (
            <button
              type="button"
              onClick={onGoProfile}
              className="mt-2.5 rounded-md bg-white px-2.5 py-1 text-[11.5px] font-medium text-ink-soft ring-1 ring-ink/15 transition hover:bg-brand-light hover:text-brand"
            >
              去改画像
            </button>
          )}
        </div>
      )}
    </div>
  );
}