/**
 * 宿舍 / 公寓清单（首次设置「我的住处」三级联选的数据源）
 * ============================================================
 * ── 数据从哪来（**唯一真源是 `data/campus_map.json`**）────────────
 * 这份清单是那份校园图谱的**投影**，不是另起一份数据：
 *   取自 `landmarks` 里 `type === '宿舍'` 且 `campus ∈ {北校, 南校}` 的全部条目。
 * 每条保留原始 `name`（它就是写进 `layer.homeBase.name` 的值，也是排程里
 * 宿舍类块最终显示的地点）、`zone`（方位描述）与 `verified`（图谱的核实标记）。
 *
 * ⚠️ **不许在这儿手改名单** —— `tests/dorms.test.ts` 会把本文件与
 *   `data/campus_map.json` 做**集合相等**断言；真要增删，改图谱再让它变红。
 *
 * ── 为什么前端要自己带一份（而不是运行时去问服务端）──────────
 * 规格书 AC-4 要求「不启动 serve.py 也能用」（localStorage 模式），
 * 所以前端**必须**有一份可离线读到的清单。图谱是构建期就有的静态数据，
 * 投影成模块是最省事的做法；哪天要改成 serve.py 直供，加一层 fetch +
 * 这份投影当兜底即可，UI 不用动。
 *
 * ── 已知缺口（不猜，如实记在这儿）──────────────────────────
 *  · **1100（大一基础学院）的 A/B/C 区宿舍图谱里没有** —— 本轮按 RAY 拍板
 *    「先不做 1100」，故本清单只含北校 / 南校；
 *  · `verified: false` 的几条（七公寓 / 学子公寓 / 新专家楼 / 玄德居 /
 *    老专家楼 / 南六宿舍）图谱自述「待核实」，UI 会给一个「待核」角标。
 */
import type { CampusName } from '@/lib/planner/templates.ts';

/** 清单覆盖的校区（图谱口径：北校 = 军工路 516，南校 = 军工路 334） */
export type DormCampus = '北校' | '南校';

/** 住处两级分类：公寓 / 宿舍（按图谱里的正式名判定，见文件末 `categoryOf`） */
export type DormCategory = '公寓' | '宿舍';

export interface DormEntry {
  /** 正式名 —— 直接写进 `layer.homeBase.name` */
  name: string;
  campus: DormCampus;
  category: DormCategory;
  /** 图谱的核实标记；false = 待核实（UI 标「待核」） */
  verified: boolean;
  /** 方位描述，如「北校区·生活区」「南校区（334）·南」 */
  zone: string;
}

/**
 * 排序规则 = 生成顺序（北校在前、同校区内公寓在前），与图谱抽取脚本一致。
 * `tests/dorms.test.ts` 只比集合，不比顺序 —— 顺序只为读起来顺。
 */
export const DORMS: readonly DormEntry[] = [
  { name: '七公寓', campus: '北校', category: '公寓', verified: false, zone: '北校区·西北角' },
  { name: '学子公寓', campus: '北校', category: '公寓', verified: false, zone: '北校区' },
  { name: '留学生公寓', campus: '北校', category: '公寓', verified: true, zone: '北校区' },
  { name: '第一学生公寓', campus: '北校', category: '公寓', verified: true, zone: '北校区·生活区' },
  { name: '第三学生公寓', campus: '北校', category: '公寓', verified: true, zone: '北校区·东部（花园旁）' },
  { name: '第二学生公寓', campus: '北校', category: '公寓', verified: true, zone: '北校区·南缘（近海安路天桥）' },
  { name: '第四学生公寓', campus: '北校', category: '公寓', verified: true, zone: '北校区·东北角（春江路）' },
  { name: '北校区第七宿舍', campus: '北校', category: '宿舍', verified: true, zone: '北校区·历史核心区（尚思路沿线）' },
  { name: '北校区第三宿舍', campus: '北校', category: '宿舍', verified: true, zone: '北校区·生活区' },
  { name: '北校区第五宿舍', campus: '北校', category: '宿舍', verified: true, zone: '北校区·运动区东侧' },
  { name: '北校区第八宿舍', campus: '北校', category: '宿舍', verified: true, zone: '北校区·东部（花园平台旁）' },
  { name: '北校区第四宿舍', campus: '北校', category: '宿舍', verified: true, zone: '北校区·生活区' },
  { name: '启明楼宿舍', campus: '北校', category: '宿舍', verified: true, zone: '北校区·中北部' },
  { name: '新专家楼', campus: '北校', category: '宿舍', verified: false, zone: '北校区' },
  { name: '玄德居', campus: '北校', category: '宿舍', verified: false, zone: '北校区' },
  { name: '第九宿舍', campus: '北校', category: '宿舍', verified: true, zone: '北校区·生活区（第一食堂楼上）' },
  { name: '第十二宿舍', campus: '北校', category: '宿舍', verified: true, zone: '北校区·最东' },
  { name: '第十宿舍', campus: '北校', category: '宿舍', verified: true, zone: '北校区·生活区（第一食堂楼上）' },
  { name: '老专家楼', campus: '北校', category: '宿舍', verified: false, zone: '北校区' },
  { name: '藏书阁宿舍', campus: '北校', category: '宿舍', verified: true, zone: '北校区·历史核心区' },
  { name: '第五学生公寓', campus: '南校', category: '公寓', verified: true, zone: '南校区（334）·北侧（近卓越楼）' },
  { name: '第六学生公寓', campus: '南校', category: '公寓', verified: true, zone: '南校区（334）·东北（近外语楼）' },
  { name: '南六宿舍', campus: '南校', category: '宿舍', verified: false, zone: '南校区（334）' },
  { name: '南校区教工宿舍', campus: '南校', category: '宿舍', verified: true, zone: '南校区（334）·西北' },
  { name: '南校区第一宿舍', campus: '南校', category: '宿舍', verified: true, zone: '南校区（334）·西南' },
  { name: '南校区第七宿舍', campus: '南校', category: '宿舍', verified: true, zone: '南校区（334）·南（尚理路沿线）' },
  { name: '南校区第三宿舍', campus: '南校', category: '宿舍', verified: true, zone: '南校区（334）·西北' },
  { name: '南校区第九宿舍', campus: '南校', category: '宿舍', verified: true, zone: '南校区（334）·南' },
  { name: '南校区第二宿舍', campus: '南校', category: '宿舍', verified: true, zone: '南校区（334）·西' },
  { name: '南校区第五宿舍', campus: '南校', category: '宿舍', verified: true, zone: '南校区（334）·北（思餐厅旁）' },
  { name: '南校区第八宿舍', campus: '南校', category: '宿舍', verified: true, zone: '南校区（334）·南' },
  { name: '南校区第十宿舍', campus: '南校', category: '宿舍', verified: true, zone: '南校区（334）·南（尚理路沿线）' },
  { name: '南校区第四宿舍', campus: '南校', category: '宿舍', verified: true, zone: '南校区（334）·南（尚理路沿线）' },
];

/** 联选用校区顺序（固定，不按数据出现顺序飘） */
export const DORM_CAMPUSES: readonly DormCampus[] = ['北校', '南校'];

/** 联用分类顺序 */
export const DORM_CATEGORIES: readonly DormCategory[] = ['公寓', '宿舍'];

/** 某校区下的一级分类（按固定顺序，只列真正有楼的分类） */
export function dormCategories(campus: DormCampus): DormCategory[] {
  return DORM_CATEGORIES.filter((c) => DORMS.some((d) => d.campus === campus && d.category === c));
}

/** 某校区 + 某分类下的楼（数据顺序） */
export function dormsOf(campus: DormCampus, category: DormCategory): DormEntry[] {
  return DORMS.filter((d) => d.campus === campus && d.category === category);
}

/** 按正式名查一条（用于回填已存的值） */
export function dormByName(name: string | undefined | null): DormEntry | undefined {
  if (!name) return undefined;
  return DORMS.find((d) => d.name === name);
}

/** 判一个 `campus` 字符串是不是清单认识的校区（存进去的是 `CampusName`，读回来只是 string） */
export function isDormCampus(v: string | undefined | null): v is DormCampus {
  return v === '北校' || v === '南校';
}

/** 正式名 → 分类（导出只为让测试能独立复核这条规则，不在 UI 里用） */
export function categoryOf(name: string): DormCategory {
  return name.includes('公寓') ? '公寓' : '宿舍';
}

/** 写进 `layer.homeBase.campus` 的值 —— 与引擎侧的 `CampusName` 同一口径 */
export type HomeCampus = Extract<CampusName, '北校' | '南校'>;
