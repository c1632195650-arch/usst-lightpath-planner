/**
 * 排程引擎 v2 · 显式地点表（places）
 * ============================================================
 * 依据：`排程引擎-v2-技术规格书.md` §4.1 / §9-T0.1。
 *
 * 为什么要有这个文件（旧问题 #9）：
 *   旧引擎靠 `campusOfName()` 关键字 `includes` 猜校区，**默认落到 JG516**，
 *   未识别的地点会被悄悄判成"北校" —— 这违反项目「不猜」的纪律。
 *   本文件把校区变成**显式数据**：要么查得到，要么返回 null（承认不知道）。
 *
 * 数据来源（两条，互不因果）：
 *   ① `templates.ts` 的模块 —— 引擎真正会排进去的 POI（食堂/自习点/运动/生活），
 *      自带 `campus` 标签与 `windows` 营业时段。→ `placesFromTemplates()`
 *   ② `data/campus_map.json` 的 `landmarks`(121 条，**显式 campus**) 与 `pois`(26 条，带 hours)。
 *      → `placesFromCampusMap()`（由调用方注入已解析的 JSON，保持本文件纯净）
 *
 * 设计纪律：本文件**不 import JSON**（Node 测试环境加载不了），JSON 由调用方注入。
 */
import type { CampusId } from '@/types';
import {
  DEFAULT_TEMPLATES, type ActivityTemplate, type ActivityWindow,
} from './templates.ts';
import type { Place, Window } from './model.ts';

/* ============================================================
 * 一、校区标签 → CampusId
 * ========================================================== */

/**
 * 把各种来源的校区标签统一成 `CampusId`。
 *   '北校'→JG516（本部）｜'南校'→JG334｜'1100'→JG1100
 *   '580'→JG516（沿用现有引擎口径：580 号与本部同属军工路一带，按北校处理）
 *   其余（含 '连接'、'any'）→ 'UNKNOWN'（视为数据缺口，调用方应过滤）
 */
export function campusFromLabel(label: string | undefined): CampusId {
  switch (label) {
    case '北校': return 'JG516';
    case '南校': return 'JG334';
    case '1100': return 'JG1100';
    case '580': return 'JG516';
    default: return 'UNKNOWN';
  }
}

/** 从 zone 文本前缀推校区（`landmarks[].zone` 形如「北校区·生活区」） */
function campusFromZone(zone: string | undefined): CampusId {
  if (!zone) return 'UNKNOWN';
  if (zone.startsWith('南校')) return 'JG334';
  if (zone.startsWith('1100')) return 'JG1100';
  if (zone.startsWith('580')) return 'JG516';
  if (zone.startsWith('北校')) return 'JG516';
  return 'UNKNOWN';
}

/* ============================================================
 * 二、工具
 * ========================================================== */

/** 由 POI 名生成稳定 id（保留中日韩字符，其余压成 '-'） */
export function placeId(name: string): string {
  const slug = name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return `poi-${slug}`;
}

/** "6:30-9:30" / "10:45-13:30,16:30-19:30" → Window[] */
function parseHours(spec: string | undefined): Window[] {
  if (!spec) return [];
  return spec.split(',').flatMap((seg) => {
    const [a, b] = seg.trim().split('-');
    if (!a || !b) return [];
    const toMin = (s: string): number => {
      const [h, m] = s.trim().split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    return [{ startMin: toMin(a), endMin: toMin(b) }];
  });
}

function hoursToWindows(labelMap: Record<string, string> | undefined): Window[] {
  if (!labelMap) return [];
  return Object.entries(labelMap).flatMap(([label, spec]) =>
    parseHours(spec).map((w) => ({ ...w, label })),
  );
}

function fromTemplateWindows(wins: ActivityWindow[]): Window[] {
  return wins.map((w) => ({ startMin: w.startMin, endMin: w.endMin, label: w.label }));
}

/* ============================================================
 * 三、来源 ①：从模块库抽取（引擎真正会用的 POI）
 * ========================================================== */

/**
 * 把模块库的 `place` 抽成 `Place[]`。
 * 同一 POI 被多个模块引用时按名字去重，**第一个非 UNKNOWN 的校区胜出**。
 */
export function placesFromTemplates(templates: ActivityTemplate[] = DEFAULT_TEMPLATES): Place[] {
  const byName = new Map<string, Place>();
  for (const t of templates) {
    if (!t.place) continue;
    const campus = campusFromLabel(t.campus);
    if (campus === 'UNKNOWN') continue; // 例如 'any'（用户自定义），不进基础表
    const prev = byName.get(t.place);
    if (prev) {
      if (prev.hours.length === 0 && t.windows.length) {
        prev.hours = fromTemplateWindows(t.windows);
      }
      continue;
    }
    byName.set(t.place, {
      id: placeId(t.place),
      name: t.place,
      campus,
      hours: fromTemplateWindows(t.windows),
      category: t.category,
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

/* ============================================================
 * 四、来源 ②：从 campus_map.json 抽取（注入式）
 * ========================================================== */

/** `data/campus_map.json` 中本模块用到的最小结构（宽松类型，容忍字段缺失） */
export interface CampusMapJson {
  landmarks?: Array<{
    id?: string; name?: string; type?: string; zone?: string;
    campus?: string; hours?: Record<string, string>;
  }>;
  pois?: Array<{
    id?: string; name?: string; type?: string; zone?: string;
    campus?: string; hours?: Record<string, string>;
  }>;
}

/**
 * 从校园图谱抽取 POI。
 * 优先取 `landmarks[].campus`（显式）；缺省时退回 `zone` 前缀推断。
 * 校区推断不出来的条目**直接丢弃**（宁可少，不要猜）。
 */
export function placesFromCampusMap(map: CampusMapJson): Place[] {
  const out = new Map<string, Place>();
  const add = (raw: { name?: string; zone?: string; campus?: string; hours?: Record<string, string>; type?: string }): void => {
    const name = raw.name?.trim();
    if (!name) return;
    const campus = raw.campus ? campusFromLabel(raw.campus) : campusFromZone(raw.zone);
    if (campus === 'UNKNOWN') return;
    const existing = out.get(name);
    const hours = hoursToWindows(raw.hours);
    if (existing) {
      if (existing.hours.length === 0 && hours.length) existing.hours = hours;
      return;
    }
    out.set(name, { id: placeId(name), name, campus, hours, category: raw.type });
  };
  for (const x of map.landmarks ?? []) add(x);
  for (const x of map.pois ?? []) add(x);
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

/* ============================================================
 * 五、合并与冲突检测（数据治理）
 * ========================================================== */

/**
 * 合并地点表：以 `base` 为准，`overlay` 只**补缺**（新增地点 / 补空 hours），
 * **绝不覆盖已有校区** —— 避免上游数据质量差异悄悄改变引擎行为。
 */
export function mergePlaces(base: Place[], overlay: Place[]): Place[] {
  const byName = new Map<string, Place>(base.map((p) => [p.name, { ...p }]));
  for (const o of overlay) {
    const b = byName.get(o.name);
    if (!b) {
      byName.set(o.name, { ...o });
      continue;
    }
    if (b.hours.length === 0 && o.hours.length) b.hours = o.hours;
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

export interface PlaceConflict {
  name: string;
  base: CampusId;
  overlay: CampusId;
}

/** 两份地点表对**同一地名**给出不同校区 → 数据治理问题，需人工核实 */
export function findPlaceConflicts(base: Place[], overlay: Place[]): PlaceConflict[] {
  const byName = new Map(base.map((p) => [p.name, p.campus]));
  const out: PlaceConflict[] = [];
  for (const o of overlay) {
    const b = byName.get(o.name);
    if (b && b !== o.campus) out.push({ name: o.name, base: b, overlay: o.campus });
  }
  return out;
}

/* ============================================================
 * 六、索引与查询（规格书 §9-T0.1 步骤 2）
 * ========================================================== */

/**
 * 建索引。**同时按 `id` 与 `name` 注册**，因此 `resolvePlace('第三教学楼')`
 * 与 `resolvePlace('poi-第三教学楼')` 都能命中（O(1)）。
 */
export function buildPlaceIndex(places: Place[]): Map<string, Place> {
  const m = new Map<string, Place>();
  for (const p of places) {
    if (!m.has(p.id)) m.set(p.id, p);
    if (!m.has(p.name)) m.set(p.name, p);
  }
  return m;
}

/** 由 id 或 POI 名解析地点；**查不到返回 null**（不猜） */
export function resolvePlace(
  nameOrId: string,
  index: Map<string, Place> = BUILTIN_PLACE_INDEX,
): Place | null {
  return index.get(nameOrId) ?? null;
}

/** 由 id 或 POI 名取校区；**查不到返回 null**（不猜，替代旧 campusOfName 的默认 JG516） */
export function campusOfPlace(
  nameOrId: string,
  index: Map<string, Place> = BUILTIN_PLACE_INDEX,
): CampusId | null {
  return resolvePlace(nameOrId, index)?.campus ?? null;
}

/* ============================================================
 * 七、内置地点表
 * ========================================================== */

/** 引擎内置地点表：由模块库抽取，覆盖所有会被排程的 POI */
export const BUILTIN_PLACES: Place[] = placesFromTemplates(DEFAULT_TEMPLATES);

/** 内置地点索引 */
export const BUILTIN_PLACE_INDEX: Map<string, Place> = buildPlaceIndex(BUILTIN_PLACES);
