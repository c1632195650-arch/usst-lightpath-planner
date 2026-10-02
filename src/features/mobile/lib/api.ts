/**
 * 光溯移动端 · API 客户端（方案 §7.1 lib/api.ts）
 * ============================================================
 * API_BASE 缺省 = **同源**（相对路径）：
 *   · APK 内 server.url = http://101.35.253.143 → /api 同源直达；
 *   · vite preview / e2e 同源，网络层由测试桩（page.route）接管；
 *   · 需要跨源时用 VITE_MOBILE_API_BASE 覆盖（本地 dev 调后端 8001 等）。
 * 失败一律返回 {ok:false, error}，不 throw —— 移动端网络差是常态，调用方决定降级。
 */
import type {
  ApiError,
  AuthResponse,
  PlanCopyResponse,
  SyncPutResponse,
  SyncStatePayload,
  SyncStateResponse,
  VersionResponse,
} from './types.ts';

const API_BASE = (import.meta.env.VITE_MOBILE_API_BASE as string | undefined) ?? '';

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(`API ${status}: ${code}`);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (e) {
    // 网络层失败（断网/超时/DNS）——统一当作 0 状态处理
    throw new ApiFailure(0, 'network_error');
  }
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      const body = (await res.json()) as Partial<ApiError>;
      if (body?.error) code = body.error;
    } catch {
      /* 非 JSON 错误体（如 nginx 502 页面）→ 保留 http_xxx 码 */
    }
    throw new ApiFailure(res.status, code);
  }
  return (await res.json()) as T;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/* ---------- 账号（F1） ---------- */

export function apiRegister(username: string, password: string): Promise<AuthResponse> {
  return call('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) });
}

export function apiLogin(username: string, password: string): Promise<AuthResponse> {
  return call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
}

/* ---------- 同步（F8/F9） ---------- */

export function apiGetSyncState(token: string): Promise<SyncStateResponse> {
  return call('/api/sync/state', { headers: authHeaders(token) });
}

export function apiPutSyncState(
  token: string,
  body: { state: SyncStatePayload; schemaVer: number; clientUpdatedAt: string },
): Promise<SyncPutResponse> {
  return call('/api/sync/state', { method: 'PUT', headers: authHeaders(token), body: JSON.stringify(body) });
}

export function apiGetPlanCopy(token: string, weekNo: number): Promise<PlanCopyResponse> {
  return call(`/api/sync/plan?weekNo=${weekNo}`, { headers: authHeaders(token) });
}

export function apiPutPlanCopy(
  token: string,
  weekNo: number,
  plan: import('@/types').WeekPlan,
): Promise<{ updatedAt: string }> {
  return call(`/api/sync/plan?weekNo=${weekNo}`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ plan }),
  });
}

/* ---------- 版本（F18） ---------- */

export function apiGetVersion(): Promise<VersionResponse> {
  return call('/api/version');
}
