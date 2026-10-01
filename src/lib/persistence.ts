/**
 * persistence.ts —— 双写持久化层（持久化与账号系统实施规格书 §三 3.3 / §五 5.3）
 * ============================================================
 * 定位：localStorage 从「唯一真源」降级为**缓存层**；服务端 SQLite（serve.py
 * 的 kv 表）为**数据真源**。所有 store 的存储缝隙改走本模块，key 字符串不变。
 *
 * 写路径：writeRaw = localStorage 同步写（保底）+ PUT /api/db 异步（失败静默，
 *         离线容忍 —— AC-4：serve.py 没开时网站照常跑）。
 *
 * 读路径（bootstrapSync，main.tsx 渲染前跑一次）：
 *   · 云端有、本地无 → 云端写回本地（**浏览器档案重置后的恢复路径**，
 *     对应 2026-09-26 Edge「加密偏好重置」丢数据事故）；
 *   · 两边都有但不一致 → **本地胜**，并把本地 PUT 回云端（抹平分歧）。
 *     为什么本地胜：单机单用户下两边只在「离线期间本地有新写入」时分歧，
 *     此时本地必然更新；多设备语义不在本批范围（规格书 §一 1.3）。
 *   · 云端空、本地有 → 本地 PUT 上云（登录并入流程之外的安全网）。
 *
 * 约束：不 import react / features；允许 fetch；不读时钟以外的副作用无。
 *
 * 账号隔离（§5.5，2026-10-01 补）：localStorage 缓存带一个**本机归属标记**
 * （`usst.local_owner.v1`，localOnly 不上云）。换账号时以它判定：归属不同 →
 * 清本机缓存、按该账号云端重建（云端空 = 纯新账号）；归属相同 → 本地胜。
 */

import { STORAGE_KEY_LIST, metaOf } from '@/lib/storageRegistry';

/** 本机缓存归属标记的 key（localOnly：只写本机，绝不入库） */
const LOCAL_OWNER_KEY = 'usst.local_owner.v1';

/** 可入库的登记 key（legacy 只迁不写；localOnly 只写本机，两者都不上云） */
export function cloudKeys(): string[] {
  return STORAGE_KEY_LIST.filter((k) => !metaOf(k)?.legacy && !metaOf(k)?.localOnly);
}

/* ---------------- 同步读写（store 存储缝隙调用） ---------------- */

export function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // 隐私模式等场景，回落「没有数据」
  }
}

/** localStorage 保底写 + 异步上云（fire-and-forget） */
export function writeRaw(key: string, raw: string): void {
  try {
    localStorage.setItem(key, raw);
  } catch {
    console.warn(`[persistence] localStorage 写入失败：${key}`);
  }
  void putCloud(key, raw);
}

export function removeRaw(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 同上 */
  }
  void fetch(`/api/db/${encodeURIComponent(key)}`, { method: 'DELETE' }).catch(() => {});
}

async function putCloud(key: string, raw: string): Promise<void> {
  try {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return; // 本地脏数据不搬运
    }
    await fetch(`/api/db/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value, updated_at: Date.now() }),
    });
  } catch {
    /* 离线：静默降级为纯 localStorage 模式 */
  }
}

/* ---------------- 本机缓存归属（换账号隔离，§5.5） ---------------- */

/**
 * 当前 localStorage 缓存归属的账号名。
 * 老用户首次升级到本机制时还没有标记 → 返回 null（由 bootstrap 认领给当前登录账号）。
 */
export function getLocalOwner(): string | null {
  return readRaw(LOCAL_OWNER_KEY);
}

/** 标记本机缓存归属账号。**只写本机**（裸 setItem，不走 writeRaw 的双写 → 不上云）。 */
export function setLocalOwner(username: string): void {
  try {
    localStorage.setItem(LOCAL_OWNER_KEY, username);
  } catch {
    /* 隐私模式：标记写不了，退化为「每次登录都按云端重建」 */
  }
}

/** 清除本机缓存归属标记（注销账号后调用：缓存已清，标记也不该留）。 */
export function clearLocalOwner(): void {
  try {
    localStorage.removeItem(LOCAL_OWNER_KEY);
  } catch {
    /* 同上 */
  }
}

/**
 * 清空本机的**缓存层**数据（只清 localStorage，**绝不碰云端**）。
 * 换账号时用：旧账号的数据安全躺在它自己的云端，本机不留残留。
 *
 * ⚠️ 刻意用裸 `removeItem` 而非 `removeRaw` —— 后者会顺手 `DELETE /api/db/{key}`，
 *    那删的是**上一个账号**的数据（此时会话已是新账号，删的其实是新账号的空行，
 *    但语义上仍是错的：清缓存不该有任何云端副作用）。
 */
export function clearLocalCache(): void {
  for (const key of cloudKeys()) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* 同上 */
    }
  }
}

/**
 * 把本账号云端 kv 拉回本机缓存（只写 localStorage，**不回写云端** —— 免得把刚读到的
 * 快照又原样 PUT 回去）。换账号 / 浏览器档案重置后的重建入口；离线时静默留空。
 */
export async function pullCloudIntoLocal(): Promise<void> {
  let items: { key: string; value: string }[];
  try {
    const res = await fetch('/api/db');
    if (!res.ok) return;
    const data = (await res.json()) as { ok?: boolean; items?: { key: string; value: string }[] };
    if (data.ok !== true || !Array.isArray(data.items)) return;
    items = data.items;
  } catch {
    return; // 离线：留空，等下次 bootstrap 再补
  }
  for (const item of items) {
    if (!cloudKeys().includes(item.key)) continue;
    try {
      localStorage.setItem(item.key, item.value);
    } catch {
      /* 同上 */
    }
  }
}

/**
 * 本机当前是否还留有**可入库**的缓存数据（排除 localOnly 标记）。
 * 用于区分「同账号且本地有数据 → 本地胜」与「同账号但本地已空 → 需从云端拉回」。
 */
function hasLocalCloudData(): boolean {
  return cloudKeys().some((k) => {
    try {
      return localStorage.getItem(k) != null;
    } catch {
      return false;
    }
  });
}

/**
 * 登录成功后把本机缓存「过户」给该账号（§5.5）。
 *
 * 语义：
 *   · 已是同一账号且有数据 → 什么都不做，**本地胜**（保留本机离线期间的新编辑）；
 *   · 已是同一账号但本机已空（标记在、数据被清）→ 从云端拉回 + 重载；
 *   · 不是同一账号（含无标记）→ 清空本机缓存 + 标记新归属 + 按新账号云端重建
 *     （云端为空 = 纯新账号，得到一份干净的初始状态）。
 *
 * 返回 `true` 表示本机缓存被动过（重置或重灌）—— 调用方应**整页重载**：
 * 各 store（life-assistant、userPlan、goals、routine…）都只在启动时读一次
 * localStorage，仅切换 auth 状态不会让它们重新装载，内存里仍是上一个账号的数据。
 */
export async function adoptAccount(username: string): Promise<boolean> {
  if (getLocalOwner() === username) {
    if (hasLocalCloudData()) return false; // 同账号 + 本地有数据：本地胜，无需重载
    await pullCloudIntoLocal(); // 同账号但本地已空：从云端补回
    return true;
  }
  clearLocalCache();
  setLocalOwner(username);
  await pullCloudIntoLocal();
  return true;
}

/* ---------------- 启动回灌（main.tsx 渲染前调一次） ---------------- */

export type SyncStatus = 'cloud-ok' | 'offline' | 'logged-out';

/** 规范化比较：键序无关的深度相等（两边 JSON 语义相同即视为已同步；导出供测试） */
export function jsonSame(a: string, b: string): boolean {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v !== null && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, canon(x)]).sort())
        : v;
  try {
    return JSON.stringify(canon(JSON.parse(a))) === JSON.stringify(canon(JSON.parse(b)));
  } catch {
    return a === b; // 解析不了就比原串
  }
}

/**
 * 渲染前与云端对账一次。结果只影响日志与返回值，**绝不抛错**——
 * 最坏情形（offline）就是回到改造前的纯 localStorage 行为。
 *
 * 2026-10-01 起多一道**归属门**（§5.5）：先确认「我是谁」，本机缓存若明确属于
 * **别的**账号 → 清空后按本账号云端重建。无标记（老用户首次升级）不算别人，
 * 认领给当前账号即可 —— 否则会把老用户自己的数据误清。
 */
export async function bootstrapSync(): Promise<SyncStatus> {
  // 0. 先问「我是谁」—— 归属门需要账号名（/api/db 不回账号名，故单独一问）
  let user: string;
  try {
    const me = await fetch('/api/auth/me');
    if (me.status === 401) return 'logged-out'; // 未登录：换号/合并交给登录页的过户流程
    if (!me.ok) return 'offline';
    const d = (await me.json()) as { ok?: boolean; username?: string };
    if (d.ok !== true || !d.username) return 'offline';
    user = d.username;
  } catch {
    return 'offline';
  }

  // 1. 归属门：本机缓存若明确属于**别的**账号 → 清空（随后按本账号云端重建）。
  //    无标记（owner === null）不在此列：那是老用户首次升级，缓存本就是他自己的。
  const owner = getLocalOwner();
  if (owner !== null && owner !== user) {
    clearLocalCache();
  }
  setLocalOwner(user); // 此后「本地胜」成立（缓存确属本账号）

  // 2. 拉本账号云端
  let items: { key: string; value: string }[];
  try {
    const res = await fetch('/api/db');
    if (res.status === 401) return 'logged-out';
    if (!res.ok) return 'offline';
    const data = (await res.json()) as { ok?: boolean; items?: { key: string; value: string }[] };
    if (data.ok !== true || !Array.isArray(data.items)) return 'offline';
    items = data.items;
  } catch {
    return 'offline';
  }

  const cloudKeysSet = new Set(items.map((i) => i.key));
  let restored = 0;
  let healed = 0;
  let pushed = 0;

  for (const item of items) {
    if (!cloudKeys().includes(item.key)) continue; // 服务端白名单外的残留不碰
    const local = readRaw(item.key);
    if (local == null) {
      // 云端有、本地无：恢复（浏览器档案重置 / 换浏览器首次到达）
      writeRaw(item.key, item.value);
      restored += 1;
    } else if (!jsonSame(local, item.value)) {
      // 本地胜：分歧时保本地（离线期间的新编辑），并回写云端
      writeRaw(item.key, local);
      healed += 1;
    }
  }

  // 本地有、云端无：安全网上云（不该发生，发生了就补）
  for (const key of cloudKeys()) {
    if (cloudKeysSet.has(key)) continue;
    const local = readRaw(key);
    if (local != null) {
      void putCloud(key, local);
      pushed += 1;
    }
  }

  if (restored || healed || pushed) {
    console.info(`[persistence] 云端对账完成：恢复 ${restored} / 抹平 ${healed} / 补传 ${pushed}`);
  }
  return 'cloud-ok';
}
