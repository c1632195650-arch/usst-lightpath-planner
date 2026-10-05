/**
 * 光溯移动端 · 待办 / 目标线协议（新任务三 §5.3 · schemaVer=2）
 * ============================================================
 * 🔴 src/types.ts 零改动（CY 红线）—— Todo/Goal 全部类型放这里。
 * 字段口径以任务书 §5.3 为准（CY 原话落地）：
 *   · recent = 最近待办（打好勾即完成，不填时间）；
 *   · longterm = 中长期待办（勾时必须填完成时间，粗粒度「2026-09-中旬」，防遗忘）；
 *   · 归档而非删除（archived）—— 数组级合并永不丢项的前提。
 * 对任务书的两处显式扩展（台账如实申报）：
 *   · `updatedAt?`：按 id 逐项 LWW 的时间戳（整数组覆盖会丢并发写入，见 server/sync.py）；
 *   · `Todo.archived?`：待办同样走归档语义（完成≠删除，历史留痕给任务二拖延指数）。
 */
export type TodoKind = 'recent' | 'longterm';
export type TodoCompletion = 'done' | 'snoozed' | null;

export interface Todo {
  id: string;
  kind: TodoKind;
  /** ≤120 字 */
  title: string;
  /** 长文本（网页端可补，手机端可空） */
  note?: string;
  tags?: string[];
  createdAt: string;
  /** 逐项 LWW 时间戳（ISO）；缺省退回 createdAt */
  updatedAt?: string;
  /** 🔴 longterm 勾完成时必填（粗粒度：'2026-09-上旬' | '2026-09-中旬' | '2026-09-下旬'） */
  plannedDone?: string;
  /** 实际完成时刻（ISO），供任务二「拖延指数」 */
  actualDoneAt?: string;
  completion: TodoCompletion;
  /** 排程后回填「已被排进哪个块」→ 手机端可显示「已排今天 15:00」 */
  scheduledBlockId?: string;
  goalId?: string;
  /** 归档而非删除 */
  archived?: boolean;
}

export interface GoalMilestone {
  id: string;
  title: string;
  done: boolean;
}

export interface Goal {
  id: string;
  title: string;
  /** 为什么重要（价值观锚定） */
  why?: string;
  /** 目标 → 里程碑 → 待办 三级 */
  milestones?: GoalMilestone[];
  createdAt: string;
  updatedAt?: string;
  archived?: boolean;
}

/** 移动端本地缓存 key（GET 采纳后落地，离线可看；与 localStorage 其它键同前缀口径） */
export const MEMO_CACHE_KEY = 'usst.mobile.memoCache';

/** 逐项 LWW 的时间戳：updatedAt 缺省退回 createdAt；都没有 = 空串（最旧） */
export function todoStamp(t: Pick<Todo, 'updatedAt' | 'createdAt'>): string {
  return t.updatedAt ?? t.createdAt ?? '';
}

/** a 是否严格新于 b：都能解析成时间按时间比；解析不了退回字符串比（同为空 = 相等） */
export function stampNewer(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta > tb;
  if (Number.isFinite(ta)) return a !== '';
  if (Number.isFinite(tb)) return false;
  return a > b;
}

/** mergeById 的公共骨架：remote 先入 → 平局时云端副本胜；同列表内乱序也按逐项比较 */
function mergeById<T extends Todo | Goal>(lists: Array<readonly T[]>): T[] {
  const byId = new Map<string, T>();
  for (const list of lists) {
    for (const item of list) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) continue;
      const cur = byId.get(item.id);
      if (cur === undefined || stampNewer(todoStamp(item), todoStamp(cur))) byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

/**
 * 待办并集合并（按 id 逐项 LWW，两端共用口径，server/sync.py 有同语义实现）：
 *   · 同 id → updatedAt（缺省 createdAt）新者胜；平局 → 云端副本胜（以云端为准）；
 *   · 只在一侧有的 id → 保留（归档语义下「消失」不是删除，是 archived）；
 *   · 无 id / 非 dict 的脏项直接丢弃（前向兼容：毒项不进库）。
 */
export function mergeTodos(local: readonly Todo[], remote: readonly Todo[]): Todo[] {
  return mergeById<Todo>([remote, local]);
}

/** 目标并集合并（语义同 mergeTodos；里程碑作为整项随目标一起 LWW） */
export function mergeGoals(local: readonly Goal[], remote: readonly Goal[]): Goal[] {
  return mergeById<Goal>([remote, local]);
}

/**
 * 完成动作的业务规则（CY 核心：两类待办完成流程必须不同）：
 *   · recent → 打勾即完成，不要求时间；
 *   · longterm → **必须**给 plannedDone（'2026-09-中旬' 粗粒度），未填 → 返回错误不完成；
 *   · actualDoneAt 服务端/调用方注入（ISO）；updatedAt 同步刷新（逐项 LWW 依据）。
 * 返回 { ok:true, todo } 或 { ok:false, reason }，纯函数可单测。
 */
export function completeTodo(t: Todo, opts: {
  nowIso: string;
  plannedDone?: string;
}): { ok: true; todo: Todo } | { ok: false; reason: 'need-planned-done' | 'bad-planned-done' } {
  const nowIso = opts.nowIso;
  if (t.kind === 'longterm') {
    const pd = (opts.plannedDone ?? '').trim();
    if (!pd) return { ok: false, reason: 'need-planned-done' };
    if (!/^\d{4}-\d{2}-(上旬|中旬|下旬)$/.test(pd)) return { ok: false, reason: 'bad-planned-done' };
    return {
      ok: true,
      todo: {
        ...t,
        completion: 'done',
        plannedDone: pd,
        actualDoneAt: nowIso,
        updatedAt: nowIso,
      },
    };
  }
  return { ok: true, todo: { ...t, completion: 'done', actualDoneAt: nowIso, updatedAt: nowIso } };
}

/** 粗粒度完成期 → 人类文案（「2026-09-中旬」→「2026 年 9 月中旬」；解析失败原样返回） */
export function plannedDoneLabel(pd: string): string {
  const m = /^(\d{4})-(\d{2})-(上旬|中旬|下旬)$/.exec(pd ?? '');
  if (!m) return pd;
  const mo = String(Number(m[2]));
  return `${m[1]} 年 ${mo} 月${m[3]}`;
}
