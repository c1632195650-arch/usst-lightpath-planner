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

/** 梨宝问答 */
export function lbaoChat(q: string): Promise<ChatResult> {
  return post<ChatResult>('/api/chat', { q });
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
