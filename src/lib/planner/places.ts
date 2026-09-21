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
 * 五、来源 ③：校园教学/实验楼（**硬编码显式表**，规格书 §13.7 前置修复）
 * ========================================================== */

/**
 * 校园教学/实验楼 —— 补齐「课程楼查不到校区」的缺口。
 *
 * **为什么必须单独列**（而不是靠上面 `placesFromTemplates()`）：
 *   `templates.ts` 只收录「引擎会排进去的 POI」（食堂 / 自习点 / 运动 / 生活），
 *   **课程楼不在其中** → 修复前 `campusOfPlace('国合楼')` 返回 `null`，
 *   而 `schedule.ts` 的 `campusOfName('国合楼')` 返回 `JG334` —— **两套表打架**。
 *   后果：`objective::placeMismatch` 会把「在卓越楼 / 国合楼上课」误判成跨校区而加罚。
 *
 * **数据来源**：`data/campus_map.json` 的 `landmarks` 中 `type === '教学楼'` 的**全部 27 条**
 *   （每条都有**显式 `campus`**，不是推断）。本文件**明令不 import JSON**（Node 测试环境加载不了），
 *   故此处为**硬编码快照**。
 *
 * **防漂移**：`tests/places-buildings.test.ts` 会读 `data/campus_map.json` 逐条比对，
 *   断言本表与上游一致（含别名）—— 上游增删教学楼时该测试会红，提醒同步本表。
 *
 * @see 规格书 §13.7（前置缺陷）、§12.5.8（校区未知的全局口径）
 */
const CAMPUS_BUILDINGS: ReadonlyArray<{
  name: string;
  campus: '北校' | '南校' | '1100';
  /** 别名（课表解析出来的 `place` 可能是别名，例如「第四教学楼」） */
  alias?: string[];
}> = [
  // —— 北校区（军工路 516）——
  { name: '第一教学楼', campus: '北校', alias: ['一教', '1教'] },
  { name: '第三教学楼', campus: '北校', alias: ['三教', '3教', '新三教'] },
  { name: '第五教学楼', campus: '北校', alias: ['五教', '5教'] },
  { name: '综合楼', campus: '北校', alias: ['中德学院综合楼', '田家炳楼', '田家炳综合楼', '田家炳理学院'] },
  { name: '先进制造大楼', campus: '北校', alias: ['先进制造'] },
  { name: '大礼堂', campus: '北校', alias: ['礼堂'] },
  { name: '校史馆', campus: '北校', alias: ['校史馆（图文信息中心）'] },
  { name: '动力馆', campus: '北校', alias: ['能源与动力工程学院'] },
  { name: '沪江美术馆', campus: '北校', alias: ['美术馆'] },
  { name: '音乐堂', campus: '北校' },
  { name: '现代化教学中心', campus: '北校', alias: ['计算中心', '教学中心'] },
  { name: '创新实训中心', campus: '北校' },
  { name: '基础实验中心', campus: '北校' },
  { name: '实训中心', campus: '北校', alias: ['工程实训中心', '工程训练中心'] },
  { name: '公共实验楼', campus: '北校', alias: ['物理实验中心', '公共实验中心'] },
  // —— 南校区（军工路 334）——
  { name: '逸兴楼', campus: '南校', alias: ['第四教学楼', '四教'] },
  { name: '卓越楼', campus: '南校', alias: ['卓越工程研究生院', '健康科学与工程学院', '健康学院', '医疗器械与食品学院', '医疗器械学院', '食品学院'] },
  { name: '国合楼', campus: '南校', alias: ['国际合作大楼'] },
  // 中德国际学院官网《联系我们》地址写「中德国际学院（从军工路334号门进入）」，
  // 516 号只是 229 信箱的通信地址 → 南校区（2026-09-18 修正，原误标北校）
  { name: '中德学院', campus: '南校', alias: ['汉堡国际工程学院', '中德国际学院'] },
  { name: '理学院楼', campus: '南校', alias: ['理学院'] },
  { name: '外语楼', campus: '南校', alias: ['外语学院'] },
  { name: '微创楼', campus: '南校', alias: ['微创中心'] },
  { name: '理科实验中心', campus: '南校', alias: ['理科实验楼'] },
  { name: '中德学院实验中心', campus: '南校', alias: ['中德实验中心'] },
  { name: '南校区科技大楼', campus: '南校' },
  // —— 1100 基础学院 ——
  { name: '申一教', campus: '1100', alias: ['申一', '1100一教'] },
  { name: '申二教', campus: '1100', alias: ['申二楼', '1100二教'] },
];

/** 校园建筑（含别名）的显式 `Place[]`；`hours` 留空（建筑本身不限时） */
export function placesFromBuildings(
  buildings: ReadonlyArray<{ name: string; campus: '北校' | '南校' | '1100'; alias?: string[] }> = CAMPUS_BUILDINGS,
): Place[] {
  return buildings.map((b) => {
    const place: Place = {
      id: placeId(b.name),
      name: b.name,
      campus: campusFromLabel(b.campus),
      hours: [],
      category: 'building',
    };
    if (b.alias?.length) place.alias = [...b.alias];
    return place;
  });
}

/* ============================================================
 * 六、合并与冲突检测（数据治理）
 * ========================================================== */

/**
 * 合并地点表：以 `base` 为准，`overlay` 只**补缺**（新增地点 / 补空 hours / 补别名），
 * **绝不覆盖已有校区** —— 避免上游数据质量差异悄悄改变引擎行为。
 *
 * ⚠️ 2026-09-15 修正：`overlay` 的 **`alias` 取并集**（此前会整条丢弃）。
 *    例：「第一教学楼 / 第三教学楼」既是模板库里的自习点、又是建筑表条目，
 *    若丢弃 overlay 的别名，就会漏掉「一教 / 三教 / 1教 / 3教」这几种课表常见写法。
 *    别名只是**查询键**，不携带校区语义，合并是安全的。
 */
export function mergePlaces(base: Place[], overlay: Place[]): Place[] {
  const byName = new Map<string, Place>(
    base.map((p) => [p.name, p.alias?.length ? { ...p, alias: [...p.alias] } : { ...p }]),
  );
  for (const o of overlay) {
    const b = byName.get(o.name);
    if (!b) {
      byName.set(o.name, o.alias?.length ? { ...o, alias: [...o.alias] } : { ...o });
      continue;
    }
    if (b.hours.length === 0 && o.hours.length) b.hours = o.hours;
    if (!b.category && o.category) b.category = o.category;
    if (o.alias?.length) {
      b.alias = [...new Set([...(b.alias ?? []), ...o.alias])];
    }
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
 * 七、索引与查询（规格书 §9-T0.1 步骤 2）
 * ========================================================== */

/**
 * 建索引。**同时按 `id` / `name` / `alias` 注册**，因此
 * `resolvePlace('逸兴楼')`、`resolvePlace('第四教学楼')`、`resolvePlace('poi-逸兴楼')`
 * 都能命中（O(1)）。先到先得：同一 key 只保留首个注册者。
 */
export function buildPlaceIndex(places: Place[]): Map<string, Place> {
  const m = new Map<string, Place>();
  const put = (key: string, p: Place): void => {
    if (!m.has(key)) m.set(key, p);
  };
  for (const p of places) {
    put(p.id, p);
    put(p.name, p);
    for (const a of p.alias ?? []) put(a, p);
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
 * 八、内置地点表
 * ========================================================== */

/**
 * 引擎内置地点表 = 模块库 POI **∪** 校园建筑（含别名）。
 *
 * ⚠️ 2026-09-15 修复（规格书 §13.7）：此前只有 `placesFromTemplates()`，
 *    导致课程楼（卓越楼 / 国合楼 / …）查不到校区。现并入 `placesFromBuildings()`。
 *    `mergePlaces` 以 base（模块库）为准，建筑表只**补缺**，不会覆盖既有校区。
 */
export const BUILTIN_PLACES: Place[] = mergePlaces(
  placesFromTemplates(DEFAULT_TEMPLATES),
  placesFromBuildings(),
);

/** 内置地点索引 */
export const BUILTIN_PLACE_INDEX: Map<string, Place> = buildPlaceIndex(BUILTIN_PLACES);
