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
import { Icon } from '@/components/icons/Icon';
import { summarizeIssues } from './weekViewModel';
import { DeleteAskDialog } from './DeleteAskDialog';

/** 问题清单的分项样式（原 WeekPlanView 常量，随拆解搬入） */
export const ISSUE_STYLE = {
  error: 'bg-danger-light border-danger/30 text-danger-text',
  warn: 'bg-warn-light border-warn/30 text-warn-text',
  info: 'bg-brand-light border-brand/30 text-brand',
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
          ? 'scale-105 border-danger bg-danger-light text-danger-text'
          : 'border-danger/30 bg-white/95 text-danger-text'
      }`}
    >
      <span className="mx-auto inline-flex"><Icon name="trash" size="md" /></span><br />拖到这里<br />删除
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
  issues: Array<{ level: 'error' | 'warn' | 'info'; message: string }>;
  notes: string[];
}) {
  return (
    <div className="panel px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-ink">这一周的情况</h3>
        <span className="text-[12px] text-ink-soft">
          上课 {(plan.stats.courseMin / 60).toFixed(1)}h · 自习 {(plan.stats.studyMin / 60).toFixed(1)}h ·
          留白 {(plan.stats.blankMin / 60).toFixed(1)}h · {plan.stats.blockCount} 个块
        </span>
      </div>
      {/* 批 6.1（本树规范 §3.2）：issue 明细收进顶部聚合条，点开展开 ——
          summarizeIssues 已实现+有单测（weekViewModel），这里接线；明细仍可在本条内看全。 */}
      {(() => {
        const s = summarizeIssues(issues);
        if (!s.headline) {
          return <p className="mt-2 text-[12px] text-ok">没有发现问题 —— 转场余量都在安全范围内。</p>;
        }
        return (
          <details data-testid="issue-summary-bar" className="mt-2">
            <summary className={`cursor-pointer text-[12px] font-medium ${s.errorCount > 0 ? 'text-danger-text' : 'text-ink-soft'}`}>
              {s.headline}
            </summary>
            <ul className="mt-2 space-y-1.5">
              {issues.map((iss, i) => (
                <li key={i} className={`rounded-md border px-2.5 py-1.5 text-[12px] leading-snug ${ISSUE_STYLE[iss.level]}`}>
                  [{iss.level === 'error' ? '会迟到' : iss.level === 'warn' ? '偏紧' : '提示'}] {iss.message}
                </li>
              ))}
            </ul>
          </details>
        );
      })()}
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
