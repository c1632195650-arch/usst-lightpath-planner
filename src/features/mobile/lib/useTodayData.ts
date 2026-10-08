/**
 * 光溯移动端 · 今日页数据钩子（新任务三 W0 拆分产物）
 * ============================================================
 * 把 TodayPage 的数据面（云同步/覆盖层/待办仓/行为日志/通知/明日预告/版本检查）
 * 收进一个 hook，TodayPage 只承担渲染（≤260 行硬指标）。
 * 纪律不变：覆盖层是唯一写法；待办走 memoStore 乐观本地 + 服务端逐项 LWW；
 * persona 缺省 null 与旧行为逐字节一致。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TimeBlock, WeekPlan } from '@/types';
import { ApiFailure, apiGetSyncState, apiGetVersion, apiPutPlanCopy, apiPutSyncState } from './api.ts';
import type { SyncStatePayload } from './types.ts';
import { MEMO_CACHE_KEY } from './memoTypes.ts';
import type { MemoData } from './memoStore.ts';
import {
  addGoalMilestone, addTodo, adoptCloudMemo, archiveTodo, loadMemo,
  saveMemo, toggleGoalMilestone, toggleTodoDone,
} from './memoStore.ts';
import {
  emptyUserPlan, loadUserPlan, saveUserPlan, upsertMove,
  type MoveRecord, type UserPlanLayer,
} from '@/features/week/userPlanStore';
import { recomputeWeek } from './planCompute.ts';
import {
  applyLayerToBlocks, buildSyncPayload, todayDow, todaySignature, weekNoFromTermStart,
} from './sync.ts';
import { isNative, pickOngoingBlock, registerActionHandler, rescheduleToday, showOngoing } from './notifyBridge.ts';
import { ensurePermissionOnce } from './notifyStatus.ts';
import { loadBehavior, recordBlockToggle, type BehaviorEvent } from '../eval/behaviorLog.ts';
import type { GoalTodoHandlers } from '../GoalTodoCard.tsx';

/**
 * 本 APK 内置版本号 —— **构建期由 vite `define` 注入**（`vite.config.ts` 读 package.json）。
 * 🔴 此前是手写`'0.1.0'`，每次出 APK 漏改就会让 F18 检查更新**静默失效**
 * （永远判定"已是最新"）。现改为自动注入，漏改不再可能。详见 `src/vite-env.d.ts`。
 */
const APP_VERSION = __APP_VERSION__;

const SIG_KEY = 'usst.mobile.todaySig';
const LS_READ = (k: string) => localStorage.getItem(k);
const LS_WRITE = (k: string, v: string) => localStorage.setItem(k, v);

function newerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

export type TodayPhase = 'loading' | 'empty-cloud' | 'ready' | 'error';

export function useTodayData(identity: { token: string; username: string }, now: Date) {
  const dow = todayDow(now);
  const [phase, setPhase] = useState<TodayPhase>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [serverState, setServerState] = useState<SyncStatePayload | null>(null);
  const [weekNo, setWeekNo] = useState<number | null>(null);
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [layer, setLayer] = useState<UserPlanLayer>(() => loadUserPlan());
  const [memo, setMemo] = useState<MemoData>(() => loadMemo(LS_READ, MEMO_CACHE_KEY));
  const [changed, setChanged] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'saved' | 'error'>('idle');
  const [tomorrow, setTomorrow] = useState<{ loading: boolean; blocks: TimeBlock[] | null }>({ loading: false, blocks: null });
  const [updateUrl, setUpdateUrl] = useState<string | null>(null);
  const [permDenied, setPermDenied] = useState(false);
  const [behaviorEvents, setBehaviorEvents] = useState(() => loadBehavior(localStorage));

  const weekNoRef = useRef(weekNo);
  weekNoRef.current = weekNo;
  const layerRef = useRef(layer);
  layerRef.current = layer;
  // M2b：待办仓的 ref（syncToCloud 在 LWW 被拒时要拿「当前本地待办」合并云端）
  const memoRef = useRef<MemoData>(memo);
  memoRef.current = memo;
  const displayedRef = useRef<{ blocks: TimeBlock[]; doneIds: ReadonlySet<string> } | null>(null);
  const nowMinRef = useRef(0);
  nowMinRef.current = now.getHours() * 60 + now.getMinutes();
  const phaseRef = useRef<TodayPhase>(phase);
  phaseRef.current = phase;

  const todayKey = useMemo(() => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  }, [now]);

  /* ---------- 初次加载：拉云端状态 → 采纳覆盖层+待办 → 本地重算 ---------- */
  const load = useCallback(async () => {
    setPhase('loading');
    setErrMsg('');
    try {
      const st = await apiGetSyncState(identity.token);
      if (!st.found || !st.state) {
        setPhase('empty-cloud');
        return;
      }
      const s = st.state;
      setServerState(s);
      const adopted: UserPlanLayer = s.userOverrides ?? emptyUserPlan();
      saveUserPlan(adopted);
      setLayer(adopted);
      setMemo((prev) => {
        // 待办/目标：按 id 逐项 LWW 并集（另一端并发编辑不丢）
        const next = adoptCloudMemo(prev, s.todos ?? null, s.goals ?? null);
        saveMemo(LS_WRITE, MEMO_CACHE_KEY, next);
        return next;
      });
      const wn = weekNoFromTermStart(s.termStart ?? s.schedule?.termStart ?? null, new Date()) ?? s.weekNo ?? null;
      setWeekNo(wn);
      if (!wn) {
        setPhase('error');
        setErrMsg('学期起点有问题，去网页端检查学期设置');
        return;
      }
      const p = await recomputeWeek({
        schedule: s.schedule, weekNo: wn, planState: s.planState ?? null,
        layer: adopted, persona: s.persona ?? null, scenarios: s.persona?.scenarios ?? null,
      });
      if (!p) {
        setPhase('error');
        setErrMsg('本地重算失败，下拉重试');
        return;
      }
      setPlan(p);
      try {
        const view = applyLayerToBlocks(p, adopted, wn, todayDow(new Date()));
        const sig = todaySignature(view.blocks, view.doneIds);
        const old = localStorage.getItem(SIG_KEY);
        if (old && old !== sig) setChanged(true);
        localStorage.setItem(SIG_KEY, sig);
      } catch { /* F9 是增强，失败不影响主流程 */ }
      setPhase('ready');
    } catch (e) {
      setPhase('error');
      setErrMsg(e instanceof ApiFailure && e.code === 'network_error' ? '连不上服务器' : '同步失败，稍后重试');
    }
  }, [identity.token]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------- C1 权限前置：进页面就请求一次，拒绝过不再骚扰 ---------- */
  useEffect(() => {
    void (async () => {
      setPermDenied((await ensurePermissionOnce({ read: LS_READ, write: LS_WRITE }, await isNative())) === 'denied');
    })();
  }, []);

  /* ---------- 云同步（debounce 1s；LWW 被拒 → 以云端为准） ---------- */
  const syncToCloud = useCallback(async (displayedNow: { blocks: TimeBlock[]; doneIds: ReadonlySet<string> } | null) => {
    const wn = weekNoRef.current;
    if (!serverState || !wn || !plan) return;
    setSyncStatus('syncing');
    const clientUpdatedAt = new Date().toISOString();
    const payload = buildSyncPayload({
      schedule: serverState.schedule, planState: serverState.planState ?? null, userOverrides: layerRef.current,
      termStart: serverState.termStart, weekNo: wn, clientUpdatedAt,
      todos: memo.todos, goals: memo.goals, persona: serverState.persona ?? null,
    });
    try {
      const r = await apiPutSyncState(identity.token, { state: payload, schemaVer: 2, clientUpdatedAt });
      if (!r.accepted) {
        const adopted = r.state?.userOverrides ?? emptyUserPlan();
        saveUserPlan(adopted);
        setLayer(adopted);
        if (r.state) setServerState(r.state);
        // M2b：LWW 被拒 = 服务端版本更新 —— 必须把云端 todos/goals 回落本地，
        // 否则手机端本地与服务端永久分叉（此前只采纳 userOverrides，云端待办更新丢失）。
        const merged = adoptCloudMemo(memoRef.current, r.state?.todos ?? null, r.state?.goals ?? null);
        saveMemo(LS_WRITE, MEMO_CACHE_KEY, merged);
        memoRef.current = merged;
        setMemo(merged);
        setSyncStatus('error');
        return;
      }
      await apiPutPlanCopy(identity.token, wn, plan);
      setSyncStatus('saved');
      void rescheduleToday(displayedNow?.blocks ?? [], nowMinRef.current);
      // F15 常驻「正在进行」通知（2026-10-08 接线）：与软提醒同一条节奏更新
      void showOngoing(pickOngoingBlock(displayedNow?.blocks ?? [], nowMinRef.current, displayedNow?.doneIds ?? null));
    } catch {
      setSyncStatus('error');
    }
  }, [identity.token, serverState, plan, memo]);

  const firstLayerRender = useRef(true);
  useEffect(() => {
    if (phase !== 'ready') return;
    if (firstLayerRender.current) {
      firstLayerRender.current = false;
      return;
    }
    if (!serverState || !weekNoRef.current) return;
    let cancelled = false;
    void recomputeWeek({
      schedule: serverState.schedule, weekNo: weekNoRef.current, planState: serverState.planState ?? null,
      layer, persona: serverState.persona ?? null, scenarios: serverState.persona?.scenarios ?? null,
    }).then((p) => {
      if (!cancelled && p) setPlan(p);
    });
    const t = window.setTimeout(() => void syncToCloud(displayedRef.current), 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, phase]);

  /* ---------- 轻编辑（F4）+ 行为日志（任务二原料，只记用户主动动作） ---------- */
  const onAction = useCallback((b: TimeBlock, a: { type: 'toggleDone' } | { type: 'shift'; deltaMin: number }) => {
    const wn = weekNoRef.current;
    if (!wn) return;
    if (a.type === 'toggleDone') {
      const willBeDone = !(layerRef.current.moves.find((m) => m.blockId === b.id && m.weekNo === wn)?.done ?? false);
      recordBlockToggle(localStorage, {
        blockId: b.id, kind: b.kind, plannedStartMin: b.startMin, when: new Date(), done: willBeDone,
      });
      setBehaviorEvents(loadBehavior(localStorage));
    }
    setLayer((prev) => {
      const existing = prev.moves.find((m) => m.blockId === b.id && m.weekNo === wn);
      const done = a.type === 'toggleDone' ? !(existing?.done ?? false) : (existing?.done ?? false);
      const rec: MoveRecord = {
        weekNo: wn,
        blockId: b.id,
        dayOfWeek: b.dayOfWeek,
        startMin: a.type === 'shift' ? b.startMin + a.deltaMin : b.startMin,
        endMin: a.type === 'shift' ? b.endMin + a.deltaMin : b.endMin,
        ...(b.place !== undefined ? { place: b.place } : {}),
        ...(b.room !== undefined ? { room: b.room } : {}),
        source: 'edit',
        ...(done ? { done: true } : {}),
      };
      const next = { ...prev, moves: upsertMove(prev.moves, rec) };
      saveUserPlan(next);
      return next;
    });
  }, []);

  /* ---------- 通知动作按钮（F14，仅 APK 内有事件源） ---------- */
  useEffect(() => {
    registerActionHandler((blockId, action) => {
      const b = displayedRef.current?.blocks.find((x) => x.id === blockId);
      if (!b) return;
      onAction(b, action === 'done' ? { type: 'toggleDone' } : { type: 'shift', deltaMin: 15 });
    });
  }, [onAction]);

  /* ---------- F15 常驻「正在进行」通知：前台每分钟校对（块开始/结束自动切换，2026-10-08） ---------- */
  useEffect(() => {
    const tick = () => {
      if (phaseRef.current !== 'ready') return; // 数据没就绪不动——避免把上次会话的常驻误撤
      const d = displayedRef.current;
      void showOngoing(d ? pickOngoingBlock(d.blocks, nowMinRef.current, d.doneIds) : null);
    };
    tick();
    const t = window.setInterval(tick, 60_000);
    return () => window.clearInterval(t);
  }, []);

  /* ---------- F7 明日预告 ---------- */
  const tomorrowDow = (dow % 7) + 1;
  useEffect(() => {
    if (phase !== 'ready' || !weekNo) return;
    if (tomorrowDow !== 1 && plan) {
      const view = applyLayerToBlocks(plan, layer, weekNo, tomorrowDow);
      setTomorrow({ loading: false, blocks: view.blocks });
      return;
    }
    if (tomorrowDow === 1 && serverState) {
      setTomorrow({ loading: true, blocks: null });
      let cancelled = false;
      void recomputeWeek({
        schedule: serverState.schedule, weekNo: weekNo + 1, planState: serverState.planState ?? null,
        layer, persona: serverState.persona ?? null, scenarios: serverState.persona?.scenarios ?? null,
      }).then((p) => {
        if (cancelled) return;
        const view = p ? applyLayerToBlocks(p, layer, weekNo + 1, 1) : null;
        setTomorrow({ loading: false, blocks: view?.blocks ?? [] });
      });
      return () => {
        cancelled = true;
      };
    }
  }, [phase, tomorrowDow, plan, layer, weekNo, serverState]);

  /* ---------- F18 检查更新 ---------- */
  useEffect(() => {
    void apiGetVersion()
      .then((v) => {
        if (newerVersion(v.version, APP_VERSION) && v.apkUrl) setUpdateUrl(v.apkUrl);
      })
      .catch(() => undefined);
  }, []);

  /* ---------- 待办/目标变更 → 同一条 debounce 上行通道（覆盖层与待办共用一次 PUT） ---------- */
  const firstMemoRender = useRef(true);
  useEffect(() => {
    if (phase !== 'ready') return;
    if (firstMemoRender.current) {
      firstMemoRender.current = false;
      return;
    }
    const t = window.setTimeout(() => void syncToCloud(displayedRef.current), 1000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memo, phase]);

  /* ---------- 待办/目标仓：乐观本地，随下一次 PUT 上行（服务端逐项 LWW） ----------
   * M2a（2026-10-07）：副作用移出 setState updater —— React StrictMode 会双调用
   * updater，原实现会重复写盘、且 id 生成类操作有双跑风险。改为三步：
   * 纯函数算 next → memoRef/setMemo 同步 → saveMemo 落盘（恰好一次）。 */
  const memoHandlers: GoalTodoHandlers = useMemo(() => {
    const applyMemo = (fn: (d: MemoData) => MemoData) => {
      const next = fn(memoRef.current);
      memoRef.current = next;
      setMemo(next);
      saveMemo(LS_WRITE, MEMO_CACHE_KEY, next);
    };
    return {
      onComplete: (tid, plannedDone) => {
        const r = toggleTodoDone(memoRef.current, tid, { nowIso: new Date().toISOString(), plannedDone });
        if (r.ok) applyMemo(() => r.data);
      },
      onArchive: (tid) => applyMemo((d) => archiveTodo(d, tid, new Date().toISOString())),
      onAddTodo: (title, kind) => applyMemo((d) => addTodo(d, { title, kind, nowIso: new Date().toISOString() })),
      onToggleMilestone: (gid, msid) => applyMemo((d) => toggleGoalMilestone(d, gid, msid, new Date().toISOString())),
      onAddMilestone: (gid, title) => applyMemo((d) => addGoalMilestone(d, gid, { title }, new Date().toISOString())),
    };
  }, []);

  return {
    phase, errMsg, serverState, weekNo, plan, layer, memo, tomorrow, tomorrowDow,
    updateUrl, syncStatus, changed, setChanged, permDenied, behaviorEvents,
    dow, todayKey, nowMin: nowMinRef.current, displayedRef,
    onAction, memoHandlers, retry: load,
  };
}

/** 钩子返回类型（供页签子组件声明 props；页面宿主保持单一钩子实例） */
export type TodayData = ReturnType<typeof useTodayData>;
