/**
 * 七列时间轴网格（T3 · 2026-10-07）
 * ============================================================
 * 周计划页的核心视图：七列**共享一条时间基准**（06:00–24:00），
 * 块高 = 时长 × PPM —— 「周三下午有空、周四下午排满」一眼就能横向对比。
 *
 * 结构（上下两段同模板 grid，保证列严格对齐）：
 *   ① 列头带（sticky 吸顶）：角落 + 七列列头（星期/日期/今天/自习/天气）
 *   ② 主体带：52px 刻度列 + 七条 WeekDayColumn 泳道
 * 外壳是唯一的纵向滚动容器（max-h 限制）；「块内滚动」是块的内部事务（BlockCard）。
 *
 * 🔴 为什么不是「5 工作日 + 周末合并」六轨（原型演示的形态）：
 *   周末合并轨在真实数据下必崩 —— 周六、周日各自都有早餐/自习，时间几乎必然
 *   重叠；两条时间轴叠在一列上，「重叠下推」会把后一条画到错误时刻（周日
 *   9:00 的事被画在 12:02 的位置）。原型是假数据（周末只放了一组不重叠事件）
 *   掩盖了这一点。真实数据必须「每天一列」= 七列。
 *
 * 🔴 「回到今天」的锚点 `[data-today-col]` 挂在**列头**上（不是 1350px 高的
 *   泳道）：`WeekToolsPanel` 用 `scrollIntoView` 滚它 —— 挂列头 ⟹ 滚到时间轴
 *   顶部 + 列头吸顶，正是「回到今天」该有的落点；挂泳道会滚得莫名其妙。
 */
import { useEffect, useRef } from 'react';
import type { PlanPersistState, TimeBlock } from '@/types';
import type { WeatherAdvice, WeatherDay } from '@/features/weather/weather';
import { DAY_LABELS, TODAY_COL_BG } from './weekViewUtils';
import { SaturationBar } from './SaturationBar';
import { dayBreakdown, daySaturation } from './saturation';
import { Icon } from '@/components/icons/Icon';
import { AXIS_HEIGHT, gutterMarks } from './timeAxis';
import type { TimeGap } from './timeScale';
import { WeekDayColumn, type DragPreview } from './WeekDayColumn';

export interface WeekTimelineGridProps {
  /** 整周块（各列自行按 day 过滤） */
  allBlocks: TimeBlock[];
  /** 今天的 dayOfWeek（1–7）；非本周为 null */
  todayDow: number | null;
  /** 该周第 n 天的 ISO 日期（列头/天气/BlockCard 共用） */
  dateOfDay: (day: number) => string;
  weatherByDate: Map<string, WeatherDay>;
  adviceByDate: Map<string, WeatherAdvice>;
  recentTaskIds: string[];
  onDismissNew: (taskId: string) => void;
  planState: PlanPersistState | null;
  weekNo: number;
  /** courseId → 本周作业分钟 */
  assignmentByCourse: Map<string, number>;
  editedBlockIds: ReadonlySet<string>;
  draggingId: string | null;
  preview: DragPreview | null;
  setDraggingId: (id: string | null) => void;
  updatePreview: (day: number, atMin: number, coord: string) => void;
  clearPreview: () => void;
  handleDrop: (blockId: string, day: number, atMin: number) => void;
  /** 右键空档 → 「加一件事」（透传给泳道；弹窗状态在 WeekPlanView 持有） */
  onGapContextMenu: (day: number, gap: TimeGap, clickedMin: number, pos: { x: number; y: number }) => void;
  onToggleLock: (block: TimeBlock) => void;
  onExclude: (block: TimeBlock) => void;
  onSetAssignment: (courseId: string, courseTitle: string, minutes: number) => void;
  onClearAssignment: (courseId: string) => void;
  onEditBlock: (block: TimeBlock, next: { startMin: number; endMin: number; place?: string }) => void;
  /** WP7-E5（本树）：浏览态=false —— 块不可拖、右键菜单关（透传到 BlockCard） */
  allowEdit?: boolean;
  onRevertEdit: (block: TimeBlock) => void;
}

/**
 * 两段 grid 共用的列模板：52px 刻度 + 七等分。
 * `minmax(0,1fr)` 防内容把列撑宽；`gap-px` + 容器底色 = 1px 网格线。
 */
const GRID_COLS = 'grid grid-cols-[52px_repeat(7,minmax(0,1fr))] gap-px bg-ink/[0.08]';

/**
 * 换周时**保持纵向滚动位置**（RAY 2026-10-07 拍板：左右键切周不要跳回最上端）。
 *
 * ⚠️ 位置有**两层**，两层都会丢，必须各记一份：
 *   ① `rememberedScrollTop` —— 时间轴容器**内部**的纵向滚动；
 *   ② `rememberedWindowY`   —— **整个页面**的滚动（用户往下滚才看得到时间轴）。
 *
 * 为什么必须"显式记住"，而不是"什么都不做"：
 *   换周会重新排程，期间 `WeekPlanView` 先渲染骨架屏 —— **时间轴整棵被卸载**。
 *   两层的后果都实测过：
 *     · 容器卸载重建 ⟹ 其 `scrollTop` 归零；
 *     · 页面总高 1510 → **778**（骨架屏矮得多）⟹ 浏览器把 `window.scrollY`
 *       从 400 **截断**成 295，计划回来后停在 310 —— 用户的视线被整个甩走。
 *      （采样：`t=37182 h=1510 y=400 有网格` → `t=37334 h=778 y=295 无网格`
 *        → `t=37499 h=1419 y=310 有网格`）
 *
 * 为什么放**模块级**而不是 `useRef`：ref 随组件一起死 —— 而组件卸载正是
 * 最需要它的那个时刻。模块级变量在页面会话内一直活着，挂载时恢复即可。
 */
let rememberedScrollTop = 0;
let rememberedWindowY = 0;

export function WeekTimelineGrid({
  allBlocks, todayDow, dateOfDay,
  weatherByDate, adviceByDate, recentTaskIds, onDismissNew,
  planState, weekNo, assignmentByCourse, editedBlockIds,
  draggingId, preview, setDraggingId, updatePreview, clearPreview, handleDrop,
  onGapContextMenu,
  onToggleLock, onExclude, onSetAssignment, onClearAssignment, onEditBlock, onRevertEdit,
  allowEdit = true,
}: WeekTimelineGridProps) {
  const marks = gutterMarks();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /*
   * 挂载后**恢复**上次的滚动位置，并在滚动时把它记下来（见 `rememberedScrollTop` 注释）。
   *
   * ⚠️ 为什么不是"挂载时设一次就完事"：换周后时间轴是**先挂载、内容后到**
   *    （骨架屏 → 骨架下架 → 块逐个铺开）。挂载瞬间 `scrollHeight` 还很小，
   *    设 `scrollTop = 650` 会被浏览器**截断**成当时的最大值（实测 1000 → 626）。
   *    所以要看住内容高度、**持续落位**，直到它铺开或用户接手。
   *
   * ⚠️ 又为什么不能无脑重设：那会把用户的滚动抢回去。判据是
   *    **「当前位置 ≠ 我上次设的值」⟹ 用户动了**（浏览器不会把我们设的值改掉，
   *    除非锚点失效），此时立刻收手并把用户的位置记下来。
   *
   * ⚠️ 刻意**不**做「换周自动滚到日程开头」——中间试过，RAY 实测后否掉了：
   *    换周时你多半正停在下午/晚上那段，跳回顶部反而要重新滚下来。
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    /** 我上一次设进去的值；用户滚动过之后置为 `null`（收手） */
    let lastSet: number | null = rememberedScrollTop;
    let lastWin = rememberedWindowY;
    let userTook = false;

    /** 把两层都拉回记忆中的位置（各自夹到当前可滚范围内） */
    const apply = () => {
      if (userTook) return;
      // ① 时间轴容器
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      const target = Math.min(rememberedScrollTop, max);
      if (el.scrollTop !== target) {
        lastSet = target;
        el.scrollTop = target;
      }
      // ② 整个页面（骨架屏把它截断过，这里拉回去）
      const winMax = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const winTarget = Math.min(rememberedWindowY, winMax);
      if (Math.abs(window.scrollY - winTarget) > 1) {
        lastWin = winTarget;
        window.scrollTo(0, winTarget);
      }
    };
    const onInnerScroll = () => {
      if (!userTook && lastSet !== null && Math.abs(el.scrollTop - lastSet) <= 1) return; // 是我设的
      userTook = true;
      rememberedScrollTop = el.scrollTop;
    };
    /**
     * 页面滚动的记录。
     *
     * 🔴 头一道守卫不能省：**只有时间轴确实在 DOM 里时才算用户的滚动**。
     *    骨架屏期间页面变矮，浏览器会把 `scrollY` 截断（400 → 295）并**照样发
     *    一次 scroll 事件**；若把它记成"用户想要的 295"，等计划回来就再也回不到 400 了
     *    —— 那正是"位置保持不住"的元凶。用 DOM 存在性当判据，比猜时序可靠。
     */
    const onWinScroll = () => {
      if (!document.querySelector('[data-day]')) return;
      if (Math.abs(window.scrollY - lastWin) <= 1) return; // 是我设的
      rememberedWindowY = window.scrollY;
    };

    apply();
    el.addEventListener('scroll', onInnerScroll, { passive: true });
    window.addEventListener('scroll', onWinScroll, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', onInnerScroll);
      window.removeEventListener('scroll', onWinScroll);
      ro?.disconnect();
    };
  }, []);

  return (
    /* data-testid="week-timeline"：本树 E2E/量测锚（e2e-sched-session / mobile-smoke /
       week-view-model 都按它找时间轴）—— Ray 版无 testid，接入时补回同一语义锚点。 */
    <div className="panel overflow-hidden" data-testid="week-timeline">
      {/*
        外壳 = 唯一纵向滚动容器；细滚动条与块内滚动条同一视觉语言。

        高度上限（2026-10-07 RAY：课表再高一些）：原为写死的 `max-h-[72vh]` ——
        在矮窗口（约 530px 高）里只剩 ~380px 可见，而内容有 1400+px，滚动太多。
        改成**用满窗口剩余高度**：视口高 − 顶部固定条（约 6.5rem）。
        `max(20rem, …)` 是下限兜底：窗口极矮时别把课表压成一条缝。
        用内联 style 而不是 Tailwind 任意值 —— `max()/calc()` 里的逗号更容易被
        工具链吃掉，内联字符串最稳。
      */}
      <div
        ref={scrollRef}
        className="overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-ink/20 [&::-webkit-scrollbar-track]:bg-transparent"
        style={{ maxHeight: 'max(20rem, calc(100vh - 6.5rem))' }}
      >
        {/*
          ① 列头带（sticky 吸顶）。
          🔴 z 必须落在 **块 hover（z-30）与对话框（z-40）之间**（2026-10-07 修）：
            原为 `z-40` —— 与**所有**对话框同档（`AdjustDrawer` / `DeleteAskDialog` /
            `TimeAskDialog` / `GoalEditor` / `InterestAskDialog` 都是 `fixed inset-0 z-40`）。
            z 值打平后按 DOM 顺序，结果**吸顶表头画在了对话框上面** ——
            RAY 报的「点调整之后，周一到周日那一行不会被右侧侧边栏遮住」就是这个：
            那一行**没被遮住，反而浮在抽屉之上**。
          ⟹ 降到 `z-[35]`：仍高于块 hover（z-30，原注释要守的正是这条），
            又低于对话框（z-40）⟹ 5 个对话框一起修好，且不依赖 DOM 顺序。
          ⚠️ 别改回 40，也别顺手把它抬到 50 —— 那会连块浮卡/右键菜单（z-50）一起压住。
        */}
        <div className={`sticky top-0 z-[35] border-b border-ink/10 ${GRID_COLS}`}>
          {/* 左上角（与刻度列对齐的留白格） */}
          <div className="bg-white" />
          {DAY_LABELS.map((name, idx) => {
            const day = idx + 1;
            const dateISO = dateOfDay(day);
            const isToday = todayDow === day;
            const [mm, dd] = dateISO.slice(5).split('-').map(Number);
            const dayBlocks = allBlocks.filter((b) => b.dayOfWeek === day);
            const study = dayBlocks
              .filter((b) => b.kind === 'study')
              .reduce((n, b) => n + (b.endMin - b.startMin), 0);
            const wd = weatherByDate.get(dateISO);
            const adv = adviceByDate.get(dateISO);
            const range = wd && wd.tMin != null && wd.tMax != null ? `${wd.tMin}–${wd.tMax}℃` : '';
            const emoji = wd ? (wd.rainProb >= 50 ? '🌧️' : wd.rainProb >= 20 ? '⛅' : '☀️') : '';
            return (
              <div
                key={name}
                /* 🔴 回到今天的滚动锚点 —— 挂在列头（见文件头注释） */
                data-today-col={isToday ? '' : undefined}
                className={`px-1.5 pb-1.5 pt-2 text-center ${isToday ? '' : 'bg-white'}`}
                style={isToday ? { backgroundColor: TODAY_COL_BG } : undefined}
              >
                <div className="truncate text-[12.5px] font-semibold leading-tight text-ink">
                  {name}
                  <span className={`ml-1 font-mono text-[10.5px] font-normal ${isToday ? 'text-brand' : 'text-ink-faint'}`}>
                    {mm}/{dd}
                  </span>
                  {isToday && (
                    <span className="ml-1 rounded bg-brand px-[3px] py-px align-middle text-[9px] font-semibold text-white">
                      今天
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center justify-center gap-1 text-[10px] text-ink-faint">
                  <span className="truncate">{study > 0 ? `自习 ${Math.round(study / 60 * 10) / 10}h` : '\u00A0'}</span>
                  {/* 满溢度条（本树 V 批）：hover 出分类分钟详情（纯 CSS） */}
                  <SaturationBar
                    sat={daySaturation(dayBlocks, 7 * 60, 23 * 60)}
                    detail={(() => {
                      const d = dayBreakdown(dayBlocks);
                      const h = (m: number) => (m / 60).toFixed(1).replace(/.0$/, '') + 'h';
                      return ['课程 ' + h(d.courseMin), '自习 ' + h(d.studyMin), '活动 ' + h(d.activityMin), '留白 ' + h(d.blankMin)];
                    })()}
                  />
                </div>
                {/* 天气 —— 有提醒（下雨/高低温/大风）给提醒关键词，悬停看全文；
                    平常日子一行概况；没有数据（过去的日子）就不显示 —— 不猜。 */}
                {adv ? (
                  <div
                    title={adv.detail}
                    className={`mt-0.5 truncate rounded border-l-2 px-1 text-left text-[10px] leading-[1.35] ${
                      adv.severity === 'warn'
                        ? 'border-warn/40 bg-warn-light text-warn-text'
                        : 'border-ink/15 bg-paper text-ink-soft'
                    }`}
                  >
                    {adv.emoji} {adv.label}
                  </div>
                ) : wd ? (
                  <div title={`${wd.text} ${range}`} className="mt-0.5 truncate text-[10px] text-ink-soft">
                    {emoji} {wd.text} {range}
                  </div>
                ) : (
                  <div className="mt-0.5 text-[10px]">&nbsp;</div>
                )}
              </div>
            );
          })}
        </div>

        {/* ② 主体带：刻度列 + 七条泳道 */}
        <div className={GRID_COLS}>
          <div className="relative bg-white" style={{ height: AXIS_HEIGHT }}>
            {marks.map((m) => (
              <span
                key={m.min}
                className="absolute right-1.5 -translate-y-1/2 font-mono text-[10px] text-ink-faint"
                style={{ top: m.y }}
              >
                {m.label}
              </span>
            ))}
          </div>
          {DAY_LABELS.map((name, idx) => (
            <WeekDayColumn
              key={name}
              day={idx + 1}
              allBlocks={allBlocks}
              todayDow={todayDow}
              dateISO={dateOfDay(idx + 1)}
              recentTaskIds={recentTaskIds}
              onDismissNew={onDismissNew}
              planState={planState}
              weekNo={weekNo}
              assignmentByCourse={assignmentByCourse}
              editedBlockIds={editedBlockIds}
              draggingId={draggingId}
              preview={preview}
              setDraggingId={setDraggingId}
              updatePreview={updatePreview}
              clearPreview={clearPreview}
              handleDrop={handleDrop}
              onGapContextMenu={(gap, clickedMin, pos) => onGapContextMenu(idx + 1, gap, clickedMin, pos)}
              onToggleLock={onToggleLock}
              onExclude={onExclude}
              onSetAssignment={onSetAssignment}
              onClearAssignment={onClearAssignment}
              onEditBlock={onEditBlock}
              onRevertEdit={onRevertEdit}
              allowEdit={allowEdit}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
