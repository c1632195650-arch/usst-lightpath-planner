/**
 * 光溯移动端 · API 客户端（方案 §7.1 lib/api.ts）
 * ============================================================
 * ## API_BASE 的三种情形（2026-10-06 随「包内资源模式」重写）
 *
 * 1. **APK 包内模式（当前默认）**：页面 origin = `https://localhost`（Capacitor 的
 *    本地资源 scheme）。此时「同源相对路径」会打到**包内而非服务器**，
 *    所以必须显式指到公网后端。
 * 2. **旧模式（server.url = http://101.35.253.143）**：origin 就是公网 IP，相对路径可用。
 * 3. **本地 dev / vite preview / e2e**：相对路径即可（e2e 由 page.route 打桩）。
 *
 * 判定方式：**看当前 origin 是不是 Capacitor 的本地 scheme**
 *   —— `location.hostname === 'localhost'` 且协议为 https ⇒ 包内模式。
 * 这样无需在构建期注入 URL，dev 与 e2e 的现有行为也完全不变（它们 origin 不是 localhost）。
 *
 * 覆盖优先级：构建期 `VITE_MOBILE_API_BASE` > 运行时包内兜底 > 相对路径（空串）。
 * ⚠️ 后端地址在此**仅作兜底默认值**（与 capacitor.config 里的 server.url 同源同值）；
 *    改地址时两处一起改，别只改一处。
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
// W4/P1-3a（2026-10-07）：基址解析统一走 src/lib/apiBase.ts（双端同一解析，
// 修「登录一个后端、待办另一个后端」的坑）。本文件原三种情形的语义不变：
// VITE_MOBILE_API_BASE → 包内兜底 → 同源相对路径。
import { resolveApiBase } from '@/lib/apiBase';

const API_BASE = resolveApiBase();


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
