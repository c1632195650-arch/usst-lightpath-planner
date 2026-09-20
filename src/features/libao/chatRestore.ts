/**
 * 聊天跨会话恢复（E8）—— 纯逻辑层
 * ==================================
 * 后端 messages 表一直存着原文，但此前只有 sessionStorage 快照：关标签页即丢
 * （docs/plan-2026-09-21-full.md §一 #14「半实现」）。本模块负责把
 * `GET /api/chat/history` 拉回的历史与本地快照**合并去重**，规则：
 *
 *  · 快照里的消息没有后端 id（是活会话里攒的），历史行有 —— 所以去重不能只按 id；
 *  · 按「角色 + 归一化文本」做**多重集**抵消：同文消息发两次也不会被误删一条；
 *  · 历史行是升序的，快照是其尾部的子集 → 快照没覆盖的更早消息排在快照前面；
 *  · 没有快照（关过标签页）→ 直接用历史重建；历史也为空 → 维持问候语。
 *
 * 纯函数、不碰浏览器 API —— scripts/chatRestore.test.ts 直接测。
 */
import type { ChatHistoryRow } from '@/lib/api';

export interface RestorableMsg {
  role: 'user' | 'lbao';
  text: string;
  /** 后端 messages 自增 id —— 只有从 history 恢复的行才带，本地活会话消息没有 */
  mid?: number;
}

/** 跨会话恢复总开关（2026-09-21 拍板：默认恢复）。关掉 = 旧行为「隔天从干净问候开始」。 */
export const RESTORE_CHAT = true;

/** 后端历史行 → 消息（role 收敛到前端两值；未知角色丢弃） */
export function historyToMsgs(rows: ChatHistoryRow[]): RestorableMsg[] {
  return rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r) => ({
      role: r.role === 'user' ? 'user' as const : 'lbao' as const,
      text: r.content ?? '',
      mid: r.id,
    }));
}

/** 去重键：角色 + 去掉全部空白后的文本（中文空格无语义；两边文本同源于落库原文） */
function tag(role: string, text: string): string {
  return `${role}|${(text ?? '').replace(/\s+/g, '')}`;
}

/** 历史行合并进现有消息：多重集去重，快照没覆盖的更早消息排前面。 */
export function mergeHistory(existing: RestorableMsg[], rows: ChatHistoryRow[]): RestorableMsg[] {
  const counts = new Map<string, number>();
  for (const m of existing) {
    const t = tag(m.role, m.text);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const kept: RestorableMsg[] = [];
  for (const r of rows) {
    const role = r.role === 'user' ? 'user' as const : 'lbao' as const;
    const t = tag(role, r.content ?? '');
    const left = counts.get(t) ?? 0;
    if (left > 0) {
      counts.set(t, left - 1);   // 快照里已有这条 —— 同文重复按条数抵消，不多删
      continue;
    }
    kept.push({ role, text: r.content ?? '', mid: r.id });
  }
  return [...kept, ...existing];
}

/**
 * 恢复入口（挂载时调一次）：
 *  · 有本地快照 → 快照 + 历史合并去重；
 *  · 无快照（关过标签页）→ 历史重建；
 *  · 历史也为空 / 总开关关闭 → null（调用方维持现有消息，通常是问候语）。
 */
export function restoredMessages(
  existing: RestorableMsg[] | null,
  rows: ChatHistoryRow[],
): RestorableMsg[] | null {
  if (!RESTORE_CHAT) return null;
  if (!rows || rows.length === 0) return null;
  if (existing && existing.length > 0) return mergeHistory(existing, rows);
  return historyToMsgs(rows);
}
