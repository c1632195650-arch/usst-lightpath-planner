/**
 * 周视图渲染模型（E 批 E4 · 2026-09-28 · 纯函数，零 JSX）
 * ============================================================
 * 为什么单独一层：`WeekPlanView.tsx` 近 2000 行，块卡片把「标题 / 时间 / 地点 / 转场 /
 * 为什么排在这 / 操作按钮」**全量铺开**，屏幕被文字吃掉、时间轴退居角落。
 * 本文件把「一个块在**浏览态**该怎么显示」提炼成可测的纯函数（对齐既有
 * `miniWeekPreviewModel.ts` 的先例），组件只做映射 —— 呈现改版不再靠肉眼回归。
 *
 * 设计口径（`docs/week-view-design.md` §2 信息分层）：
 *   · **L0（默认屏上）**：`emoji + 时刻 + 地点简写 + 通勤徽章`，中文 ≤14 字；
 *   · **L1（悬浮/聚焦）**：一行 `reason`（走 `title` 属性，不占版面）；
 *   · **L2（点击）**：详情抽屉（来源 / 历史变动 / 完整转场）。
 *
 * 诚实纪律（与 E2 一脉）：估算转场带 `≈` 前缀，**不把估算说成实测**
 * （`TransferHint.reliable === false` 或 `source` 含 `estimate`）。
 */
import type { TimeBlock } from '@/types';
import { CAMPUS_TRANSFER_MIN } from '@/types';

/* ============================================================
 * 一、时间与文本工具
 * ========================================================== */

export function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 时刻区间（L0 用，等宽显示） */
export function timeLabel(block: Pick<TimeBlock, 'startMin' | 'endMin'>): string {
  return `${hhmm(block.startMin)}–${hhmm(block.endMin)}`;
}

/**
 * 地点**简写**（L0 用）：去掉括号补充说明 —— `图书馆（图文信息中心）` → `图书馆`、
 * `教学楼（第三）` → `教学楼`。全名保留给 L1（悬浮）与 L2（详情），
 * 这样 L0 不用为「补充说明」付版面（E4 实测：带全名的 L0 会到 15 字宽、超出目标 14）。
 */
export function shortenPlace(name: string): string {
  const short = name.replace(/[（(][^）)]*[）)]/g, '').trim();
  return short.length > 0 ? short : name;
}

/**
 * 地点简写：标题里已经点名的地点不再重复（既有 T5 口径）；
 * 房间号只在有地点时追加。
 */
export function placeLabel(block: Pick<TimeBlock, 'title' | 'place' | 'room'>): string | null {
  if (!block.place) return null;
  if (block.title.includes(block.place)) return block.room ? block.room : null;
  return block.room ? `${shortenPlace(block.place)} ${block.room}` : shortenPlace(block.place);
}

/* ============================================================
 * 二、通勤徽章（L0 的「大概多久」—— 用户日常只需要这个量级）
 * ========================================================== */

export interface TransferChip {
  /** L0 文案，如 `🚶 8′` 或 `🚶 ≈8′`（估算） */
  label: string;
  /** 估算值（UI 需用「约」的口径呈现，不得说成实测） */
  estimate: boolean;
  /** 赶不赶得上（true = 余量为负/很紧，UI 用告警色） */
  tight: boolean;
  /** 完整描述（L1/悬浮用） */
  detail: string;
}

export function transferChip(block: Pick<TimeBlock, 'transfer'>): TransferChip | null {
  const t = block.transfer;
  if (!t) return null;
  const estimate = t.reliable === false || (t.source ?? '').includes('estimate');
  const minutes = Math.round(t.minutes);
  const mark = estimate ? '≈' : '';
  return {
    label: `🚶 ${mark}${minutes}′`,
    estimate,
    tight: Boolean(t.tight),
    detail: `${t.fromPlace ?? '上一起点'} → ${t.toPlace ?? '这里'}：${mark}${minutes} 分钟`
      + `（余 ${t.slackMin}${t.tight ? ' · 紧' : ''}${estimate ? ' · 估算值' : ''}）`,
  };
}

/* ============================================================
 * 三、整块的 L0 模型
 * ========================================================== */

export interface BlockChip {
  emoji: string;
  title: string;
  time: string;
  place: string | null;
  /** L1/L2 用的**地点全名**（含括号补充）；L0 只显示 `place` 的简写 */
  placeFull: string | null;
  transfer: TransferChip | null;
  /** L1：一行「为什么排在这」（走 title，不占版面） */
  reasonHint: string | null;
  /** L2 详情里才显示的「来源」 */
  sourceLabel: string;
  /** 是否值得开详情（没有额外信息就不给「点我」的错觉） */
  hasDetail: boolean;
}

const SOURCE_LABEL: Record<TimeBlock['source'], string> = {
  course: '课表',
  template: '引擎自动安排',
  user: '你自己加的',
};

export function blockChip(block: TimeBlock): BlockChip {
  const place = placeLabel(block);
  const transfer = transferChip(block);
  const sourceLabel = block.fromEventId
    ? `校历事件 · 提前准备（${SOURCE_LABEL[block.source]}）`
    : SOURCE_LABEL[block.source];
  return {
    emoji: block.emoji ?? '•',
    title: block.title,
    time: timeLabel(block),
    place,
    /** L1/L2 用：地点全名（含括号补充），L0 只显示简写 */
    placeFull: block.place ? (block.room ? `${block.place} ${block.room}` : block.place) : null,
    transfer,
    reasonHint: block.reason ?? null,
    sourceLabel,
    hasDetail: Boolean(block.reason || transfer || block.locked || block.fromEventId),
  };
}

/**
 * L0 文本长度体检（E4 的可量化验收口径）：中文按 2 个字宽算，
 * 目标 ≤14 —— 超了说明该往 L1/L2 挪。
 */
export function l0Length(block: TimeBlock): number {
  const c = blockChip(block);
  const text = [c.title, c.place ?? '', c.transfer?.label ?? ''].join('');
  // 统计 CJK 与全角字符（宽度 2），其余按 1
  let n = 0;
  for (const ch of text) n += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
  return Math.ceil(n / 2);
}

/* ============================================================
 * 四、issue 聚合（明细收走，顶部只留一句话）
 * ========================================================== */

export interface IssueSummary {
  /** 顶部一行（无 issue 时为 null） */
  headline: string | null;
  errorCount: number;
  warnCount: number;
  /** 展开后的明细（保持引擎给出的顺序） */
  details: string[];
}

export function summarizeIssues(
  issues: ReadonlyArray<{ level: 'error' | 'warn' | 'info'; message: string }>,
): IssueSummary {
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  const infos = issues.filter((i) => i.level === 'info');
  const top = errors[0] ?? warns[0] ?? infos[0];
  const headline = top
    ? `${errors.length ? '⚠️' : 'ℹ️'} ${top.message}`
      + (errors.length + warns.length + infos.length > 1
        ? `（另有 ${errors.length + warns.length + infos.length - 1} 条，点开看）`
        : '')
    : null;
  return {
    headline,
    errorCount: errors.length,
    warnCount: warns.length,
    details: [...errors, ...warns, ...infos].map((i) => i.message),
  };
}

/** 校区间通勤的锚点（供 L2 详情展示「为什么算这么久」） */
export const CAMPUS_TRANSFER_TABLE = CAMPUS_TRANSFER_MIN;
