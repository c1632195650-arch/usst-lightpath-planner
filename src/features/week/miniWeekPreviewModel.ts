/**
 * MiniWeekPreview 的纯视图模型（WP8-mini / WP9，2026-09-27）
 * ============================================================
 * 为什么拆这一层：node --test 直跑不了 JSX（类型剥离不转 JSX 语法），
 * 所以「同 props 同输出」「只渲染不交互」这些验收全部做在**模型层**——
 * MiniWeekPreview.tsx 只是模型 → JSX 的薄映射，不含任何逻辑与状态。
 *
 * WeekDraft 在本仓没有独立类型：草稿态与正式排程同为 `WeekPlan`，
 * 「草稿 · 未落盘」是 caption 承载的**语义**，不是另一个数据形状。
 */
import type { TimeBlock, WeekPlan } from '@/types';

export interface MiniBlockItem {
  id: string;
  title: string;
  /** HH:MM */
  start: string;
  /** HH:MM */
  end: string;
  kind: string;
}

export interface MiniDayColumn {
  /** 1=周一 … 7=周日 */
  day: number;
  label: string;
  blocks: MiniBlockItem[];
}

export interface MiniWeekViewModel {
  caption?: string;
  days: MiniDayColumn[];
  /** 总块数 —— 预览卡 diff 徽标（+n/−m）的基数 */
  totalBlocks: number;
  empty: boolean;
}

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function toHHMM(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 同 props 必得同输出：排序稳定（按天 → 起始分钟 → id），不读时钟、不随机。 */
export function miniWeekViewModel(
  draft: WeekPlan | null,
  compact: boolean,
  caption?: string,
): MiniWeekViewModel {
  if (!draft || draft.blocks.length === 0) {
    return { caption, days: [], totalBlocks: 0, empty: true };
  }
  const byDay = new Map<number, TimeBlock[]>();
  for (const b of draft.blocks) {
    const list = byDay.get(b.dayOfWeek) ?? [];
    list.push(b);
    byDay.set(b.dayOfWeek, list);
  }
  const days: MiniDayColumn[] = [...byDay.keys()]
    .sort((a, b) => a - b)
    .map((day) => {
      const blocks = (byDay.get(day) ?? [])
        .slice()
        .sort((a, b) => (a.startMin - b.startMin) || a.id.localeCompare(b.id))
        .map<MiniBlockItem>((b) => ({
          id: b.id,
          title: b.title,
          start: toHHMM(b.startMin),
          end: toHHMM(b.endMin),
          kind: b.kind,
        }));
      return { day, label: DAY_LABELS[day - 1] ?? String(day), blocks };
    });
  return {
    caption,
    days,
    totalBlocks: draft.blocks.length,
    empty: false,
  };
}
