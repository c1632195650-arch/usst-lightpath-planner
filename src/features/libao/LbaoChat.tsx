import { useEffect, useMemo, useRef, useState } from 'react';
import type { PersonaProfile, Schedule } from '@/types';
import type { UserTask } from '@/lib/planner/templates';
import { currentWeekNo, todayISO } from '@/lib/date';
import { lbaoChat, lbaoHealth, decideFact, type ChatResult, type MemoryFact, type RagSource } from '@/lib/api';
import { applyObjectiveFact, basicInfoContext, getUserId, objectiveKeyToField } from '@/lib/identity';
import { track } from '@/lib/telemetry';
import { buildProfileContext } from '@/features/libao/profileContext';
import { applyClarifyAnswer, parseGoalIntent, describeSlots, topQuestions, type IntentSlots } from '@/features/libao/libaoIntent';
import {
  checkGoalFeasibility,
  describeVerdict,
  goalToTasks,
  planWeekForChat,
  summarizeWeekPlan,
} from '@/features/libao/weekPlanForChat';
import { addTask, loadUserPlan, pushUndoSnapshot, saveUserPlan } from '@/features/week/userPlanStore';
import { ChatDebug } from '@/features/libao/ChatDebug';
import { MemoryPanel, factLabel } from '@/features/libao/MemoryPanel';

/** DEV 专用：把「已经拿回来、但一直没人看」的检索与路由信号显示出来。
 *  `import.meta.env.DEV` 在生产构建里是字面量 false → 整段被摇掉，线上零变化。 */
const SHOW_DEBUG = import.meta.env.DEV;

interface Msg {
  role: 'user' | 'lbao';
  text: string;
  sources?: RagSource[];
  mode?: string;
  /** 排程要点。来自**真引擎**（与「周计划」页同源），不是模板 —— 见 weekPlanForChat.ts */
  planPoints?: string[];
  /** 提示去哪儿看完整时间轴 */
  goWeek?: boolean;
  needProfile?: boolean;
  /** 后端这一轮的完整元数据（route / intent / top_raw_vec / used_* / 耗时）。
   *  只用于 DEV 调试抽屉 —— 见本目录 ChatDebug.tsx 的说明。 */
  debug?: ChatResult;
  /** 目标草稿卡的确认键 —— 有值且 `pending` 里还有对应草稿时，渲染「就这么排」按钮。
   *  确认前**什么都不写入**：草稿只是草稿，执行权在用户手里（core §4 L4）。 */
  goalAsk?: number;
  /** 记忆建议卡（M2）：客观事实待确认 —— 用户点头才进画像与基础信息 */
  proposals?: MemoryFact[];
  /** 已自动生效的偏好（M2）：出可撤销提示 */
  applied?: MemoryFact[];
}

/** 一份等用户确认的目标草稿（确认后才落 `userPlanStore`）。 */
interface PendingGoal {
  title: string;
  tasks: UserTask[];
  /** 候选块真正落在的教学周（可能是一段区间，如 5–8 周） */
  weeks: number[];
}

/** 周列表 → 人话（[4] → 「第 4 周」；[5,6,7,8] → 「第 5–8 周」） */
function weeksLabel(weeks: number[]): string {
  if (weeks.length === 0) return '本期';
  if (weeks.length === 1) return `第 ${weeks[0]} 周`;
  return `第 ${weeks[0]}–${weeks[weeks.length - 1]} 周`;
}

/** 常见问法，避免第一次进入对话没有入口。 */
const QUICK = ['四六级什么时候报名', '帮我安排这周', '我要报名数学建模，帮我规划备赛', '这学期放假安排'];

/** 对话初始说明，明确问答与排程两个能力。 */
const GREETING =
  '我是梨宝，咱上理的校园助手。可以问四六级、选课、放假等校园问题；也可以说「帮我安排这周」，'
  + '或者直接说要做什么（比如「我要报名数学建模，九月中旬比赛，帮我规划备赛」）——'
  + '我会先排一版草稿给你确认，你不点头我不动日程。';

/* ---------------- 对话身份 ----------------
 * 后端 `/api/chat` 早就接受 `session_id` / `user_id`，但前端此前**只发一个问题字符串**，
 * 后端只好落回 `default` / `anon` —— 结果三层记忆在前端链路上完全空转，
 * 且所有用户共用同一份画像（演示时连着问两轮不同身份就会串味）。
 * 补上身份，是让那套已经写好的记忆层真正生效的唯一前置条件。
 */

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* 老浏览器 / 非安全上下文没有 randomUUID，走下面的兜底 */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 会话级标识：存 sessionStorage，关掉标签页即失效 —— 对应后端「最近原话」的窗口。
 *  与 user_id **刻意分开**：合成一个会让「跨会话的画像」和「本次会话的上下文」互相污染。
 *  （user_id 的取值已收敛到 `@/lib/identity` 的 `getUserId()` —— 单一来源，
 *   将来换登录/同步方案只改那一处。） */
function currentSessionId(): string {
  const KEY = 'usst.libao.session_id';
  try {
    const saved = sessionStorage.getItem(KEY);
    if (saved) return saved;
    const id = `s-${newId()}`;
    sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    return 'default';
  }
}

/** 将本地排程建议和校园资料问答放进同一段对话，而不混用两种数据来源。 */
export function LbaoChat({ profile, schedule, onGoProfile }: {
  profile: PersonaProfile | null;
  schedule: Schedule;
  onGoProfile?: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([{ role: 'lbao', text: GREETING }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  /** 待确认的目标草稿。键是消息下标递增号 —— 确认前不写任何状态。 */
  const [pending, setPending] = useState<Record<number, PendingGoal>>({});
  const pendingSeq = useRef(0);

  /** 追问接续态：needs_clarification 时把**半成品槽位**存这里，下一句话先当
   *  「追问的回应」尝试解析（applyClarifyAnswer），补齐了就继续出草稿。
   *  没有它，用户的回答会被当成全新消息重新分流 ——「每周 3 次、每次 2 小时」
   *  不是动作句 → 掉进 RAG 问答（2026-09-20 真实使用翻车的根因）。 */
  const [clarifySlots, setClarifySlots] = useState<IntentSlots | null>(null);

  // 身份在首次渲染时确定一次，之后整个会话稳定不变（惰性初始化，避免每次渲染重读 storage）
  const [identity] = useState(() => ({
    userId: getUserId(),
    sessionId: currentSessionId(),
  }));

  /** 记忆面板开关（M3） */
  const [memoryOpen, setMemoryOpen] = useState(false);

  /** 用户档案摘要：画像轴值 + 本周课表 + 学期阶段 + 基础信息（M1）。
   *  每轮随请求发出，但只在 profile / schedule 变化时重算 —— 后端会把它注入 system prompt，
   *  这是「梨宝知道你是谁」这件事的全部数据来源。 */
  const profileCtx = useMemo(
    () => [buildProfileContext(profile, schedule), basicInfoContext()]
      .filter(Boolean).join('\n\n'),
    [profile, schedule],
  );

  /** 首次进入时只探测资料服务状态，不影响本地排程能力。 */
  useEffect(() => {
    lbaoHealth()
      .then((health) => setOnline(health.ok))
      .catch(() => setOnline(false));
  }, []);

  /** 对话追加后保持新消息可见，滚动仍只属于消息区域。 */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  /** 确认草稿：这一步才是**唯一**写日程的地方。
   *  写之前压一份 undo 快照（与周计划页同一套机制），排错了能一键反悔。 */
  const confirmGoal = (key: number) => {
    const g = pending[key];
    if (!g || g.tasks.length === 0) return;
    try {
      const layer = loadUserPlan();
      pushUndoSnapshot(layer);
      const tasks = g.tasks.reduce((acc, t) => addTask(acc, t), layer.tasks);
      saveUserPlan({ ...layer, tasks });
      setPending((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
      setMessages((current) => [...current, {
        role: 'lbao',
        text: `好，「${g.title}」写进${weeksLabel(g.weeks)}的日程了，共 ${g.tasks.length} 个块。去周计划看全貌；排得不合适可以撤销（↩），也可以直接跟我说改。`,
        goWeek: true,
      }]);
      track('plan_result', { ok: true, ms: 0, n: g.tasks.length });
    } catch {
      track('degrade', { id: 'goal-save-error' });
      setMessages((current) => [...current, {
        role: 'lbao',
        text: '写入日程的时候出了点小状况，没写成。草稿还在上面，你可以再点一次，或去周计划手动加。',
      }]);
    }
  };

  /** 记忆卡操作（M2）：confirm / reject / undo —— 只作用于用户点到的那一条。
   *  客观事实确认后同步写进本地基础信息（AI 只提议、用户拍板的最后一公里）。 */
  const handleFact = async (msgIndex: number, fact: MemoryFact, action: 'confirm' | 'reject' | 'undo') => {
    try {
      await decideFact(identity.userId, fact.id, action);
      if (action === 'confirm' && objectiveKeyToField(fact.key)) {
        applyObjectiveFact(fact.key, fact.value);
      }
    } catch {
      return; // 服务挂了：卡片留在原地，用户可重试
    }
    setMessages((current) => current.map((m, i) => (i === msgIndex ? {
      ...m,
      proposals: m.proposals?.filter((f) => f.id !== fact.id),
      applied: m.applied?.filter((f) => f.id !== fact.id),
    } : m)));
  };

  /** 目标槽位 → 干跑把关 → 追问 / 草稿 / 冲突说明。
   *  「新句子抽出的槽位」与「追问接续补齐的槽位」共用这一条通路 ——
   *  两口各写一份必然漂移（同 checkGoalFeasibility 是唯一完备性判定的道理）。 */
  const runGoalSlots = async (slots: IntentSlots, today: string) => {
    const t0 = Date.now();
    try {
      // 干跑把关：能不能排，由**引擎**说了算，不由 LLM 的嘴说了算。
      // （不传 weekNo —— 干跑按候选块**真正落在的周**逐周跑，见 checkGoalFeasibility。）
      const verdict = checkGoalFeasibility({ slots, schedule, profile, today });
      track('plan_result', { ok: true, ms: Date.now() - t0 });

      const lines = [...describeSlots(slots), ...describeVerdict(verdict)];

      if (verdict.kind === 'needs_clarification') {
        // 信息不全 → 只追问，绝不动手。猜一个排进去，比慢一轮更糟。
        // 半成品槽位存起来 —— 用户的下一句话是「答案」，不是新消息（追问接续）。
        setClarifySlots(slots);
        setMessages((current) => [...current, {
          role: 'lbao',
          text: `想把「${slots.title}」排进日程，我还得问两句：`,
          planPoints: verdict.questions,
        }]);
        setLoading(false);
        return;
      }

      // 走到这就不再等答案了：出草稿或说清冲突，都算「这轮问完了」。
      setClarifySlots(null);

      if (verdict.kind === 'ok' || verdict.kind === 'tight') {
        // 排得下 → 出草稿，**等确认**。这是 L4 边界：梨宝不替用户拍板。
        // 窗口常跨多周 —— 落盘的周从任务本身取，不假设是「当前周」。
        const goalTasks = goalToTasks(slots, schedule, today);
        const weeks = [...new Set(goalTasks.map((t) => t.weeks?.[0]).filter((w): w is number => Number.isFinite(w)))].sort((a, b) => a - b);
        const key = (pendingSeq.current += 1);
        setPending((p) => ({ ...p, [key]: {
          title: slots.title,
          tasks: goalTasks,
          weeks,
        } }));
        setMessages((current) => [...current, {
          role: 'lbao',
          text: verdict.kind === 'ok'
            ? `「${slots.title}」我排了一版草稿（还没写进日程）：`
            : `「${slots.title}」排得下，但会紧一点。草稿在这（还没写进日程）：`,
          planPoints: lines,
          goalAsk: key,
          goWeek: true,
        }]);
        setLoading(false);
        return;
      }

      // conflict / infeasible → 说清楚卡在哪 + 给选项，**不出确认按钮**
      setMessages((current) => [...current, {
        role: 'lbao',
        text: verdict.kind === 'conflict'
          ? `「${slots.title}」这么排会撞车：`
          : `「${slots.title}」我排不进去：`,
        planPoints: lines,
        goWeek: true,
      }]);
    } catch {
      track('degrade', { id: 'goal-engine-error' });
      setClarifySlots(null);
      setMessages((current) => [...current, {
        role: 'lbao',
        text: '排的时候出了点小状况，这次没排出来。完整时间轴在「周计划」里，可以先看着。',
        goWeek: true,
      }]);
    }
    setLoading(false);
  };

  /** 发送提问；排程意图在本地处理，其余交给校园资料问答。
   *
   *  埋点（`@/lib/telemetry`）只记**数字与枚举**，且只落本机：
   *  这里记得到的是「这一次排程/检索花了多久、成没成、召回了几条、哪条链路降级了」，
   *  记不到的（也刻意不记）是用户问了什么 —— 守 NF-2「个人数据本地优先」。 */
  const send = async (raw?: string) => {
    const q = (raw ?? input).trim();
    if (!q || loading) return;
    setInput('');
    setMessages((current) => [...current, { role: 'user', text: q }]);
    setLoading(true);

    /** 意图分流（`libaoIntent.ts`，规则优先、可测试）：
     *  · 说得出**名字**的事 → 目标草稿路径（干跑把关 → 用户确认 → 落盘）；
     *  · 泛泛的「安排/规划一下」（没有对象）→ 维持老行为：给这一周的建议；
     *  · 都不是 → RAG 问答。
     *  老的 `isRecommendIntent` 已被 `looksLikeAction` 取代 —— 后者是它的
     *  **超集**，且有专门的超集测试守着（scripts/libaoIntent.test.ts）。 */
    const today = todayISO();

    // ── 追问接续：上一条梨宝消息在等答案 → 这句先当「回应」解析 ──
    // 「每周 3 次、每次 2 小时」单独看不是动作句，looksLikeAction 判 false 是对的；
    // 没有这段，答案就会掉进 RAG 问答被记忆层带偏（2026-09-20 真实翻车）。
    if (clarifySlots) {
      const merged = applyClarifyAnswer(q, clarifySlots, today);
      if (merged.contributed) {
        if (merged.slots.missing.length > 0) {
          // 补了一半（比如只给了单次时长没给次数）→ 存档，继续追问剩下的
          setClarifySlots(merged.slots);
          setMessages((current) => [...current, {
            role: 'lbao',
            text: '还差一点：',
            planPoints: topQuestions(merged.slots),
          }]);
          setLoading(false);
          return;
        }
        // 补齐了 → 带着完整槽位走同一条干跑通路
        setClarifySlots(null);
        await runGoalSlots(merged.slots, today);
        return;
      }
      // 答非所问 → 按普通消息分流；若命中新目标，旧追问自然作废
      setClarifySlots(null);
    }

    const outcome = await parseGoalIntent(q, { today });

    if (outcome.action && outcome.slots.title) {
      await runGoalSlots(outcome.slots, today);
      return;
    }

    if (outcome.action) {
      /** 泛泛的「帮我安排这周」→ 老路径（一周建议）。
       *  这里维持原样，是因为用户没点名任何一件具体的事 ——
       *  追问「你要排什么」反而答非所问。 */
      if (!profile && schedule.courses.length === 0) {
        track('degrade', { id: 'plan-no-input' });
        setMessages((current) => [...current, {
          role: 'lbao',
          text: '我还不了解你的作息偏好，也还没看到你的课表。完成画像或导入课表后，我就能按你的实际情况安排这一周。',
          needProfile: true,
        }]);
        setLoading(false);
        return;
      }

      const weekNo = currentWeekNo(schedule.termStart);
      const t0 = Date.now();
      try {
        const plan = await planWeekForChat(schedule, profile, weekNo);
        track('plan_result', { ok: !!plan, ms: Date.now() - t0 });
        setMessages((current) => [...current, plan ? {
          role: 'lbao',
          text: `第 ${weekNo} 周我按你的课表排了一版，你懂我意思吧：`,
          planPoints: summarizeWeekPlan(plan),
          goWeek: true,
        } : {
          // 引擎排不了（该周不在学期范围）→ 直说，不编造日程
          role: 'lbao',
          text: '这一周不在本学期的范围里，我排不出来。换一周再问我，或者直接去「周计划」翻翻看。',
          goWeek: true,
        }]);
      } catch {
        // 引擎异常 → 诚实说明。**绝不用模板兜底**，那正是我们要消灭的东西。
        track('degrade', { id: 'plan-engine-error' });
        setMessages((current) => [...current, {
          role: 'lbao',
          text: '排的时候出了点小状况，这次没排出来。完整时间轴在「周计划」里，可以先看着。',
          goWeek: true,
        }]);
      }
      setLoading(false);
      return;
    }

    /** 问答意图经过后端检索；服务不可用时保留当前对话并给出恢复方式。 */
    const t1 = Date.now();
    try {
      // 带上身份与档案：前者让后端记忆层生效，后者让回答建立在「你是谁」之上
      const response = await lbaoChat(q, identity, profileCtx);
      // `n` = 召回到的资料来源条数：0 条就是「白问了一次」，是召回质量最直接的信号
      track('search', { ok: true, ms: Date.now() - t1, n: response.sources?.length ?? 0 });
      setMessages((current) => [...current, {
        role: 'lbao', text: response.answer, sources: response.sources,
        mode: response.mode,
        // 后端本来就把 route/intent/top_raw_vec/used_* 一起返回了，此前只取
        // answer/sources/mode，其余当场丢掉 —— 于是「答得不对」时没有第二手信息。
        // 整包存下来给 DEV 调试抽屉，生产构建不渲染。
        debug: response,
        // 记忆回写（M2）：客观事实出建议卡等确认；偏好已自动生效，出可撤销提示
        proposals: response.memory_proposals?.length ? response.memory_proposals : undefined,
        applied: response.memory_applied?.length ? response.memory_applied : undefined,
      }]);
      setOnline(true);
    } catch {
      track('degrade', { id: 'chat-offline' });
      setOnline(false);
      setMessages((current) => [
        ...current,
        { role: 'lbao', text: '校园资料服务暂时未连接。启动 server/app.py 后，我就可以继续查询资料。' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-ink/[0.07] bg-white shadow-[0_12px_32px_rgba(22,35,63,0.06)] lg:grid-cols-[264px_minmax(0,1fr)] lg:grid-rows-1">
      <aside className="hero-surface flex flex-col px-5 py-5 text-white sm:px-6 lg:py-6">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/10 text-sm font-semibold" aria-hidden="true">梨</span>
          <div>
            <h1 className="text-base font-semibold">梨宝</h1>
            <p className="mt-0.5 text-xs text-white/50">校园问答与本周建议</p>
          </div>
        </div>

        <div className="mt-5 border-y border-white/10 py-4 lg:mt-7">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">WHAT I CAN HELP</p>
          <p className="mt-3 text-sm leading-6 text-white/72">校园公开资料的查询，或结合你的课表和画像，给这一周留出可执行的空间。</p>
        </div>

        <div className="mt-5 lg:mt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">TRY ASKING</p>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
            {QUICK.map((question) => (
              <button
                key={question}
                onClick={() => send(question)}
                disabled={loading}
                className="min-h-11 rounded-xl border border-white/10 px-3 py-2 text-left text-sm text-white/75 transition-colors hover:border-white/25 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {question}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-auto pt-4 lg:pt-6">
          {/* 记忆入口（M3）：梨宝记住了什么，点开全部可见、可确认、可撤销、可删 */}
          <button
            onClick={() => setMemoryOpen(true)}
            className="mb-3 w-full rounded-xl border border-white/15 px-3 py-2 text-left text-xs text-white/70 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white"
          >
            📓 梨宝记住了什么（查看 / 确认 / 删除）
          </button>
          {/* 未连接用琥珀而不是品牌靛蓝：靛蓝在这套色板里代表「正常 / 可操作」，
              拿它表示服务不可用会把告警读成常态。 */}
          <div className={`flex items-center gap-2 text-xs ${online === false ? 'text-accent' : 'text-white/55'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${online === true ? 'bg-ok' : online === false ? 'bg-accent' : 'bg-white/35'}`} aria-hidden="true" />
            {online === true ? '校园资料服务已连接' : online === false ? '校园资料服务未连接' : '正在连接校园资料服务'}
          </div>
        </div>
      </aside>

      <section className="flex min-h-0 flex-col p-3 sm:p-5">
        {online === false && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-accent/25 bg-accent-light px-3 py-2 text-sm leading-5 text-ink-soft">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            启动 <code className="font-semibold text-ink">python server/app.py</code> 后，可继续查询校园资料；本地排程仍可使用。
          </div>
        )}

        <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1 py-2 sm:px-2" aria-live="polite">
          {messages.map((message, index) => (
            <div key={index} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div className={`flex max-w-[88%] flex-col gap-2 ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
                {message.role === 'lbao' && (
                  <div className="flex items-center gap-2 pl-1">
                    <span className="grid h-6 w-6 place-items-center rounded-md bg-ink text-[10px] font-bold text-white" aria-hidden="true">梨</span>
                    <span className="text-[11px] font-semibold tracking-[0.08em] text-ink-faint">梨宝{message.mode === 'llm' ? ' · AI' : ''}</span>
                  </div>
                )}
                <div className={`rounded-xl border px-3.5 py-3 text-sm leading-6 whitespace-pre-wrap ${
                  message.role === 'user' ? 'border-brand bg-brand text-white' : 'border-ink/10 bg-paper text-ink'
                }`}>
                  {message.text}
                </div>

                {message.needProfile && onGoProfile && (
                  <button onClick={onGoProfile} className="button-primary ml-1 px-3 py-2 text-xs">完成画像</button>
                )}

                {message.planPoints && message.planPoints.length > 0 && (
                  <ul className="w-full space-y-1 pl-1">
                    {message.planPoints.map((point, i) => (
                      <li key={i} className="text-[12.5px] leading-5 text-ink-soft">· {point}</li>
                    ))}
                  </ul>
                )}

                {/* 目标草稿卡：确认前不写任何状态 —— 执行权在用户手里 */}
                {message.goalAsk != null && pending[message.goalAsk] && (
                  <div className="flex gap-2 pl-1">
                    <button onClick={() => confirmGoal(message.goalAsk!)} className="button-primary px-3 py-2 text-xs">
                      就这么排
                    </button>
                    <button
                      onClick={() => setPending((p) => {
                        const next = { ...p };
                        delete next[message.goalAsk as number];
                        return next;
                      })}
                      className="rounded-xl border border-ink/15 px-3 py-2 text-xs text-ink-soft transition-colors hover:border-ink/30"
                    >
                      先不排
                    </button>
                  </div>
                )}

                {message.goWeek && (
                  <p className="pl-1 text-[11.5px] text-ink-faint">完整时间轴在「总览 → 选一周 → 周计划」</p>
                )}

                {/* 记忆建议卡（M2）：客观事实（年级/学院/专业）只提议，点头才记 */}
                {message.proposals && message.proposals.length > 0 && (
                  <div className="w-full space-y-2 pl-1">
                    <p className="text-[11.5px] text-ink-faint">我在对话里听到了这些身份信息，你点头我才记：</p>
                    {message.proposals.map((fact) => (
                      <div key={fact.id} className="flex w-full items-center justify-between gap-2 rounded-xl border border-ink/10 bg-paper px-3 py-2 text-sm">
                        <span className="text-ink">{factLabel(fact.key)}：{fact.value}</span>
                        <span className="flex shrink-0 gap-2">
                          <button onClick={() => void handleFact(index, fact, 'confirm')} className="button-primary px-3 py-1.5 text-xs">记下来</button>
                          <button onClick={() => void handleFact(index, fact, 'reject')} className="rounded-xl border border-ink/15 px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-ink/30">不记</button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 已自动生效的偏好（M2）：自动记下，但随时可撤销 */}
                {message.applied && message.applied.length > 0 && (
                  <div className="w-full space-y-1.5 pl-1">
                    {message.applied.map((fact) => (
                      <div key={fact.id} className="flex w-full items-center justify-between gap-2 rounded-xl border border-ok/25 bg-ok/10 px-3 py-2 text-[12.5px] text-ink-soft">
                        <span>顺手记下了：{factLabel(fact.key)} · {fact.value}</span>
                        <button onClick={() => void handleFact(index, fact, 'undo')} className="shrink-0 underline underline-offset-2">撤销</button>
                      </div>
                    ))}
                  </div>
                )}

                {message.sources && message.sources.length > 0 && (
                  <div className="w-full divide-y divide-ink/10 border-y border-ink/10 pl-1">
                    {message.sources.slice(0, 3).map((source, sourceIndex) => (
                      <a
                        key={sourceIndex}
                        href={source.url || undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="block py-3 transition-colors hover:text-brand"
                      >
                        <div className="text-sm font-semibold leading-5 text-ink">{source.title}</div>
                        <div className="mt-1 text-xs text-ink-faint">{source.account} · {source.pub_time}</div>
                      </a>
                    ))}
                  </div>
                )}

                {SHOW_DEBUG && message.debug && <ChatDebug data={message.debug} />}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 border border-ink/10 bg-paper px-3.5 py-3 text-sm text-ink-soft">
                <span className="grid h-6 w-6 place-items-center rounded-md bg-ink text-[10px] font-bold text-white animate-pulse" aria-hidden="true">梨</span>
                梨宝掐指一算中…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="mt-3 flex items-center gap-2 border-t border-ink/10 pt-3">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && send()}
            placeholder="问梨宝，或说「帮我安排这周」…"
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-ink/15 bg-paper px-4 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/10"
          />
          <button onClick={() => send()} disabled={loading || !input.trim()} className="button-primary shrink-0 px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40">
            发送
          </button>
        </div>
      </section>

      <MemoryPanel open={memoryOpen} userId={identity.userId} onClose={() => setMemoryOpen(false)} />
    </div>
  );
}
