/**
 * 校区粗查 + 转场注入接口（底层模块）
 * ============================================================
 * 为什么单独一个文件：`construct.ts` 需要 `campusOfName`，而 `schedule.ts` 需要
 * `construct.ts`（`buildWeekPlan` 转调新引擎）。若让两者互相 import 就成环。
 * 故把这一层「谁都可以依赖、自己不依赖别人」的东西沉下来。
 *
 * ⚠️ 对外 API 不变：`schedule.ts` 仍然 `export` 本文件的全部导出（re-export），
 *    原有 `from '@/lib/planner/schedule.ts'` 的调用点（`scripts/scheduler.test.ts` 等）零改动。
 *
 * ⚠️ 本文件是纯函数：不 fetch、不读时钟、不用随机。
 */
import { CAMPUS_TRANSFER_MIN } from '@/types';

/** 转场查询结果 */
export interface TransferInfo {
  /** 实测/估算步行分钟 */
  minutes: number;
  /** 数据来源，如 'osm' / 'campus-estimate' / 'manual' */
  source?: string;
  /** 是否可信（false 表示估算值，UI 应标注） */
  reliable?: boolean;
}

/** 转场时间提供者。应用层注入「调后端 route()」，测试注入桩函数 */
export type TransferProvider = (from: string, to: string) => TransferInfo | null;

/** POI 名 → 校区（粗粒度，仅用于跨校区兜底估算；精确值走后端 route()） */
const CAMPUS_KEYWORDS: Array<{ kw: string; campus: keyof typeof CAMPUS_TRANSFER_MIN }> = [
  { kw: '1100', campus: 'JG1100' },
  { kw: '申', campus: 'JG1100' },
  { kw: '复兴', campus: 'FUXING' },
  { kw: '营口', campus: 'YINGKOU' },
  { kw: '580', campus: 'JG516' }, // 580 号与本部同属军工路一带，按北校处理
  { kw: '南校区', campus: 'JG334' },
  { kw: '卓越楼', campus: 'JG334' },
  { kw: '国合楼', campus: 'JG334' },
  { kw: '第四教学楼', campus: 'JG334' },
  { kw: '思餐厅', campus: 'JG334' },
  { kw: '第六食堂', campus: 'JG334' },
  { kw: '清真', campus: 'JG334' },
];

/**
 * 按关键字判断一个地点名大概在哪个校区。
 *
 * @deprecated 过渡回退用。新代码请改用 `places.ts` 的 `campusOfPlace()`（显式地点表）。
 * ⚠️ 2026-09-14 起**命中失败返回 null**（不再默认 JG516）—— 遵循本项目「不猜」纪律，
 *    修掉旧问题 #9「未识别地点被悄悄判成北校」。
 */
export function campusOfName(name: string): keyof typeof CAMPUS_TRANSFER_MIN | null {
  for (const { kw, campus } of CAMPUS_KEYWORDS) {
    if (name.includes(kw)) return campus;
  }
  return null; // 认不出就是认不出，交给调用方决定（不再默认北校）
}

/**
 * 兜底转场：只处理**跨校区**，且明确标 reliable:false。
 * 同校区返回 null —— 「同校区多远」这件事只有真实路网能答，不猜。
 * 校区认不出来（campusOfName 返回 null）同样返回 null —— 不猜。
 */
export const campusFallbackTransfer: TransferProvider = (from, to) => {
  const a = campusOfName(from);
  const b = campusOfName(to);
  if (!a || !b || a === b) return null;
  const minutes = CAMPUS_TRANSFER_MIN[a]?.[b];
  if (!minutes) return null;
  return { minutes, source: 'campus-estimate', reliable: false };
};
