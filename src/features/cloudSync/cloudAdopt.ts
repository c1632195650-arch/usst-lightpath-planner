/**
 * 网页端 · 登录后「以云端为准」的一次采纳（2026-10-08）
 * ============================================================
 * 补的是同步链上缺的那个方向。既有事实（见 webSync.ts 文件头）：
 *   · 网页端钩子**只上推**（web → 云）；
 *   · 登录成功会自动打开同步开关（applyLoginSuccess → setCloudSync(true)）。
 * 两条叠加后，「新浏览器登录一个已有数据的账号」这条最常见的路径会变成：
 * 浏览器本地还是 App 自带**示例课表** → 两秒后上推 → **把云端真实态整片覆盖**。
 * 实测污染：云端 termStart 被换成示例口径（与云端周计划副本的周次错位）、
 * planState 的滚动视野（上周透支）与锁被清空 —— 移动端「以云端为准」拉到的是被污染的一份。
 *
 * 本模块就是反方向的那一次拉取，语义与移动端完全一致（useTodayData：「以云端为准」）：
 *   · **只在本地是脚手架态时采纳云端** —— `source==='demo'` / 无课表 / 主状态缺失
 *     （`isScaffoldedState`）。本地已有真实数据的用户**不受任何影响**（照常上推）；
 *   · 云端没有状态（新账号）→ no-op（不写任何键）；
 *   · 采纳内容：主状态七个账号侧字段 + 覆盖层（`userOverrides` → 本地层键）。
 *
 * 纯逻辑 + 注入依赖（node --test 直测）；网络与存储副作用全在调用方（组件）。
 */
import { WEB_STATE_KEY, WEB_LAYER_KEY } from '@/features/mobile/lib/webSync';
import { SCHEMA_VERSION } from '@/features/week/userPlanStore';

export interface AdoptCloudDeps {
  read: (k: string) => string | null;
  write: (k: string, v: string) => void;
  fetchImpl: typeof fetch;
  token: string;
}

export type AdoptCloudReason =
  | 'no-token'        // 没登录：不动
  | 'not-scaffolded'  // 本地已有真实数据：以本地为准（上推路径），不采纳
  | 'cloud-empty'     // 云端没有可用状态（新账号 / 空 JSON）：不写
  | 'network-error'   // 拉不到：下次登录再试，不在登录路径上打断
  | 'adopted';        // 已采纳并写盘（调用方应刷新以让 UI 与世界对齐）

export interface AdoptCloudResult {
  adopted: boolean;
  reason: AdoptCloudReason;
}

/** 主状态里属于「账号侧」、可被云端覆盖的字段（其余键原样保留）。
 *  ⚠️ 不含 todos/goals —— 它们不在 AppState 里（待办域走 memoStore 独立键，
 *  MemoPanel 自己有 GET 拉取与并集合并，不从这里过）。 */
const ADOPT_KEYS = [
  'persona', 'answers', 'schedule', 'semesterPlan', 'selectedDays', 'lifeMode', 'planState',
] as const;

/**
 * 本地主状态是否脚手架/缺失。
 *
 * 判据刻意保守 —— **只有确信本地没有真实数据时才返回 true**：
 *   · 无主状态键 / 坏 JSON → true（等于全新设备）；
 *   · 有 schedule 但 source==='demo' → true（App 自带示例课表，用户还没导入过）；
 *   · 有真实课表（'pdf' / 'manual'）→ false。
 */
export function isScaffoldedState(raw: string | null): boolean {
  if (!raw) return true;
  try {
    const app = JSON.parse(raw) as { schedule?: { source?: string; courses?: unknown } | null };
    const s = app.schedule;
    if (!s || !Array.isArray(s.courses) || s.courses.length === 0) return true;
    return s.source === 'demo';
  } catch {
    return true;
  }
}

/**
 * 登录成功后调用：本地是脚手架态 → 拉取云端状态并写入本地，返回 `adopted:true`。
 *
 * 调用方拿到 `adopted:true` 后应刷新页面（写的是 localStorage，内存态需要重载才生效）。
 */
export async function adoptCloudStateIfScaffolded(deps: AdoptCloudDeps): Promise<AdoptCloudResult> {
  if (!deps.token) return { adopted: false, reason: 'no-token' };

  const raw = deps.read(WEB_STATE_KEY);
  if (!isScaffoldedState(raw)) return { adopted: false, reason: 'not-scaffolded' };

  let res: Response;
  try {
    res = await deps.fetchImpl('/api/sync/state', {
      headers: { Authorization: `Bearer ${deps.token}` },
    });
  } catch {
    return { adopted: false, reason: 'network-error' };
  }
  if (!res.ok) return { adopted: false, reason: 'network-error' };

  let body: { found?: boolean; state?: Record<string, unknown> | null };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { adopted: false, reason: 'cloud-empty' };
  }
  const cloud = body.state;
  if (!body.found || !cloud || typeof cloud !== 'object' || !cloud.schedule) {
    return { adopted: false, reason: 'cloud-empty' };
  }

  // 主状态：保留本地既有键（version 等），只覆盖账号侧字段；云端为 null 的字段跳过（不抹本地）
  let local: Record<string, unknown> = {};
  if (raw) {
    try {
      local = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      local = {};
    }
  }
  const next: Record<string, unknown> = { ...local, onboarded: true };
  for (const k of ADOPT_KEYS) {
    const v = cloud[k];
    if (v !== undefined && v !== null) next[k] = v;
  }
  deps.write(WEB_STATE_KEY, JSON.stringify(next));

  // 覆盖层（可选）：云端 userOverrides → 本地层键。
  // schemaVersion 归一为本地当前版本 —— userPlanStore.normalize 对版本不符**整层丢弃**，
  // 不归一会让采纳来的层在网页端静默失效。
  const ov = cloud.userOverrides;
  if (ov && typeof ov === 'object') {
    deps.write(WEB_LAYER_KEY, JSON.stringify({ ...(ov as Record<string, unknown>), schemaVersion: SCHEMA_VERSION }));
  }

  return { adopted: true, reason: 'adopted' };
}
