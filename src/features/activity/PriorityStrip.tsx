/**
 * 长目标优先级模块（2026-10-07 RAY 拍板）
 * ============================================================
 * 一条横排的目标条：**拖拽排序，从左到右优先级依次减弱**。
 * 取代旧的「每卡三档按钮」（那套与监测面板/总览条并存时语义重复且分散）。
 *
 * 交互：原生 HTML5 拖拽（零依赖，与周计划拖拽同一手法）——
 *   · 拖起某块 → 拖到目标位置（dragover 时实时换位预览）→ 松手落定；
 *   · 落定 = 把整条顺序映射成 priority 5→1（`prioritiesFromOrder`）一次落库；
 *   · 「下次『重新排一遍』生效」—— goals 攒着语义与 layer 一致。
 * 纯展示 + 顺序 state：不读时钟、不碰存储（落库经回调）。
 */
import { useState } from 'react';
import { orderGoalsByPriority, priorityForIndex } from './priorityOrder';
import type { Goal } from './goalStore';

/** 注水权重展示（与 goalDecompose 同口径的档位→倍率） */
const WEIGHT_LABEL: Record<number, string> = {
  5: '×1.3', 4: '×1.15', 3: '×1.0', 2: '×0.85', 1: '×0.7',
};

export function PriorityStrip({ goals, weekNo, termStart, onChange }: {
  goals: readonly Goal[];
  weekNo: number;
  termStart: string;
  /** 落定回调：参数是按新优先级补丁过的完整目标数组 */
  onChange: (next: Goal[]) => void;
}) {
  // 顺序 state：初始 = 默认排序（临近度 desc）；拖拽中实时换位
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const sorted = order
    ? order.map((id) => goals.find((g) => g.id === id)).filter((g): g is Goal => !!g)
    : orderGoalsByPriority(goals, weekNo, termStart);

  const commit = (nextOrder: string[]) => {
    setOrder(nextOrder);
    setDragId(null);
    const patches = new Map(
      (function* () {
        for (let i = 0; i < nextOrder.length; i++) {
          yield [nextOrder[i], priorityForIndex(i)] as const;
        }
      })(),
    );
    onChange(goals.map((g) => {
      const p = patches.get(g.id);
      return p && (g.priority ?? 3) !== p ? { ...g, priority: p } : g;
    }));
  };

  const reorder = (overId: string) => {
    if (!dragId || dragId === overId) return;
    const ids = sorted.map((g) => g.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setOrder(ids);
  };

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max items-stretch gap-2">
        {sorted.map((g, i) => {
          const isDragging = dragId === g.id;
          return (
            <div
              key={g.id}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', g.id); e.dataTransfer.effectAllowed = 'move'; setDragId(g.id); }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => { e.preventDefault(); reorder(g.id); }}
              onDrop={(e) => { e.preventDefault(); commit(sorted.map((x) => x.id)); }}
              title={`${g.title}：第 ${i + 1} 位（档位 ${priorityForIndex(i)}，注水权重 ${WEIGHT_LABEL[priorityForIndex(i)]}）`}
              className={`flex min-w-[136px] cursor-grab select-none flex-col justify-between rounded-lg border px-2.5 py-1.5 transition ${
                i === 0 ? 'border-brand bg-brand/5' : 'border-ink/10 bg-white'
              } ${isDragging ? 'opacity-50 ring-2 ring-brand' : ''}`}
            >
              <div className="flex items-center gap-1">
                <span className="text-[11px]">{i === 0 ? '👑' : `${i + 1}`}</span>
                <span className="min-w-0 truncate text-[12px] font-medium text-ink" title={g.title}>
                  {g.emoji ? `${g.emoji} ` : ''}{g.title}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[10px] text-ink-faint">
                <span>{i === 0 ? '最高' : `第 ${i + 1}`}</span>
                <span className="font-mono">{WEIGHT_LABEL[priorityForIndex(i)]}</span>
              </div>
            </div>
          );
        })}
        {sorted.length === 0 && (
          <span className="text-[11px] text-ink-faint">还没有活跃目标</span>
        )}
      </div>
    </div>
  );
}
