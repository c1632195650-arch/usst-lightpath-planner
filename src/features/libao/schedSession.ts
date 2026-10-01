/**
 * 梨宝 · 排程会话状态机（纯函数层，S 批 S2）
 * ============================================================
 *
 * ── 为什么要有显式状态机（P4 的病根）──────────────────────────
 * 此前每条消息都要过 `looksLikeAction` 关键词闸门 —— 「理解用户动机」
 * 这个不可靠环节被放在了主干上：闸门漏判一句，整句就掉进 RAG 问答。
 * S 批把它翻转：**一旦进入排程会话（collect），消息先当「会话的回应」处理**，
 * 不再逐句判动机；只有显式退出 / 连续两轮无关才离开会话。
 *
 * 状态图（§3.1）：
 *   idle ──(动作句出草稿前需追问/挑块/hold缺when)──▶ collect
 *   collect ──(补齐→草稿卡 pending)──▶ idle
 *   collect ──(显式退出词)──▶ idle
 *   collect ──(连续 MISS_LIMIT 轮完全无关)──▶ idle（作废前先说一句，不静默）
 *
 * 本文件只放**可确定性测试的纯逻辑**（退出词表、missStreak 判定）；
 * 状态迁移的接线在 `LbaoChat.tsx`（React 侧，靠 E2E 走查守）。
 */

export type SchedMode = 'idle' | 'collect' | 'draft' | 'blocked';

/**
 * 显式退出词。collect 态下用户说这些 = 不要再追问了。
 * ⚠️ 匹配口径刻意**收紧为归一后整句相等**（见 `isExitCommand`）：
 *    「算了」做子串匹配会误伤「算了一下这周忙不忙」这类句子。
 */
export const SCHED_EXIT_WORDS = [
  '退出排程',
  '退出',
  '取消排程',
  '不排了',
  '先不排',
  '不排',
  '别排了',
  '不安排了',
  '不弄了',
  '算了',
  '那算了',
  '算了算了',
  '就先这样',
] as const;

/** 退出短语的最长长度 —— 超过它的句子哪怕含退出词也不算退出（防误伤长句） */
const EXIT_MAX_LEN = 8;

/** 归一：去空白；去掉句尾语气词（吧/呀/啊/呢/嘛/了/哦/哈），让「不排了吧」「算了吧」都能命中。 */
export function normalizeExitPhrase(q: string): string {
  return (q || '').replace(/\s+/g, '').replace(/[吧呀啊呢嘛哦哈]+$/, '');
}

/** collect 态下这句话是不是显式退出。纯函数，RV 锚点：删词表或放宽为子串匹配都会红。 */
export function isExitCommand(q: string): boolean {
  const s = normalizeExitPhrase(q);
  if (!s || s.length > EXIT_MAX_LEN) return false;
  return (SCHED_EXIT_WORDS as readonly string[]).includes(s);
}

/**
 * 连续「完全无关」轮数的上限 —— 到顶就作废会话（作废前先说明，不静默）。
 * 1 = 一句无关就打断（太脆，用户随口一问就丢排程进度）；
 * 2 = 给一次「折返」机会（CY 诉求：追问中插话后想回来）。
 */
export const MISS_STREAK_LIMIT = 2;

/**
 * 无关轮数推进：算回应（contributed）→ 清零；完全无关 → +1。
 * 纯函数。RV 锚点：删「算回应清零」→ 折返剧本红（说了一句无关后再答，
 * 一轮就到上限被作废）；删「无关 +1」→ 永不过期，无关剧本红。
 */
export function nextMissStreak(current: number, contributed: boolean): number {
  return contributed ? 0 : current + 1;
}

/** 是否达到作废线。 */
export function shouldExpireSession(missStreak: number): boolean {
  return missStreak >= MISS_STREAK_LIMIT;
}

/** 退出回执话术（collect 态显式退出后梨宝说的一句）。 */
export const EXIT_ACK = '好，先不排了，要排再叫我。';

/** 折返回执话术前缀（无关第 1 轮：保留会话 + 提醒当前还差什么）。 */
export const HOLD_ON_PREFIX = '这条我先记下。咱们先把刚才的事定完，还差：';

/** 作废说明话术（无关第 2 轮：会话作废，但说清楚，不静默）。 */
export const EXPIRE_NOTE = '连着两轮没对上，这次排程先放下了 —— 想接着排随时再叫我。';
