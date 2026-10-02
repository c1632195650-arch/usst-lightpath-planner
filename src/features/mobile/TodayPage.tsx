/**
 * 光溯移动端 · 今日页（方案 §7.2 数据流的落地）
 * ============================================================
 *   登录 → GET /api/sync/state
 *     ├─ found=false → 空态引导（去网页端排计划）
 *     └─ found → 采纳云端覆盖层 → 本地 recomputeWeek 重算
 *              → 套覆盖层渲染今日时间轴（F2/F3）
 *   轻编辑（F4）→ userPlanStore 覆盖层（唯一写法）→ 本地即时重算
 *              → debounce 1s → PUT state + PUT plan 副本 → notifyBridge 重排通知
 *
 * 其余：F5 现在横幅（30s tick）/ F6 ICS 引导 / F7 明日预告 / F9 变化标记 /
 *      F10 本周剩余 / F11 两个固定快捷指令（不调 LLM）/ F18 检查更新。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TimeBlock, WeekPlan } from '@/types';
import type { MobileIdentity } from './lib/auth.ts';
import { clearIdentity } from './lib/auth.ts';
import { ApiFailure, apiGetSyncState, apiGetVersion, apiPutPlanCopy, apiPutSyncState } from './lib/api.ts';
import type { SyncStatePayload } from './lib/types.ts';
import {
  emptyUserPlan, loadUserPlan, saveUserPlan, upsertMove,
  type MoveRecord, type UserPlanLayer,
} from '@/features/week/userPlanStore';
import { nextUpcoming, recomputeWeek } from './lib/planCompute.ts';
import {
  applyLayerToBlocks, buildSyncPayload, fmtMin,
  minutesOfDay, todayDow, todaySignature, weekNoFromTermStart,
} from './lib/sync.ts';
import { useNow } from './lib/useNow.ts';
import { registerActionHandler, rescheduleToday } from './lib/notifyBridge.ts';
import BlockCard from './BlockCard.tsx';
import EditSheet, { type EditAction } from './EditSheet.tsx';
import TomorrowPreview from './TomorrowPreview.tsx';
import WeekGlance from './WeekGlance.tsx';
import IcsGuide from './IcsGuide.tsx';

/** 本 APP 的版本（F18 semver 比较；APK 打包时与服务端 version.json 对齐） */
const APP_VERSION = '0.1.0';
/** F9 当日签名存档 key */
const SIG_KEY = 'usst.mobile.todaySig';

function newerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

type Phase = 'loading' | 'empty-cloud' | 'ready' | 'error';

export default function TodayPage({ identity, onLogout }: {
  identity: MobileIdentity;
  onLogout: () => void;
}) {
  const now = useNow(30_000);
  const dow = todayDow(now);
  const nowMin = minutesOfDay(now);

  const [phase, setPhase] = useState<Phase>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [serverState, setServerState] = useState<SyncStatePayload | null>(null);
  const [weekNo, setWeekNo] = useState<number | null>(null);
  const [plan, setPlan] = useState<WeekPlan | null>(null);
  const [layer, setLayer] = useState<UserPlanLayer>(() => loadUserPlan());
  const [sheetBlock, setSheetBlock] = useState<TimeBlock | null>(null);
  const [changed, setChanged] = useState(false); // F9「今天有变化」
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'saved' | 'error'>('idle');
  const [tomorrow, setTomorrow] = useState<{ loading: boolean; blocks: TimeBlock[] | null }>({ loading: false, blocks: null });
  const [quickMsg, setQuickMsg] = useState('');
  const [updateUrl, setUpdateUrl] = useState<string | null>(null); // F18

  /** 今日视图 = 重算计划 ∘ 覆盖层（excluded / moves / done） */
  const displayed = useMemo(
    () => (plan && weekNo ? applyLayerToBlocks(plan, layer, weekNo, dow) : null),
    [plan, layer, weekNo, dow],
  );
  const displayedRef = useRef(displayed);
  displayedRef.current = displayed;
  const nowMinRef = useRef(nowMin);
  nowMinRef.current = nowMin;

  /* ---------- 初次加载：拉云端状态 → 采纳覆盖层 → 本地重算 ---------- */
  const load = useCallback(async (id: MobileIdentity) => {
    setPhase('loading');
    setErrMsg('');
    try {
      const st = await apiGetSyncState(id.token);
      if (!st.found || !st.state) {
        setPhase('empty-cloud');
        return;
      }
      const s = st.state;
      setServerState(s);
      // 以云端为准（方案 §5.2 的载入侧语义）：云端覆盖层落本地，此后本地编辑再上行
      const adopted: UserPlanLayer = s.userOverrides ?? emptyUserPlan();
      saveUserPlan(adopted);
      setLayer(adopted);
      const wn = weekNoFromTermStart(s.termStart, new Date()) ?? s.weekNo ?? null;
      setWeekNo(wn);
      if (!wn) {
        setPhase('error');
        setErrMsg('学期起点有问题，去网页端检查学期设置');
        return;
      }
      const p = await recomputeWeek({ schedule: s.schedule, weekNo: wn, planState: s.planState ?? null, layer: adopted });
      if (!p) {
        setPhase('error');
        setErrMsg('本地重算失败，下拉重试');
        return;
      }
      setPlan(p);
      // F9：与上一次见过的今日签名比对，变了就提示
      try {
        const view = applyLayerToBlocks(p, adopted, wn, todayDow(new Date()));
        const sig = todaySignature(view.blocks, view.doneIds);
        const old = localStorage.getItem(SIG_KEY);
        if (old && old !== sig) setChanged(true);
        localStorage.setItem(SIG_KEY, sig);
      } catch { /* 标记是增强，失败不影响主流程 */ }
      setPhase('ready');
    } catch (e) {
      setPhase('error');
      setErrMsg(e instanceof ApiFailure && e.code === 'network_error' ? '连不上服务器' : '同步失败，稍后重试');
    }
  }, []);

  useEffect(() => {
    void load(identity);
  }, [identity, load]);

  /* ---------- 云同步（debounce 1s；LWW 被拒 → 以云端为准） ---------- */
  const syncToCloud = useCallback(async () => {
    if (!serverState || !weekNo || !plan) return;
    setSyncStatus('syncing');
    const clientUpdatedAt = new Date().toISOString();
    const payload = buildSyncPayload({
      schedule: serverState.schedule,
      planState: serverState.planState ?? null,
      userOverrides: layer,
      termStart: serverState.termStart,
      weekNo,
      clientUpdatedAt,
    });
    try {
      const r = await apiPutSyncState(identity.token, { state: payload, schemaVer: 1, clientUpdatedAt });
      if (!r.accepted) {
        // 云端更新 → 采纳服务端副本（方案 §5.2「以云端为准」）
        const adopted = r.state?.userOverrides ?? emptyUserPlan();
        saveUserPlan(adopted);
        setLayer(adopted);
        if (r.state) setServerState(r.state);
        setSyncStatus('error');
        return;
      }
      // 整周副本只作 ICS 素材（方案 §5.3）—— 本地刚重算的那份
      await apiPutPlanCopy(identity.token, weekNo, plan);
      setSyncStatus('saved');
      void rescheduleToday(displayedRef.current?.blocks ?? [], nowMinRef.current);
    } catch {
      setSyncStatus('error');
    }
  }, [identity, serverState, weekNo, plan, layer]);

  const firstLayerRender = useRef(true);
  useEffect(() => {
    if (phase !== 'ready') return;
    if (firstLayerRender.current) {
      firstLayerRender.current = false;
      return;
    }
    if (!serverState || !weekNo) return;
    // 本地即时重算（引擎吃新覆盖层：moves 已并入锁）
    let cancelled = false;
    void recomputeWeek({ schedule: serverState.schedule, weekNo, planState: serverState.planState ?? null, layer })
      .then((p) => {
        if (!cancelled && p) setPlan(p);
      });
    const t = window.setTimeout(() => void syncToCloud(), 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, phase]);

  /* ---------- 轻编辑（F4）：全部落覆盖层 ---------- */
  const onAction = useCallback((b: TimeBlock, a: EditAction) => {
    if (!weekNo) return;
    setLayer((prev) => {
      const existing = prev.moves.find((m) => m.blockId === b.id && m.weekNo === weekNo);
      const done = a.type === 'toggleDone' ? !(existing?.done ?? false) : (existing?.done ?? false);
      const rec: MoveRecord = {
        weekNo,
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
    setSheetBlock(null);
    setQuickMsg('');
  }, [weekNo]);

  /* ---------- 通知动作按钮（F14，仅 APK 内有事件源） ---------- */
  useEffect(() => {
    registerActionHandler((blockId, action) => {
      const b = displayedRef.current?.blocks.find((x) => x.id === blockId);
      if (!b) return;
      onAction(b, action === 'done' ? { type: 'toggleDone' } : { type: 'shift', deltaMin: 15 });
    });
  }, [onAction]);

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
      // 周日 → 下周一需要下一周的重算（懒算一次）
      setTomorrow({ loading: true, blocks: null });
      let cancelled = false;
      void recomputeWeek({ schedule: serverState.schedule, weekNo: weekNo + 1, planState: serverState.planState ?? null, layer })
        .then((p) => {
          if (cancelled) return;
          const view = p ? applyLayerToBlocks(p, layer, weekNo + 1, 1) : null;
          setTomorrow({ loading: false, blocks: view?.blocks ?? [] });
        });
      return () => {
        cancelled = true;
      };
    }
  }, [phase, tomorrowDow, plan, layer, weekNo, serverState]);

  /* ---------- F18 检查更新（APK 里才有意义；网页端静默） ---------- */
  useEffect(() => {
    void apiGetVersion()
      .then((v) => {
        if (newerVersion(v.version, APP_VERSION) && v.apkUrl) setUpdateUrl(v.apkUrl);
      })
      .catch(() => undefined); // 404/断网 = 没有更新信息，不是错误
  }, []);

  /* ---------- F11 快捷指令（两个固定问法，不调 LLM） ---------- */
  function quickWhatToday() {
    const d = displayedRef.current;
    if (!d) return;
    const left = d.blocks.filter((b) => !d.doneIds.has(b.id) && b.endMin > nowMinRef.current);
    setQuickMsg(left.length === 0
      ? '今天排的都完成啦，剩下的时间留给你自己。'
      : `今天还剩 ${left.length} 件：${left.slice(0, 3).map((b) => `${b.title} ${fmtMin(b.startMin)}`).join('、')}${left.length > 3 ? ' 等' : ''}`);
  }
  function quickSnoozeNext() {
    const d = displayedRef.current;
    if (!d) return;
    const next = nextUpcoming(d.blocks, nowMinRef.current, d.doneIds);
    if (!next) {
      setQuickMsg('今天没有接下来的块了。');
      return;
    }
    onAction(next, { type: 'shift', deltaMin: 15 });
    setQuickMsg(`已把「${next.title}」顺延 15 分钟。`);
  }

  /* ---------- 渲染 ---------- */
  const current = displayed?.blocks.find((b) => b.startMin <= nowMin && nowMin < b.endMin && !displayed.doneIds.has(b.id)) ?? null;
  const next = displayed ? nextUpcoming(displayed.blocks, nowMin, displayed.doneIds) : null;
  const doneIds = displayed?.doneIds ?? new Set<string>();

  return (
    <div className="min-h-screen w-full bg-paper pb-10">
      {/* 顶栏 */}
      <header className="sticky top-0 z-30 bg-paper/95 px-4 py-3 backdrop-blur">
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-bold text-ink">光溯 · 今天</h1>
          <div className="flex items-center gap-2 text-xs text-ink-faint">
            {weekNo && <span data-testid="m-weekno">第 {weekNo} 周</span>}
            <span data-testid="m-sync-status">
              {syncStatus === 'syncing' && '同步中…'}
              {syncStatus === 'saved' && '已同步 ✓'}
              {syncStatus === 'error' && '同步失败'}
            </span>
            <button type="button" onClick={() => { clearIdentity(); onLogout(); }} className="underline">
              退出
            </button>
          </div>
        </div>
        <p className="text-xs text-ink-faint">{identity.username} · 懂上理的智能决策伙伴</p>
      </header>

      <main className="mx-auto w-full max-w-md space-y-3 px-4">
        {/* F9 变化标记 */}
        {changed && (
          <div data-testid="m-changed-banner" className="rounded-xl bg-accent-light px-4 py-2.5 text-sm text-ink">
            今天的安排有更新 —— 以这里显示的为准。
            <button type="button" className="ml-2 underline" onClick={() => setChanged(false)}>知道了</button>
          </div>
        )}
        {/* F18 更新提示 */}
        {updateUrl && (
          <div data-testid="m-update" className="rounded-xl bg-brand-light px-4 py-2.5 text-sm text-ink">
            有新版本。
            <a className="ml-2 underline" href={updateUrl}>下载更新 APK</a>
          </div>
        )}

        {phase === 'loading' && (
          <p data-testid="m-loading" className="py-16 text-center text-sm text-ink-faint">同步中…</p>
        )}

        {phase === 'error' && (
          <div className="py-16 text-center">
            <p className="text-sm text-danger">{errMsg}</p>
            <button type="button" onClick={() => void load(identity)} className="mt-3 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white">
              重试
            </button>
          </div>
        )}

        {phase === 'empty-cloud' && (
          <div data-testid="m-empty-cloud" className="rounded-card bg-paper-card p-6 text-center shadow-sm">
            <p className="text-base font-semibold text-ink">云端还没有你的计划</p>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              先去网页端导入课表、生成周计划，回来点一下同步，这里就能看了。
            </p>
            <button type="button" onClick={() => void load(identity)} className="mt-4 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white">
              我排好了，刷新
            </button>
          </div>
        )}

        {phase === 'ready' && (
          <>
            {/* F5 「现在」横幅 */}
            {current ? (
              <div data-testid="m-now-banner" className="rounded-card bg-brand px-4 py-3 text-white shadow-sm">
                <p className="text-xs opacity-80">正在进行</p>
                <p className="text-base font-semibold">
                  {current.emoji ?? ''}{current.title}
                  {current.place ? ` · ${current.place}` : ''}
                  <span className="ml-1 font-normal opacity-90">还剩 {Math.max(0, current.endMin - nowMin)} 分钟</span>
                </p>
              </div>
            ) : next ? (
              <div data-testid="m-next-banner" className="rounded-card bg-paper-card px-4 py-3 shadow-sm">
                <p className="text-xs text-ink-soft">下一块 {fmtMin(next.startMin)}（还有 {Math.max(0, next.startMin - nowMin)} 分钟）</p>
                <p className="text-base font-semibold text-ink">{next.emoji ?? ''}{next.title}{next.place ? ` · ${next.place}` : ''}</p>
              </div>
            ) : (
              <div data-testid="m-now-banner" className="rounded-card bg-ok-light px-4 py-3 shadow-sm">
                <p className="text-sm text-ink">今天的块都结束了 —— 收工，好好休息。</p>
              </div>
            )}

            {/* F11 快捷指令 */}
            <div className="flex gap-2">
              <button type="button" data-testid="m-quick-today" onClick={quickWhatToday}
                className="flex-1 rounded-xl border border-ink/10 bg-paper-card px-3 py-2.5 text-sm font-semibold text-ink">
                今天还有啥
              </button>
              <button type="button" data-testid="m-quick-snooze" onClick={quickSnoozeNext}
                className="flex-1 rounded-xl border border-ink/10 bg-paper-card px-3 py-2.5 text-sm font-semibold text-ink">
                帮我顺延下一块
              </button>
            </div>
            {quickMsg && (
              <p data-testid="m-quick-msg" className="rounded-xl bg-paper-sunken px-4 py-2.5 text-sm text-ink-soft">{quickMsg}</p>
            )}

            {/* F2 时间轴 / 空态 */}
            <section className="space-y-2" data-testid="m-today-list">
              {displayed && displayed.blocks.length === 0 && (
                <div data-testid="m-empty" className="rounded-card bg-paper-card p-6 text-center shadow-sm">
                  <p className="text-base font-semibold text-ink">今天还没有安排</p>
                  <p className="mt-2 text-sm leading-6 text-ink-soft">
                    去网页端「周计划」把今天排上，或者把手机上的偏好告诉梨宝。
                  </p>
                </div>
              )}
              {displayed?.blocks.map((b) => (
                <BlockCard
                  key={b.id}
                  block={b}
                  nowMin={nowMin}
                  done={doneIds.has(b.id)}
                  isCurrent={current?.id === b.id}
                  onOpen={setSheetBlock}
                />
              ))}
            </section>

            {/* F7 / F10 / F6 */}
            <TomorrowPreview blocks={tomorrow.blocks} tomorrowDow={tomorrowDow} loading={tomorrow.loading} />
            <WeekGlance plan={plan} layer={layer} weekNo={weekNo ?? 0} todayDow={dow} />
            <IcsGuide icsToken={identity.icsToken} />
          </>
        )}
      </main>

      <EditSheet
        block={sheetBlock}
        done={sheetBlock ? doneIds.has(sheetBlock.id) : false}
        onClose={() => setSheetBlock(null)}
        onAction={onAction}
      />
    </div>
  );
}
