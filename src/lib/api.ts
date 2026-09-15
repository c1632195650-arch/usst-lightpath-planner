/**
 * 梨宝后端 API 客户端
 * 后端默认跑在 http://127.0.0.1:8000（server/app.py）。
 * 部署时可用 VITE_API_BASE 环境变量覆盖。
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://127.0.0.1:8000';

export interface RagSource {
  title: string;
  account: string;
  pub_time: string;
  snippet: string;
  url: string;
}

export interface ChatResult {
  answer: string;
  mode: 'llm' | 'extractive' | 'empty';
  sources: RagSource[];
  /* ---- 以下字段后端 /api/chat 一直在返回，此前这里没声明 → 调试信号全丢。
     不是「新增能力」，只是把已经算出来的东西如实声明出来。 ---- */
  /** 路由判定：llm / hybrid / extractive / empty（决定这轮走合成还是抽取） */
  route?: string;
  /** 意图标签（后端 classify_intent 的产物） */
  intent?: string;
  /** 检索最高原始向量相似度 —— 边界外判定的信号源，排查「为什么答不上来」看它 */
  top_raw_vec?: number;
  /** 本轮是否注入了校园空间上下文（食堂/问路等） */
  used_space?: boolean;
  /** 本轮是否读到了记忆（长期画像 / 增量摘要 / 最近原话） */
  used_memory?: boolean;
}

export interface SearchResult {
  id: number;
  account: string;
  title: string;
  pub_time: string;
  score: number;
  full_text: string;
  url: string;
}

export interface HealthResult {
  ok: boolean;
  llm: boolean;
  model: string | null;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/* ---------------- 对话身份（记忆层的前置条件） ---------------- */

/**
 * `user_id` 与 `session_id` 是两个不同的概念，必须分开传：
 *   - `user_id`   设备级、持久、跨会话 —— 决定「长期画像」能否跨会话累积；
 *   - `session_id` 会话级、可重置      —— 决定「最近原话」的窗口范围。
 * 合并成一个会让「跨会话的画像」和「本次会话的上下文」互相污染。
 */
export interface ChatIdentity {
  userId?: string;
  sessionId?: string;
}

/** 梨宝问答。
 *  @param identity   对话身份。不传则后端落回 `default`/`anon` —— 记忆层不会生效。
 *  @param profileCtx 用户档案摘要（画像轴值 + 课表概览 + 学期阶段），
 *                    由 `features/libao/` 侧生成；后端会将其作为独立段落注入 system prompt，
 *                    使回答建立在「你是谁」之上，而不是一个匿名提问者。
 */
export function lbaoChat(
  q: string,
  identity: ChatIdentity = {},
  profileCtx = '',
): Promise<ChatResult> {
  // 值为 undefined 时 JSON.stringify 会省略该键 → 后端沿用自身默认值，天然向后兼容
  return post<ChatResult>('/api/chat', {
    q,
    user_id: identity.userId,
    session_id: identity.sessionId,
    profile_ctx: profileCtx || undefined,
  });
}

/** 梨宝检索（无 LLM 合成，直接返回文章） */
export function lbaoSearch(q: string): Promise<{ query: string; results: SearchResult[] }> {
  return get(`/api/search?q=${encodeURIComponent(q)}&k=5`);
}

/** 健康检查（判断后端/LLM 是否在线） */
export function lbaoHealth(): Promise<HealthResult> {
  return get<HealthResult>('/api/health');
}

/* ---------------- 步行路径（排程引擎的转场时间） ---------------- */

export interface RouteResult {
  from: string;
  to: string;
  /** 总步行米数（含楼到路网的接驳段） */
  meters: number;
  minutes: number;
  /** false = 至少一端是靠估算锚定的，仅供参考 */
  reliable: boolean;
  /** 两端各自的定位来源（osm / keypoint / zone / …） */
  locate: string[];
  mode: 'fastest' | 'campus';
}

export type RouteMode = 'fastest' | 'campus';

/** 两点间步行路径；查不到时返回 null（调用方退回估算值） */
export async function routeBetween(
  from: string, to: string, mode: RouteMode = 'fastest',
): Promise<RouteResult | null> {
  const res = await get<{ route: RouteResult | null }>(
    `/api/route?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&mode=${mode}`,
  );
  return res.route;
}

/** 批量问路：排程时一次要问十几对，逐条请求太慢 */
export function routeBatch(
  pairs: Array<[string, string]>, mode: RouteMode = 'fastest',
): Promise<{ routes: Record<string, RouteResult | null>; mode: string }> {
  return post<{ routes: Record<string, RouteResult | null>; mode: string }>(
    '/api/route/batch', { pairs, mode },
  );
}
