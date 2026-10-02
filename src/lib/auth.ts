/**
 * auth.ts —— 本地账号系统的前端通道
 * ============================================================
 * 对接仓库根 serve.py 的 /api/auth/* 与 /api/db。
 * 约束：纯 fetch，同源 Cookie 自动携带（HttpOnly，JS 摸不到 token）；
 *       不 import react / features（lib/** 分层纪律）；
 *       允许 fetch（不在 src/lib/planner/** 下，不违反引擎纯函数约束）。
 *
 * 三种状态：
 *   logged-in   —— 已登录（有会话 Cookie）
 *   logged-out  —— 服务在线但未登录 → 显示登录页
 *   offline     —— 服务不可达（serve.py 没开）→ 跳过登录，网站以 localStorage 模式照常运行
 */

import { cloudKeys } from '@/lib/persistence';

export type AuthStatus = 'logged-in' | 'logged-out' | 'offline';

export interface AuthCheck {
  status: AuthStatus;
  username: string | null;
}

/** 启动时问一次「我是谁」；网络不可达 = offline（不是未登录） */
export async function fetchMe(): Promise<AuthCheck> {
  try {
    const res = await fetch('/api/auth/me');
    if (res.status === 401) return { status: 'logged-out', username: null };
    if (!res.ok) return { status: 'offline', username: null };
    const data = (await res.json()) as { ok?: boolean; username?: string };
    if (data.ok && data.username) return { status: 'logged-in', username: data.username };
    return { status: 'offline', username: null };
  } catch {
    return { status: 'offline', username: null };
  }
}

export interface AuthResult {
  ok: boolean;
  /** 'offline' = 连不上服务（区别于业务失败的具体原因） */
  error?: string;
}

async function post(path: string, body: unknown): Promise<AuthResult> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!data) return { ok: false, error: `服务异常（HTTP ${res.status}）` };
    if (!data.ok) return { ok: false, error: data.error ?? '未知错误' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

export function register(username: string, password: string): Promise<AuthResult> {
  return post('/api/auth/register', { username, password });
}

export function login(username: string, password: string): Promise<AuthResult> {
  return post('/api/auth/login', { username, password });
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    /* 服务不在就算了；Cookie 会话 7 天自然过期 */
  }
}

/**
 * 注销账号（**不可恢复**）：需再次输入密码确认。
 * 成功 = 服务端已删该账号及其全部数据（kv / sessions 随 users 行级联清除）。
 * 本系统无密码找回（规格书 §1.3：忘记密码 = 删账号重来）。
 */
export function deleteAccount(password: string): Promise<AuthResult> {
  return post('/api/auth/delete', { password });
}

/* ------------------------------------------------------------------
 * 首次登录数据并入：本机 localStorage 有数据、而该账号云端 kv 为空时，
 * 把本机快照整包上传。判断与上传都在这里，UI 只负责弹确认框。
 * ------------------------------------------------------------------ */

/** 本机 localStorage 里是否有任何**可入库**数据（排除 localOnly 的本机归属标记） */
export function hasLocalData(): boolean {
  return cloudKeys().some((k) => localStorage.getItem(k) != null);
}

/** 该账号在服务端的 kv 是否为空 */
export async function serverDataEmpty(): Promise<boolean> {
  try {
    const res = await fetch('/api/db');
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean; items?: unknown[] };
    return data.ok === true && Array.isArray(data.items) && data.items.length === 0;
  } catch {
    return false;
  }
}

/** 把本机 localStorage 快照整包上传；返回成功上传的 key 数 */
export async function uploadLocalSnapshot(): Promise<number> {
  let uploaded = 0;
  for (const key of cloudKeys()) {
    const raw = localStorage.getItem(key);
    if (raw == null) continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      continue; // 解析不了的脏数据不搬运
    }
    try {
      const res = await fetch(`/api/db/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, updated_at: Date.now() }),
      });
      if (res.ok) uploaded += 1;
    } catch {
      /* 单 key 失败不中断整体并入 */
    }
  }
  return uploaded;
}

/* ------------------------------------------------------------------
 * R7.1（P1-4）· 梨宝记忆台账过户（CY 2026-10-03 拍板「迁移合并」）
 * ------------------------------------------------------------------
 * 为什么 KV 快照不够：上面的 uploadLocalSnapshot 搬的是 localStorage 云快照，
 * 而梨宝记忆落在**后端 SQLite 的 facts / profiles 表**（按 user_id 分键）——
 * KV 通道根本碰不到。「先离线用、后登录」时，设备 id 攒下的记忆就成了孤儿，
 * 面板显示 0/0（CY 走查实录：看起来像坏了）。
 *
 * 冲突策略默认 `account_wins`：同一条 key 账号侧已有活记录时保留账号侧（账号是
 * 用户主动登录认领的正本，设备侧多为离线期自动抽取的猜测）。
 */
export type MigrateStrategy = 'account_wins' | 'device_wins' | 'keep_both';

export interface MigrateMemoryResult {
  ok: boolean;
  /** 实际过户的条数 */
  moved: number;
  /** 因冲突或已撤销而跳过的条数 */
  skipped: number;
  /** 设备侧画像是否已并入账号画像 */
  profileMerged: boolean;
  strategy: MigrateStrategy;
}

/** 把设备台账的梨宝记忆并入账号台账。失败/离线返回 ok:false（由调用方静默降级）。 */
export async function migrateMemoryLedger(
  oldId: string,
  newId: string,
  strategy: MigrateStrategy = 'account_wins',
): Promise<MigrateMemoryResult> {
  const fallback: MigrateMemoryResult = {
    ok: false, moved: 0, skipped: 0, profileMerged: false, strategy,
  };
  if (!oldId || !newId || oldId === newId) return { ...fallback, ok: true };
  try {
    const res = await fetch('/api/memory/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_id: oldId, new_id: newId, strategy }),
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as Partial<MigrateMemoryResult>;
    return {
      ok: data.ok === true,
      moved: data.moved ?? 0,
      skipped: data.skipped ?? 0,
      profileMerged: data.profileMerged === true,
      strategy: data.strategy ?? strategy,
    };
  } catch {
    return fallback; // 服务不可达 → 静默：迁移是尽力而为，不该挡住登录
  }
}
