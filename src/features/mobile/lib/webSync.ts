/**
 * 光溯移动端 · 网页端云同步钩子（F8 · 方案 §1/§7.2）
 * ============================================================
 * **默认关**（`usst.mobile.cloudSync !== '1'`），开关开时才可能发网络请求 ——
 * 方案 §11 的回滚承诺：「钩子默认关闭（开关不开=零网络）」，本文件有测试锁死这一点。
 *
 * 工作方式：轮询 web 端既有的两个 localStorage 键（`usst-life-assistant-v2` 主状态 /
 * `usst-user-plan-v1` 覆盖层），内容哈希变了且开关开着 → 组 SyncState payload
 * PUT /api/sync/state。**不改 web 端任何写入路径** —— 约束文档 §9 白名单不允许动
 * App.tsx / storage.ts，所以用「观察者」而不是「拦截器」实现同一语义。
 *
 * 与方案 §7.2 的差异（如实申报）：
 *   · web 端「不存整周计划」（types.ts 既有决策）→ 钩子只上传 SyncState，
 *     **不 PUT plan 副本**（web 页面内存里算的整周计划不落盘，钩子拿不到）；
 *     ICS 副本由移动页在编辑后上传。web-only 用户第一次要靠移动页同步一次才有 ICS。
 *   · 采纳方向是单向的（web → 云）。云端更新拉回走移动页的「以云端为准」。
 *
 * ⚠️ 接线点（BLOCKERS 登记，2026-10-03 夜）：把 `installWebSyncHook()` 挂到 web 入口
 * （App.tsx 或 main.tsx 各一行）属白名单外改动，夜间不做 —— 模块与测试已就绪，
 * 白天接线即生效。**没有接线之前，本模块的任何代码都不会运行**（零副作用）。
 */
import { stableHash, buildSyncPayload } from './sync.ts';
import { weekNoFromTermStart } from './sync.ts';
import type { UserPlanLayer } from '@/features/week/userPlanStore';

/** web 端既有存储键（src/lib/storage.ts:9 与 userPlanStore.ts:37，单一事实来源） */
export const WEB_STATE_KEY = 'usst-life-assistant-v2';
export const WEB_LAYER_KEY = 'usst-user-plan-v1';
/** F8 开关：值 === '1' 才视为开（默认关） */
export const SWITCH_KEY = 'usst.mobile.cloudSync';
/** 上次上传的内容签名（去抖：内容没变不重复上传） */
export const LAST_SIG_KEY = 'usst.mobile.webSyncSig';
/** 上次云端确认的 updatedAt（LWW 依据留档，排查用） */
export const LAST_SYNC_KEY = 'usst.mobile.webSyncAt';

export interface WebSyncDeps {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  fetchImpl: typeof fetch;
  /** 每次注入当前时间（测试可固定，纯函数纪律） */
  today: () => Date;
  token: string;
  log?: (msg: string) => void;
}

export interface WebSyncTickResult {
  uploaded: boolean;
  reason: 'switch-off' | 'no-state' | 'unchanged' | 'bad-state' | 'no-schedule' | 'no-token'
    | 'accepted' | 'rejected' | 'network-error';
  serverUpdatedAt?: string;
}

/**
 * 单次「检查并按需上传」。除 fetch 外全部纯同步逻辑，注入依赖即可单测。
 * 开关关 → **在任何读取网络之前就返回**（零网络请求的断言打在这里）。
 */
export async function webSyncTick(deps: WebSyncDeps): Promise<WebSyncTickResult> {
  if (deps.read(SWITCH_KEY) !== '1') return { uploaded: false, reason: 'switch-off' };
  if (!deps.token) return { uploaded: false, reason: 'no-token' };

  const raw = deps.read(WEB_STATE_KEY);
  if (!raw) return { uploaded: false, reason: 'no-state' };

  const sig = String(stableHash(raw));
  if (sig === deps.read(LAST_SIG_KEY)) return { uploaded: false, reason: 'unchanged' };

  let app: Record<string, unknown>;
  try {
    app = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { uploaded: false, reason: 'bad-state' };
  }
  const schedule = app.schedule as { termStart?: string } | null | undefined;
  if (!schedule?.termStart) return { uploaded: false, reason: 'no-schedule' };

  let layer: UserPlanLayer | null = null;
  try {
    const lr = deps.read(WEB_LAYER_KEY);
    layer = lr ? (JSON.parse(lr) as UserPlanLayer) : null;
  } catch {
    layer = null; // 覆盖层坏了 ≠ 状态不能传：无覆盖层照样同步主状态
  }

  const today = deps.today();
  const termStart = schedule.termStart;
  const clientUpdatedAt = today.toISOString();
  const payload = buildSyncPayload({
    schedule: schedule as never,
    planState: (app.planState as never) ?? null,
    userOverrides: layer,
    termStart,
    weekNo: weekNoFromTermStart(termStart, today) ?? 1,
    clientUpdatedAt,
    // schemaVer=2：画像随主状态上行（web 端画像本来就在 AppState 里）
    persona: (app.persona as never) ?? null,
  });

  try {
    const res = await deps.fetchImpl('/api/sync/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.token}` },
      body: JSON.stringify({ state: payload, schemaVer: 2, clientUpdatedAt }),
    });
    if (!res.ok) {
      deps.log?.(`webSync 上传失败 HTTP ${res.status}`);
      return { uploaded: false, reason: 'network-error' };
    }
    const body = (await res.json()) as { accepted: boolean; updatedAt: string };
    // 签名无论接受与否都记下：被拒说明云端更新，本地这份不该再重试刷屏（以云端为准）
    deps.write(LAST_SIG_KEY, sig);
    deps.write(LAST_SYNC_KEY, body.updatedAt);
    if (!body.accepted) {
      deps.log?.('webSync 云端更新，本地跳过（以云端为准）');
      return { uploaded: false, reason: 'rejected', serverUpdatedAt: body.updatedAt };
    }
    deps.log?.('webSync 已上传');
    return { uploaded: true, reason: 'accepted', serverUpdatedAt: body.updatedAt };
  } catch {
    return { uploaded: false, reason: 'network-error' };
  }
}

/**
 * 浏览器安装器：返回卸载函数。**必须由入口显式调用才会运行**（见文件头接线点说明）。
 * 轮询间隔 2s：轻量（读两个 localStorage 键 + 一次哈希），覆盖「改完课表几秒内同步」。
 */
export function installWebSyncHook(opts?: { intervalMs?: number; identity?: { token: string } | null }): () => void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return () => undefined; // 非浏览器环境：永续 no-op
  }
  const deps: WebSyncDeps = {
    read: (k) => localStorage.getItem(k),
    write: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch { /* 配额满：下轮再试 */ }
    },
    fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args),
    today: () => new Date(),
    token: opts?.identity?.token ?? '',
    log: (m) => console.info('[webSync]', m),
  };
  const timer = window.setInterval(() => void webSyncTick(deps), opts?.intervalMs ?? 2000);
  return () => window.clearInterval(timer);
}
