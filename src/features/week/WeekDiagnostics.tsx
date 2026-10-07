/**
 * 周计划页 · 诊断与删除善后（F2d/A5 拆出的第 ④ 组纯展示子组件 · 架构规格书 §8.1）
 * ============================================================
 * 从 `WeekPlanView.tsx` 原样搬出三个小块：
 *   · `DropToDeleteZone` —— 拖拽删除投放区（拖动中浮现，松手=删除）；
 *   · `WeekIssuesPanel`  —— 问题清单 + 周汇总 + 引擎 notes；
 *   · `DeleteAskSection` —— 删除后的空档处理弹窗（补上来/留白/整周重排/取消）。
 * 纯展示：所有动作都经回调上抛，本组件不持状态、不落库。
 */
import { useState } from 'react';
import type { WeekPlan } from '@/types';
import { toHHmm } from '@/constants/time';
import { includeBlock } from './userPlanStore';
import { groupIssues } from './weekViewUtils';
import { DeleteAskDialog } from './DeleteAskDialog';

/** 问题清单的分项样式（原 WeekPlanView 常量，随拆解搬入） */
export const ISSUE_STYLE = {
  error: 'bg-red-50 border-red-300 text-red-800',
  warn: 'bg-amber-50 border-amber-300 text-amber-800',
  info: 'bg-blue-50 border-blue-300 text-blue-800',
} as const;

/* ============================================================
 * 拖拽删除投放区
 * ========================================================== */

export function DropToDeleteZone({
  deleteHover, setDeleteHover, onDrop,
}: {
  deleteHover: boolean;
  setDeleteHover: (v: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDeleteHover(true); }}
      onDragLeave={() => setDeleteHover(false)}
      onDrop={onDrop}
      className={`fixed right-4 top-1/2 z-50 -translate-y-1/2 select-none rounded-xl border-2 border-dashed px-3.5 py-6 text-center text-[12.5px] font-semibold leading-relaxed shadow-lg transition-colors ${
        deleteHover
          ? 'scale-105 border-red-500 bg-red-100 text-red-700'
          : 'border-red-300 bg-white/95 text-red-600'
      }`}
    >
      🗑<br />拖到这里<br />删除
    </div>
  );
}

/* ============================================================
 * 问题清单 + 汇总
 * ========================================================== */

export function WeekIssuesPanel({
  plan, issues, notes,
}: {
  plan: WeekPlan;
  /** 传 `PlanIssue` 原样进来即可（`code` 用于合并同类，缺了只是不合并） */
  issues: Array<{ level: 'error' | 'warn' | 'info'; message: string; code?: string }>;
  notes: string[];
}) {
  /* 同类合并（RAY 2026-10-08：「这一周的情况那么多信息…能否简化」）——
     原先 1:1 平铺，7 条「你锁定的块没排进去」各占一整句，把面板淹了。
     现在同 code ≥2 条折成一行 + 可展开看是哪些；单条原样显示，不改变可读性。 */
  const groups = groupIssues(issues);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const toggle = (k: string) =>
    setOpenKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  return (
    <div className="panel px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-ink">这一周的情况</h3>
        <span className="text-[12px] text-ink-soft">
          上课 {(plan.stats.courseMin / 60).toFixed(1)}h · 自习 {(plan.stats.studyMin / 60).toFixed(1)}h ·
          留白 {(plan.stats.blankMin / 60).toFixed(1)}h · {plan.stats.blockCount} 个块
        </span>
      </div>
      {groups.length === 0 ? (
        <p className="mt-2 text-[12px] text-green-700">没有发现问题 —— 转场余量都在安全范围内。</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {groups.map((g) => {
            const open = openKeys.includes(g.key);
            const tag = g.level === 'error' ? '会迟到' : g.level === 'warn' ? '偏紧' : '提示';
            return (
              <li key={g.key} className={`rounded-md border px-2.5 py-1.5 text-[12px] leading-snug ${ISSUE_STYLE[g.level]}`}>
                [{tag}] {g.message}
                {g.grouped && (
                  <button
                    type="button"
                    onClick={() => toggle(g.key)}
                    aria-expanded={open}
                    className="ml-1.5 font-medium underline underline-offset-2 hover:no-underline"
                  >
                    {open ? '收起' : '看是哪些'}
                  </button>
                )}
                {g.grouped && open && (
                  <ul className="mt-1 space-y-0.5 border-t border-current/15 pt-1">
                    {g.refs.map((r, i) => (
                      <li key={i} className="opacity-80">· {r}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {notes.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-ink/10 pt-2">
          {notes.map((n, i) => (
            <li key={i} className="text-[11.5px] text-ink-faint">· {n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ============================================================
 * 删除后的空档处理
 * ========================================================== */

export interface DeleteAskState {
  id: string;
  title: string;
  day: number;
  startMin: number;
  endMin: number;
}

export function DeleteAskSection({
  deleteAsk, dayLabel, onFill, onKeepGap, onReplan, onCancel,
}: {
  deleteAsk: DeleteAskState;
  dayLabel: string;
  onFill: () => void;
  onKeepGap: () => void;
  onReplan: () => void;
  onCancel: () => void;
}) {
  return (
    <DeleteAskDialog
      title={deleteAsk.title}
      timeText={`${dayLabel} ${toHHmm(deleteAsk.startMin)}–${toHHmm(deleteAsk.endMin)}`}
      onFill={onFill}
      onKeepGap={onKeepGap}
      onReplan={onReplan}
      onCancel={onCancel}
    />
  );
}
