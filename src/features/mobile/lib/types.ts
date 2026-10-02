/**
 * 光溯移动端 · 局部类型（方案 §5：零改动 src/types.ts，新增类型全部放这里）
 * ============================================================
 * SyncState payload（schemaVer=1）与端点响应的**线协议**形状。
 * 字段语义以 src/types.ts 的 Schedule / PlanPersistState / UserPlanLayer 为准 ——
 * 服务端只透传不解释，客户端对不认识的字段一律忽略（前向兼容条款）。
 */
import type { Schedule } from '@/types';
import type { PlanPersistState } from '@/types';
import type { UserPlanLayer } from '@/features/week/userPlanStore';

/** 方案 §5.1 —— 权威状态 */
export interface SyncStatePayload {
  schemaVer: 1;
  termStart: string;
  weekNo: number;
  schedule: Schedule;
  planState?: PlanPersistState | null;
  userOverrides?: UserPlanLayer | null;
  clientUpdatedAt: string;
}

/** GET /api/sync/state 响应 */
export interface SyncStateResponse {
  found: boolean;
  state: SyncStatePayload | null;
  schemaVer: number;
  updatedAt: string | null;
}

/** PUT /api/sync/state 响应（LWW 裁决） */
export interface SyncPutResponse {
  accepted: boolean;
  updatedAt: string;
  state?: SyncStatePayload | null;
}

/** GET/PUT /api/sync/plan 响应（WeekPlan 副本，仅 ICS 素材 + 展示兜底） */
export interface PlanCopyResponse {
  found: boolean;
  plan: import('@/types').WeekPlan | null;
  updatedAt: string | null;
}

/** POST /api/auth/register | login 响应（icsToken：IcsGuide 复制订链用） */
export interface AuthResponse {
  userId: number;
  token: string;
  icsToken?: string;
}

/** GET /api/version 响应（F18 应用内检查更新） */
export interface VersionResponse {
  version: string;
  apkUrl: string;
  notes: string;
}

/** 统一错误形态（服务端契约 {"error": "<code>"}） */
export interface ApiError {
  error: string;
}
