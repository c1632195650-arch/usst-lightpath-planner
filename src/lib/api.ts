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
  /* 后端一直在返回、此前没声明 → 调试时看不到「这条到底多相关」。 */
  /** 归一化排序分（top1 恒接近 1.0，**不能**用来判相关性） */
  score?: number;
  /** 未归一化余弦绝对值 —— 判「知识库到底有没有」看这个（阈值 0.68 / 0.56） */
  raw_vec?: number;
}

export interface ChatResult {
  answer: string;
  mode: 'llm' | 'extractive' | 'empty';
  sources: RagSource[];
  /* ---- 以下字段后端 /api/chat 一直在返回，此前这里没声明 → 调试信号全丢。
     不是「新增能力」，只是把已经算出来的东西如实声明出来。 ---- */
  /** 路由判定：llm / hybrid / extractive / empty（决定这轮走合成还是抽取） */
  route?: string;
  /** 意图标签（后端 classify_intent 的产物） */
  intent?: string;
  /** 检索最高原始向量相似度 —— 边界外判定的信号源，排查「为什么答不上来」看它 */
  top_raw_vec?: number;
  /** 本轮是否注入了校园空间上下文（食堂/问路等） */
  used_space?: boolean;
  /** 本轮是否读到了记忆（长期画像 / 增量摘要 / 最近原话） */
  used_memory?: boolean;
  /** 本轮是否带上了用户档案摘要（前端 profileCtx） */
  used_profile?: boolean;
  /* ---- 方法库 / 健康库命中信号（2026-09-22 补齐）----
     后端两个库一直在检索与注入，但响应字段在三树合流时丢了 → 前端无从观测
     「这轮答的是不是方法库/健康库」。这里如实声明出来，不做任何加工。 */
  /** 本轮是否命中方法库（学习方法 / 备考 / 元能力类条目） */
  used_study?: boolean;
  /** 方法库自己的检索最高原始向量 —— ⚠️ 与 top_raw_vec 分属两套门限（0.60/0.50），别混用 */
  study_top_raw?: number;
  /** 方法库命中条目标题（最多 3 条） */
  study_sources?: string[];
  /** 是否命中伪科学纠正口径（True 时回答含确定性纠正文案，study_sources 必为空） */
  study_pseudo?: boolean;
  /** 本轮是否命中健康库 */
  used_health?: boolean;
  /** 健康护栏等级：urgent/diagnosis/myth = 阻断（只给口径）｜consult = 提示｜ok */
  health_level?: 'urgent' | 'diagnosis' | 'myth' | 'consult' | 'ok';
  /** 健康库检索最高原始向量 */
  health_top_raw?: number;
  /** 健康库命中条目标题（阻断级时为空 —— 口径不走检索） */
  health_sources?: string[];
  /** 本轮请求 id —— 与后端 `LIBAO_DEBUG=1` 打的 trace 行对齐用 */
  request_id?: string;
  /** 后端侧耗时（毫秒，含检索 + 空间 + 记忆 + LLM） */
  elapsed_ms?: number;
  /** 客观事实待确认（年级/学院/专业）—— 前端据此出建议卡，用户点头才进画像 */
  memory_proposals?: MemoryFact[];
  /** 已自动生效的偏好 —— 前端据此出可撤销提示 */
  memory_applied?: MemoryFact[];
}

/* ---------------- 记忆面板（M2/M3） ----------------
 * 事实分两类走两条路（CY 2026-09-20 拍板）：
 *   · objective 客观事实（年级/学院/专业）→ 只提议，用户确认才生效；
 *   · preference 偏好（薄弱项/口味/课程）→ 自动生效，可撤销；全部可删。 */
export type FactKind = 'objective' | 'preference';
export type FactStatus = 'pending' | 'applied' | 'rejected';

export interface MemoryFact {
  id: number;
  kind: FactKind;
  /** grade / college / major / weak.<项> / preferences.<标签> / course.<课名> */
  key: string;
  value: string;
  status: FactStatus;
  /** 提取来源原话片段（≤80 字），给面板里「我为什么会记得这个」一个交代 */
  source?: string;
}

export function memoryFacts(userId: string, status: '' | FactStatus = ''): Promise<{ facts: MemoryFact[] }> {
  const s = status ? `&status=${status}` : '';
  return get(`/api/memory/facts?user_id=${encodeURIComponent(userId)}${s}`);
}

export function decideFact(userId: string, id: number, action: 'confirm' | 'reject' | 'undo'): Promise<{ ok: boolean; fact: MemoryFact | null }> {
  return post(`/api/memory/facts/${id}/${action}`, { user_id: userId });
}

export function deleteFact(userId: string, id: number): Promise<{ ok: boolean }> {
  return del(`/api/memory/facts/${id}?user_id=${encodeURIComponent(userId)}`);
}

/* ---------------- 跨会话恢复（E8） ----------------
 * 后端一直在存 messages，但此前没有读取端点 —— 关掉标签页聊天记录就没了。
 * 现在挂载时拉一次 history，与本地快照合并去重（逻辑在 features/libao/chatRestore.ts）。 */

export interface ChatHistoryRow {
  /** 后端 messages 自增 id —— 合并去重的依据 */
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

/** 某会话最近 N 条消息（升序）。后端不可用 / 没有记录时返回空数组。 */
export function chatHistory(identity: ChatIdentity = {}, limit = 50): Promise<{ messages: ChatHistoryRow[] }> {
  const uid = identity.userId ? `&user_id=${encodeURIComponent(identity.userId)}` : '';
  const sid = identity.sessionId ? `&session_id=${encodeURIComponent(identity.sessionId)}` : '';
  return get(`/api/chat/history?limit=${limit}${uid}${sid}`);
}

/** 清空对话与记忆：删该会话的全部原文/摘要，并抹掉该设备的画像与事实。
 *  与后端 /api/memory/reset 同一套语义 —— 「清空」是破坏性操作，UI 上要如实告知范围。 */
export function resetMemory(identity: ChatIdentity = {}): Promise<{ ok: boolean }> {
  return post('/api/memory/reset', {
    session_id: identity.sessionId ?? 'default',
    user_id: identity.userId ?? 'anon',
  });
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

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/* ---------------- 对话身份（记忆层的前置条件） ---------------- */

/**
 * `user_id` 与 `session_id` 是两个不同的概念，必须分开传：
 *   - `user_id`   设备级、持久、跨会话 —— 决定「长期画像」能否跨会话累积；
 *   - `session_id` 会话级、可重置      —— 决定「最近原话」的窗口范围。
 * 合并成一个会让「跨会话的画像」和「本次会话的上下文」互相污染。
 */
export interface ChatIdentity {
  userId?: string;
  sessionId?: string;
}

/** 梨宝问答。
 *  @param identity   对话身份。不传则后端落回 `default`/`anon` —— 记忆层不会生效。
 *  @param profileCtx 用户档案摘要（画像轴值 + 课表概览 + 学期阶段），
 *                    由 `features/libao/` 侧生成；后端会将其作为独立段落注入 system prompt，
 *                    使回答建立在「你是谁」之上，而不是一个匿名提问者。
 */
export function lbaoChat(
  q: string,
  identity: ChatIdentity = {},
  profileCtx = '',
  /** WP12-H8：最近日程变动（userPlanStore ring buffer），后端 summarize 后注入 prompt */
  recentPlanEvents?: Array<{ type: string; title: string; ts: number }>,
): Promise<ChatResult> {
  // 值为 undefined 时 JSON.stringify 会省略该键 → 后端沿用自身默认值，天然向后兼容
  return post<ChatResult>('/api/chat', {
    q,
    user_id: identity.userId,
    session_id: identity.sessionId,
    profile_ctx: profileCtx || undefined,
    recent_plan_events: recentPlanEvents?.length ? recentPlanEvents : undefined,
  });
}

/** WP12-C2：课表事实回写 —— 纯统计摘要，无任何坐标（数据红线）；失败由调用方静默。 */
export async function addTimetableFacts(
  schedule: { courses?: Array<{ slots?: Array<{ startPeriod?: number }> }> },
  userId: string,
): Promise<{ ok: boolean }> {
  const courses = schedule.courses ?? [];
  if (courses.length === 0) return { ok: false };
  let slots = 0;
  let evening = 0;
  for (const c of courses) {
    for (const slot of c.slots ?? []) {
      slots += 1;
      if (periodStartMin(slot.startPeriod ?? 1) >= 18 * 60) evening += 1; // 晚间课 ≥18:00
    }
  }
  if (slots === 0) return { ok: false };
  const pct = Math.round((evening / slots) * 100);
  const content = ['课表共', courses.length, '门课，每周约', slots, '节，晚间课(≥18:00)占比', pct + '%'].join(' ');
  return post<{ ok: boolean }>('/api/memory/facts', {
    user_id: userId || 'anon',
    content,
  });
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

/* ---------------- S 批 S3：排程理解（LLM 听懂，规则兜底在前端） ----------------
 * server/plan_dialog.py 的 /api/plan/understand。契约与该文件 docstring 一致：
 * HTTP 恒 200，LLM 不可用/超时/解析坏一律 { ok:false, reason } —— 前端视作
 * 「走规则兜底」，不算错误、不弹提示（纪律①：规则优先，LLM 只补空）。 */

export interface PlanSlotPatch {
  title?: string;
  when_text?: string;
  month?: number;
  day?: number;
  relativeDays?: number;
  relativeWeeks?: number;
  /** 相对月锚（批 1.3）：本月=0、下月=1；「下月底」= relativeMonths 1 + 原话佐证 */
  relativeMonths?: number;
  weekday?: number;
  /** 学期周次（批 1.2）：「第10周周五」→ weekNo=10；换算成日期由前端按 termStart 做 */
  weekNo?: number;
  perWeekCount?: number;
  durationMin?: number;
  totalHours?: number;
  place?: string;
  window_text?: string;
  /** 钟点起止（批次 1 · 4.1）：「6点到8点」= startMin 1080 / endMin 1200；
   *  单端点（「打到8点」）只给 endMin。前端拼成 IntentSlots.clock。 */
  startMin?: number;
  endMin?: number;
  targetHint?: string;
}

export interface PlanUnderstandResult {
  ok: boolean;
  reason?: string;
  /** scene=intent：这句话是否要动日程 */
  action?: boolean;
  intent?: 'create' | 'replace' | 'reschedule' | 'cancel' | 'query' | 'add_deadline' | 'hold';
  patch?: PlanSlotPatch;
  /** scene=answer：槽位 → 原话片段（LLM 只做定位，结构化仍在规则层） */
  answers?: Record<string, string>;
  /** scene=dialog（D 批 D2）：对话管理器的动作裁决 */
  act?: string;
  args?: {
    slot?: string;
    candidate_idx?: number;
    target_text?: string;
    pick_kind?: 'cancel' | 'reschedule' | 'replace';
    option?: 'swap_block' | 'move_next_week' | 'reduce_scope' | 'give_time';
    intent?: PlanUnderstandResult['intent'];
    /** D7：用户选中的协商方案 id（blocking.options 照抄） */
    replan_id?: string;
    patch?: PlanSlotPatch;
  };
  /** 对话管理器的一句话说明（≤80 字，梨宝口吻） */
  reply_note?: string;
  confidence?: number;
  elapsed_ms?: number;
}

/** dialog 场景递给后端的对话状态（前端已做白名单序列化，后端再兜一层 ≤4KB） */
export interface PlanDialogState {
  topic: Record<string, unknown> | null;
  missStreak: number;
}

/**
 * 排程理解。带 9s 客户端超时（服务端 8s + 1s 余量）—— 后端挂了也不能让
 * 用户干等：超时同样落 { ok:false }，前端走规则兜底。
 */
export async function planUnderstand(body: {
  scene: 'intent' | 'answer' | 'dialog';
  q: string;
  /** scene=answer：已问槽位清单，"slot: 话术原文" 形式 */
  asked?: string[];
  /** scene=intent：规则层已抽到的槽位（LLM 只补空） */
  slots?: Record<string, unknown>;
  today?: string;
  /** 最近 ≤4 条「角色:文本」，防指代断裂 */
  history?: string[];
  /** scene=dialog：对话管理器状态（topic 白名单序列化 + missStreak） */
  state?: PlanDialogState;
}): Promise<PlanUnderstandResult> {
  // 批 1.5：intent 场景**单次重试** —— 服务端 8s LLM 超时在慢网络下成片出现
  // （2026-10-02 评测实录 25/67 次 ok:false），整句掉回规则层后，规则接不住的
  // 动作句会被漏判。对话是异步的，多等一轮 9s 优于整句丢失；answer/dialog
  // 各有兜底链，维持单次。只对「超时类 ok:false」与网络异常重试——no_key 这类
  // 重试也不会好的直接返回。
  const maxAttempts = body.scene === 'intent' ? 2 : 1;
  let lastResult: PlanUnderstandResult = { ok: false, reason: 'unknown' };
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const isLast = attempt === maxAttempts - 1;
    try {
      const res = await fetch(`${API_BASE}/api/plan/understand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
      const j = (await res.json()) as PlanUnderstandResult;
      const timeoutLike = typeof j.reason === 'string' && /timeout|timed?\s*out|超时/i.test(j.reason);
      if (j.ok || isLast || !timeoutLike) return j;
      lastResult = j;
    } catch (e) {
      lastResult = { ok: false, reason: e instanceof Error ? e.message : 'network' };
      if (isLast) return lastResult;
    }
  }
  return lastResult;
}import { periodStartMin } from '@/constants/time';

