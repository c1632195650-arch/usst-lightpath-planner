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
