/**
 * 时间轴块卡片（F2d/A5 拆出的第 ① 个纯展示子组件 · 前端架构规格书 §8.1）
 * ============================================================
 * 从 `WeekPlanView.tsx` 原样搬出：一块日程卡（课程/三餐/自习/活动/用户块），
 * 含定住 / 删除 / 作业标记 / 块级编辑 / 拖拽源与 🆕 标注。
 * 纯展示：不取数、不重排 —— 所有变更都经由回调上抛（交互态留在视图）。
 *
 * ── T3 改造（七列时间轴 · 2026-10-07）─────────────────────────
 * ① 外壳 `h-full` 填满「时长 × PPM」的块高，内容放不下时**块内滚动**
 *    （原生滚轮，零 JS 干预）；底边一条 12px 渐隐提示「下面还有」，滚到底
 *    自动淡出；右侧 5px 细滚动条。块高由外层写死 —— 本组件**不许撑高**
 *    （RAY 拍板：块高严格守时，跨列可比高低）。
 *    渐隐为什么不用原型那套「两层 background-attachment」：那个方案必须把
 *    块底色作为 CSS 变量传进去，而块底色是 Tailwind 类名（无 hex），加一份
 *    hex 就是多一处真相源。独立渐隐层 + 半透明黑（与原型渐隐同色系）+ JS
 *    切 opacity —— 颜色无关、零真相源。
 * ② 编辑/作业面板**浮出块外**：块高守时后 75px 的块塞不下表单。
 *    「改时间、地点」面板（EditBlockPanel）自 2026-10-07 起**不再挂块下方** ——
 *    改为 fixed 浮在**右键菜单原位置**、可拖动（RAY 拍板；见组件内 editPos 注释）；
 *    只有作业输入条仍留在块下方（`top-full` 纵向展开，块容器 position:absolute
 *    是它的定位祖先，不受滚动区/泳道裁剪）。
 * ③ `live`：今天 + 此刻进行中的块整块高亮（原型定案：替代横贯七列的红线）。
 * ④ 2026-10-07 RAY 反馈三件事（同日落地）：
 *    · 滚动条**隐藏**（`[scrollbar-width:none]` + `::-webkit-scrollbar: hidden`）——
 *      「每个日程块右侧的滚轮隐藏」；滚轮功能保留（overflow-y-auto 不动）。
 *    · **悬停浮出完整卡**（`peek`）：「30 分钟窄块无法显示全部信息」的解法 ——
 *      仅当内容**装不下**（scrollHeight > clientHeight，RO 实时判定）时，悬停块 →
 *      下方浮出一张白卡展示全量内容（标题/时间/地点/转场/理由，**不截断**）；
 *      移开即淡出。⚠️ 浮卡不做交互（pointer-events-none）——操作按钮仍走块内滚动。
 *    · **理由行抑制**（`isSuppressedReason`）：自习块的「阶段策略：…」与长目标
 *      （goalDecompose）的注记（「定向周 · …」「… · 本周预算 …」等）不再显示。
 *      ⚠️ 只控制**显示**：`block.reason` 数据仍在（规格书 QL-2 要求 100% 软块有 reason）。
 * ⑤ 操作另备**右键菜单**（2026-10-07 RAY 要求；桌面端会话先做，同日合并进落地版）：
 *    块上右键 → 「🔒 定住 / ✏️ 改 / 📝 作业 / 🗑 删除」（点外部 / Esc / 滚动 /
 *    resize 关闭，坐标打开时夹回视口）；另有 hover 浮现的 ⋯ 按钮作等价入口
 *    （触摸设备没有右键）。⚠️ 与块内按钮行**并存**（双入口；菜单只放高频四项，
 *    按钮行仍是全量入口 —— 含 T2.0 的 ✓做了/✗没做/⏱记用时）。
 *    ⚠️ 菜单开着时浮卡让位（`!menu`）：右键不移动鼠标，peek 仍真，两层白卡
 *    会同时出现在块下方打架。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimeBlock } from '@/types';
import { toHHmm } from '@/constants/time';
import { kindCls, paletteOf, KIND_PALETTE } from '@/constants/chartColors';
import { EditBlockPanel } from './EditBlockPanel';
import {
  findStatus, loadRecords, makeId, markBlock, saveRecords,
  type BehaviorStatus,
} from '@/features/behavior/behaviorLog';

/**
 * 「内容装不下 ⟹ 悬停浮卡」的**溢出门槛**（px）。
 *
 * 为什么需要它（2026-10-07 修 RAY 报的「块重叠」）：
 *   浮卡是 `absolute top-full z-50` —— 它**浮在块体下方**，所以必然盖住下面的邻块。
 *   原先门槛是「超出 1px 就浮」，结果是**过半的块**（实测某周 56/94 块）一悬停就弹浮层，
 *   在窄列（约 79px）里那张卡又窄又高，看上去就像「两块串行重叠」。
 * ⟹ 只有明显装不下（约 1.5 行 ≈ 16px）才值得浮卡；轻微溢出让用户用块内滚动看。
 */
const FLOAT_OVERFLOW_MIN_PX = 16;

/**
 * 类别 → 外观样式。
 *
 * 🔴 2026-10-07 起**不再在本文件定义**：原先这里是七套硬编码的 Tailwind 内置色
 * （蓝色系/琥珀系/绿系/紫系/粉系/灰系各两档），与 `constants/chartColors.ts` 的
 * SPECTRUM 并存，是两套真相源 —— 加类别要改两处、换品牌色会漏掉这里、
 * 且内置色从未核对对比度。现已收口到 `chartColors.KIND_PALETTE` + safelist。
 *
 * 为何收口在 `chartColors.ts`（既有的「数据色唯一来源」）：本文件是**纯展示**，
 * 而 `chartColors.ts` 是中立常量层，不 import react、不碰存储 —— 两边都满足。
 */
export const KIND_STYLE: Record<string, { bg: string; text: string; label: string }> =
  Object.fromEntries(
    Object.entries(KIND_PALETTE).map(([k, p]) => [
      k,
      { bg: `${p.wash} ${p.line}`, text: p.text, label: p.label },
    ]),
  ) as Record<string, { bg: string; text: string; label: string }>;

/** 同上，但给出整串类（含文字色）—— 新代码用这个。 */
export function kindClsOf(kind: string): string {
  return kindCls(kind as Parameters<typeof kindCls>[0]);
}

/**
 * 这些「理由」文案不显示（T3 · 2026-10-07 RAY 反馈）。
 *
 * 两类（都是**显示层面**的抑制，数据不动 —— 规格书 QL-2 要求 100% 软块有 reason）：
 *   · 自习块：`explain.ts::reasonForStudy` 的「阶段策略：单块不超过 X 分钟…」
 *     —— RAY：「自习块不需要写阶段策略，为什么要写？」
 *   · 长目标（`goalDecompose.ts` 产出的 note）：每块重复同一句 ——
 *     RAY：「长目标安排不要重复写……之后会重做，先删去」
 *     （「定向周 · …」「本周复盘 · …」「你的目标 · …」「{动作} · 本周预算 …」）
 *
 * ⚠️ 文案清单与 goalDecompose/explain 的字符串耦合：长目标重做 / 换文案时同步更新。
 */
export function isSuppressedReason(reason: string | undefined): boolean {
  if (!reason) return false;
  if (reason.startsWith('阶段策略')) return true;      // explain.ts · 自习块
  if (reason.startsWith('定向周 · ')) return true;     // goalDecompose · Q4 定向周
  if (reason.startsWith('本周复盘 · ')) return true;   // goalDecompose · Q4 复盘
  if (reason.startsWith('你的目标 · ')) return true;   // goalDecompose · 目标注记
  return reason.includes(' · 本周预算 ');              // goalDecompose · `${slot.action} · 本周预算 …`
}

export function BlockCard({
  block, date, weekNo, locked, onToggleLock, onExclude,
  assignmentMin, onSetAssignment, onClearAssignment,
  edited, onEditBlock, onRevertEdit,
  dragging, live, onDragStartCard, onDragEndCard,
  isNew, onDismissNew, floatLeft, dayBlocks,
}: {
  block: TimeBlock;
  /** 这个块所属的 ISO 日期 —— 行为标记（T2.0）与无障碍标注共用 */
  date: string;
  /** 本周周次 —— 行为标记记录的 weekNo 字段（adherence / 顺延都按周聚合） */
  weekNo: number;
  /** 用户已把这块「定住」 */
  locked: boolean;
  /**
   * 悬停详情浮卡弹向：`true` = 朝**左**弹（给右半周那几列用），缺省朝右。
   *
   * 为什么要分向（2026-10-07）：浮卡比块宽（`w-56`），全部朝右弹会让最右列的卡溢出时间轴。
   * 更关键的是它**弹在块的侧面**而不是下方 —— 见浮卡处的注释。
   */
  floatLeft?: boolean;
  /**
   * 同一天的**全部**块（含自己）—— 供「改这块」面板做**碰撞校验**用（2026-10-07 补）。
   *
   * 为什么不传「其它块」而是传全天：让过滤（去掉自己、只留同一天）只有**一处**实现，
   * 避免调用方各自写一遍、迟早写歪。缺省 `undefined` = 不校验（保持向后兼容）。
   */
  dayBlocks?: readonly TimeBlock[];
  onToggleLock: (block: TimeBlock) => void;
  /**
   * 「🗑 删除这块」。
   * 语义：把它从计划里拿掉，重排也不会回来（走 `excluded` 通道，可「全部恢复」）。
   * 课程块不给：课是既成事实，改课走「调课」。
   */
  onExclude: (block: TimeBlock) => void;
  /** T6：这门课本周已标记的作业时长（分钟）；`undefined` = 没标 */
  assignmentMin?: number;
  onSetAssignment: (courseId: string, courseTitle: string, minutes: number) => void;
  onClearAssignment: (courseId: string) => void;
  /** R2：本周用户是否改过这块的位置（改时间/时长/地点） */
  edited?: boolean;
  /** R2：保存块级编辑（同日改；跨天是拖拽的事） */
  onEditBlock: (block: TimeBlock, next: { startMin: number; endMin: number; place?: string }) => void;
  /** R2：撤销对这块的改动，回到引擎安排 */
  onRevertEdit: (block: TimeBlock) => void;
  /** R1：正在被拖动（自己变淡，看得出手里拿的是哪块） */
  dragging: boolean;
  /** T3：今天 + 此刻进行中（整块高亮；由泳道按 nowMinutes 判定后传入） */
  live?: boolean;
  onDragStartCard: (block: TimeBlock) => void;
  onDragEndCard: () => void;
  /** 🆕 新日程标注（2026-09-19）：刚添加的事在日程里高亮，点击后消失 */
  isNew?: boolean;
  onDismissNew?: () => void;
}) {
  /**
   * T6 的展开状态：点「📝 作业」后才显示时长输入框。
   * 用局部 state 而不是提到父组件 —— 它是**纯 UI 状态**，
   * 放上去只会让父组件的 state 又多一个，还多一层 props 传递。
   */
  const [asgOpen, setAsgOpen] = useState(false);
  const [asgMin, setAsgMin] = useState(60);
  /** R2：块级编辑面板（见下方 editPos 注释；「改」从右键菜单点开） */
  /**
   * 「改时间、地点」面板的**浮动位置**（2026-10-07 RAY 拍板）：从右键菜单点
   * 「改」后面板不再展开在块下方，而是 fixed 弹在**原右键菜单处**，可拖动。
   * null = 关。编辑中滚动页面会带着走（fixed）——这是刻意选择：面板跟着
   * 光标上下文，不被块下方空间/邻块挤占。
   */
  const [editPos, setEditPos] = useState<{ x: number; y: number } | null>(null);
  /** 拖动手柄的按下偏移（拖动中有效）；配合 document 级 mousemove/mouseup */
  const editDrag = useRef<{ dx: number; dy: number } | null>(null);
  /**
   * T2.0（长计划增强计划书）：执行标记 —— 操作行「✓ 做了 / ✗ 没做」的本地回显。
   * 初始值读一次存储；写走 `markBlock`（覆盖同块同天）。只有 study/activity 可标
   * （course/meal/commute 是既成事实，blank 无所谓做没做）。
   * 「记实际用时」用 window.prompt：块高守时的 T3 卡里塞不下内联输入框。
   */
  const markable = block.kind === 'study' || block.kind === 'activity';
  const [mark, setMark] = useState<BehaviorStatus | undefined>(() =>
    markable ? findStatus(loadRecords(), block.id, date) : undefined);
  const [actual, setActual] = useState<number | undefined>(() => {
    if (!markable) return undefined;
    const rec = loadRecords().find((r) => r.id === makeId(block.id, date));
    return rec?.actualMin;
  });

  /** 写侧：覆盖同块同天；取消 = 移除记录（不留半条） */
  const applyMark = (status: BehaviorStatus | null) => {
    if (status == null) {
      saveRecords(loadRecords().filter((r) => r.id !== makeId(block.id, date)));
      setMark(undefined);
      setActual(undefined);
      return;
    }
    markBlock({
      blockId: block.id, date, weekNo,
      kind: block.kind, title: block.title,
      plannedMin: block.endMin - block.startMin,
      status,
    });
    setMark(status);
    if (status !== 'done') setActual(undefined);
  };
  const applyActual = (min: number) => {
    markBlock({
      blockId: block.id, date, weekNo,
      kind: block.kind, title: block.title,
      plannedMin: block.endMin - block.startMin,
      status: 'done', actualMin: min,
    });
    setActual(min);
  };
  /**
   * 右键菜单（见文件头 T3 改造 ⑤）：`menu` = 菜单左上角视口坐标；null = 关。
   * 纯 UI 状态。合并自桌面端会话的「块操作收进右键菜单」改造。
   */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  /** 打开菜单并夹回视口内（按 ~208×176 估菜单尺寸，防贴右边/底边溢出） */
  const openMenu = (x: number, y: number) => {
    setMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 208)),
      y: Math.max(8, Math.min(y, window.innerHeight - 176)),
    });
  };
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);
  /** 编辑面板的拖动（手柄 mousedown 起跳，document 级跟随，松手即卸） */
  const startEditDrag = (e: React.MouseEvent) => {
    if (!editPos) return;
    e.preventDefault(); // 不抢输入框焦点也能拖；同时防文本选中
    editDrag.current = { dx: e.clientX - editPos.x, dy: e.clientY - editPos.y };
    const PANEL_W = 288; // w-72，拖动中夹回视口
    const onMove = (ev: MouseEvent) => {
      const d = editDrag.current;
      if (!d) return;
      setEditPos({
        x: Math.max(0, Math.min(ev.clientX - d.dx, window.innerWidth - PANEL_W)),
        y: Math.max(0, Math.min(ev.clientY - d.dy, window.innerHeight - 80)),
      });
    };
    const onUp = () => {
      editDrag.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
  /* 编辑面板 Esc 关闭（与右键菜单同一纪律；不挂「点外部关闭」——
     误点丢表单比多点一次「取消」更烦人） */
  useEffect(() => {
    if (!editPos) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditPos(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editPos]);
  const style = KIND_STYLE[block.kind] ?? KIND_STYLE.blank;
  const t = block.transfer;
  // 校历事件展开出来的准备块（光电杯材料、四六级真题…）单独标出来 ——
  // 否则用户只看到「又一个活动块」，意识不到它和那个截止日有关
  const isEvent = Boolean(block.fromEventId);
  // 课程块是既成事实：不给「删 / 改」，改课走「调课」（R3）—— 右键菜单的
  // 「改 / 删除」项用这个条件（与按钮行、拖拽的内联判断同一口径）
  const editable = block.kind !== 'course' && block.source !== 'course';

  /** 滚动区 / 内容层 / 渐隐层（见文件头 T3 改造 ①） */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const shadeRef = useRef<HTMLDivElement | null>(null);
  /**
   * ④ 悬停浮出完整卡：`peek` = 鼠标在本块上；`overflowing` = 内容装不下（RO 实时判）
   *
   * ⚠️ `overflowing` 的**触发门槛**（2026-10-07 修）：见 `FLOAT_OVERFLOW_MIN_PX`。
   *    它不只是一个布尔，门槛定低了会让**过半的块**一悬停就弹浮层。
   */
  const [peek, setPeek] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  /**
   * 底部渐隐同步：内容超出块高时显示、滚到底时隐藏。
   * 「装得下」的块天然满足 `atBottom`（scrollTop 0 + clientHeight ≥ scrollHeight）
   * ⟹ 同一表达式自动把「不可滚」也归到隐藏，不需要第二条判断。
   *
   * ④ 同日增加「装不下」判定（决定浮卡是否启用）：与渐隐同一数据源（scrollHeight
   * vs clientHeight），在同一个 RO 回调里顺手算掉，不另挂观察器。React 对「同值
   * setState」直接跳过重渲染 —— 不会形成循环。
   */
  const syncShade = useCallback(() => {
    const el = scrollRef.current;
    const sh = shadeRef.current;
    if (!el || !sh) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    sh.style.opacity = atBottom ? '0' : '1';
    setOverflowing(el.scrollHeight > el.clientHeight + FLOAT_OVERFLOW_MIN_PX);
  }, []);

  /**
   * 挂载后先同步一次；之后的内容变化（转场/理由晚到、列宽变化）走 ResizeObserver
   * 兜住 —— 观察「滚动容器」与「内容层」两个：前者管尺寸变化（列宽），
   * 后者管内容高度变化。直接操作 DOM style 而不上 state：渐隐是纯视觉增强，
   * 不参与 React 渲染；也顺带躲开「React 重渲染覆盖 classList」的坑。
   */
  useEffect(() => {
    syncShade();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(syncShade);
    ro.observe(el);
    if (innerRef.current) ro.observe(innerRef.current);
    return () => ro.disconnect();
  }, [syncShade]);

  return (
    <>
      <div
        draggable={editable}
        onMouseDown={(e) => {
          // 🔴 抓块时冻结页面惯性滚动（2026-09-20）：滚动进行中浏览器会把
          //    「拖」判成「滚」而取消 dragstart —— 「有时拖不动」的机制①。
          if (e.button === 0) window.scrollTo(window.scrollX, window.scrollY);
        }}
        onDragStart={(e) => {
          // dataTransfer 里带 id 是给**跨天**用的：目标列靠它知道拖过来的是哪一块
          e.dataTransfer.setData('text/plain', block.id);
          e.dataTransfer.effectAllowed = 'move';
          console.debug('[drag] start', block.id); // 诊断：拖不动时看这条是否出现
          onDragStartCard(block);
        }}
        onDragEnd={onDragEndCard}
        onContextMenu={(e) => {
          // 右键菜单（见文件头 T3 改造 ⑤）：拦掉浏览器默认菜单，换成自己的
          //（⋯ 按钮走同一入口）
          e.preventDefault();
          openMenu(e.clientX, e.clientY);
        }}
        title={dragging ? '松手放到目标位置；拖到右侧投放区可删除' : '可以直接拖到别的天 / 别的时段；右键可打开操作菜单'}
        onClick={() => { if (isNew && onDismissNew) onDismissNew(); }}
        onMouseEnter={() => setPeek(true)}
        onMouseLeave={() => setPeek(false)}
        className={`group relative h-full overflow-hidden rounded-lg border-l-4 ${style.bg} ${isEvent ? 'ring-1 ring-purple-300' : ''} ${dragging ? 'opacity-50 ring-2 ring-brand' : ''} ${isNew ? 'ring-2 ring-green-400' : ''} ${live ? 'ring-2 ring-brand' : ''} ${editable ? 'cursor-grab' : ''}`}
      >
        {/* 块内滚动区（见文件头 T3 改造 ①）：内容装不下时原生滚轮上下滚，
            滚到底后继续滚会链式交给外层时间轴（浏览器原生行为）。
            🔴 内边距对齐原型定案（4px 8px）：影子构建真机实测 58/66 块溢出，
            收紧后 30 分钟块（37.5px）正好放得下「标题 + 时间」两行 —— 这是
            「一眼可读」的底线，短块再多一行内容就交给块内滚动。 */}
        <div
          ref={scrollRef}
          onScroll={syncShade}
          className="h-full overflow-y-auto px-2 py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          <div ref={innerRef}>
            {/* 标题行 + 时间行（原型定案的两行结构）。为什么拆两行：
                154px 窄列里「标题+时间」同行会挤压长标题 —— 12px 字 ×8 字
                + 时间 66px ≈ 170px > 可用 ~130px。拆开后 30 分钟块（37.5px）
                正好放得下这两行，是「一眼可读」的底线。 */}
            <div title={block.title} className={`min-w-0 truncate text-[12px] font-semibold leading-tight ${style.text}`}>
              {locked && <span title="已定住：重排时不动">🔒 </span>}
              {block.emoji ? `${block.emoji} ` : ''}{block.title}
              {isNew && <span className="ml-1 rounded bg-green-600 px-1 align-middle text-[9px] text-white">🆕 新</span>}
            </div>
            {/* 时间行 + ⋯（右键菜单的「看得见的入口」，见文件头 T3 改造 ⑤）。
                触摸设备没有右键 —— 这个按钮是那类用户唯一入口，不能只靠 title
                提示。⋯ 与时间同行（不挤标题行）：154px 窄列里标题行整行留给标题。 */}
            <div className="flex items-center justify-between gap-1">
              <span className="min-w-0 truncate font-mono text-[10.5px] leading-tight text-ink-faint">
                {toHHmm(block.startMin)}–{toHHmm(block.endMin)}
                {/* 顺势分（长计划增强计划书 §1.2）：与时间同行，零额外行高 */}
                {block.score != null && markable && <span className="text-ink-soft"> · {Math.round(block.score * 100)}% 顺势</span>}
              </span>
              <button
                type="button"
                aria-label={`${block.title}：更多操作（与右键同一张菜单）`}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  openMenu(r.right - 208, r.bottom + 4);
                }}
                className="shrink-0 rounded px-1 text-[12px] leading-none text-ink-faint opacity-0 transition-opacity hover:bg-white/80 hover:text-ink-soft group-hover:opacity-100 focus-visible:opacity-100"
              >
                ⋯
              </button>
            </div>
            {mark === 'done' && (
              <div className="mt-0.5 inline-block rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                ✓ 已做{actual != null ? ` · 实际 ${actual} 分` : ''}
              </div>
            )}
            {mark === 'skipped' && (
              <div className="mt-0.5 inline-block rounded bg-slate-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                ✗ 没做
              </div>
            )}
            {/* 🔴 原「已定住 · 重排时不会挪动」块内灰条已删（T3 块高守时）：
                它常显占 ~20px，在 30 分钟块（37.5px）里会吃掉半个标题。锁定状态
                有三处常显位置承载：标题前 🔒 + 锁定按钮「🔒 已定住」（常显）+ 悬停
                title「已定住：重排时不动」—— 信息不减，只是不再占一行高。 */}
            {isEvent && (
              /* 🔵 用**中性色**不用紫色：紫色已代表 activity 类别（自习/活动/运动），
                 校历事件徽标若也用紫 = 两件无关的事撞同一个色，读起来像"这也是个活动"。
                 徽标表达的是「这个块有来历」，不是「它属于哪一类」。 */
              <div className="mt-0.5 inline-block rounded bg-ink/5 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft ring-1 ring-ink/10">
                校历事件 · 提前准备
              </div>
            )}
            {/*
             * 地点 —— 标题里已经说了就不再重复（T5）。
             * 例：「第一食堂 🍚 / @第一食堂」纯属噪音；重复信息会淹没真正要看的时刻。
             *
             * 🔴 2026-10-07：**用餐块一律不显示地点**（RAY 要求）。一周七顿、同一家
             * 食堂重复七次 = 占一行高度却零信息量。要换食堂走「⚙️ 调整 → 指定食堂」。
             * ⚠️ 只是**不显示**，绝不删 `block.place` —— 转场计算、食堂偏好与
             * `mealPlaces` 指定逻辑都依赖它（与 construct.ts:724 的 T2 决策同向：
             * 「标题只留餐次 —— 地点不由引擎决定」；T2 只清了标题里的拼接，
             * 这里把 place 的渲染也一并收掉）。
             */}
            {block.place && block.kind !== 'meal' && !block.title.includes(block.place) && (
              <div className="mt-0.5 truncate text-[10.5px] leading-tight text-ink-soft">
                @{block.place}{block.room ? ` ${block.room}` : ''}
              </div>
            )}
            {t && (
              <div className={`mt-0.5 text-[10.5px] leading-tight ${t.tight ? 'rounded bg-white/70 px-1 py-px text-red-700' : 'text-ink-soft'}`}>
                🚶 {t.fromPlace} → {t.toPlace}：{t.minutes} 分钟
                （余 {t.slackMin}{t.tight ? ' · 紧' : ''}）
              </div>
            )}
            {/* 💡 理由行 —— `isSuppressedReason` 拦掉自习块「阶段策略」与长目标注记
                （2026-10-07 RAY 反馈；数据不动、只是不显示，见函数注释）。 */}
            {block.reason && !isSuppressedReason(block.reason) && (
              <div className="mt-0.5 text-[10.5px] leading-tight text-ink-faint">💡 {block.reason}</div>
            )}

            {/* 块内操作按钮行已于 2026-10-07 **整行删除**（RAY：功能都进右键菜单了）。
                原「🔒定住 / ✓做了 / ✗没做 / ⏱记用时 / 📝作业 / 🗑删除 / ✏️改」
                全部改由**右键菜单**（或块右侧的 ⋯ 按钮）承载 —— 菜单里一个都不能少，
                少一个就等于该功能没入口（见菜单数组里的注释）。
                ⟹ 块体因此只剩内容，溢出块的滚动高度也随之下降。 */}
          </div>
        </div>

        {/* 底边渐隐：提示「下面还有内容」，滚到底自动淡出（见 syncShade）。
            z 不设 —— 盖在滚动区上靠 DOM 顺序即可（渐隐层在滚动区之后）。 */}
        <div
          ref={shadeRef}
          style={{ opacity: 0 }}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t from-black/[0.10] to-transparent transition-opacity duration-150"
        />
      </div>

      {/* ④ 悬停浮出完整卡（见文件头 T3 改造 ④）——
          仅「装不下」的块才有（overflowing）；纯展示不拦指针（pointer-events-none）；
          淡入淡出用 opacity（常挂载，避免扫过块群时闪现硬切）。
          ⚠️ 编辑/作业面板打开时让位（同一浮出位置，两层白卡会打架）。
          ⚠️ 右键菜单开着时也让位（右键不移动鼠标，peek 仍真 —— 见文件头 ⑤）。
          ⚠️ 内容与块内同一数据源、展示口径不同（不截断、行距更舒展）——
             改块内容行时两处要一起改。 */}
      {overflowing && (
        <div
          /* 🔴 弹在块的**侧面**（`left-full` / `right-full`），**不再弹在下方**（2026-10-07 修）。
             原因：弹在下方（原 `top-full`）必然**纵向盖住同一列的下一个块** ——
             在「时间是纵轴」的时间轴里，看起来就是「两块重叠/串行」，让人怀疑引擎排错了。
             弹到侧面只横向遮到邻列，**同一列的时间轴完全不被遮挡**，误读消失。
             宽度 `w-56`（比块宽 ⟹ 一眼是浮层）；朝向由 `floatLeft` 按列位置给。 */
          className={`pointer-events-none absolute top-0 z-50 w-56 max-w-[70vw] ${floatLeft ? 'right-full mr-1.5' : 'left-full ml-1.5'} rounded-lg border border-brand/25 bg-white p-2 shadow-xl ring-1 ring-brand/20 transition-opacity duration-150 ${peek && !dragging && !editPos && !asgOpen && !menu ? 'opacity-100' : 'opacity-0'}`}
        >
          {/* 浮层标识：把「悬停详情」和「日程块」明确区分开 */}
          <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-brand/60">
            详情预览
          </div>
          <div className={`text-[12px] font-semibold leading-snug ${style.text}`}>
            {locked && <span title="已定住：重排时不动">🔒 </span>}
            {block.emoji ? `${block.emoji} ` : ''}{block.title}
            {isNew && <span className="ml-1 rounded bg-green-600 px-1 align-middle text-[9px] text-white">🆕 新</span>}
          </div>
          <div className="font-mono text-[10.5px] leading-tight text-ink-faint">
            {toHHmm(block.startMin)}–{toHHmm(block.endMin)}
          </div>
          {isEvent && (
            <div className="mt-0.5 inline-block rounded bg-ink/5 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft ring-1 ring-ink/10">
              校历事件 · 提前准备
            </div>
          )}
          {block.place && block.kind !== 'meal' && !block.title.includes(block.place) && (
            <div className="mt-0.5 text-[10.5px] leading-snug text-ink-soft">
              @{block.place}{block.room ? ` ${block.room}` : ''}
            </div>
          )}
          {t && (
            <div className={`mt-0.5 text-[10.5px] leading-snug ${t.tight ? 'rounded bg-white/70 px-1 py-px text-red-700' : 'text-ink-soft'}`}>
              🚶 {t.fromPlace} → {t.toPlace}：{t.minutes} 分钟
              （余 {t.slackMin}{t.tight ? ' · 紧' : ''}）
            </div>
          )}
          {block.reason && !isSuppressedReason(block.reason) && (
            <div className="mt-0.5 text-[10.5px] leading-snug text-ink-faint">💡 {block.reason}</div>
          )}
        </div>
      )}

      {/* R2：块级编辑面板 —— **浮动在右键菜单原位置**（2026-10-07 RAY 拍板）：
          fixed 定位、带拖动手柄（按住标题条拖动，夹回视口）、Esc/取消关闭。
          不再展开在块下方 —— 块高守时后下方空间不可靠，且会被相邻块遮挡。
          （作业输入仍走块下方内联条，与编辑面板天然互斥。） */}
      {editPos && editable && (
        <div
          role="dialog"
          aria-label={`改 ${block.title} 的时间、地点`}
          style={{ left: editPos.x, top: editPos.y }}
          className="fixed z-50 w-72 rounded-lg bg-white p-2 shadow-xl ring-1 ring-ink/10"
        >
          <div
            onMouseDown={startEditDrag}
            title="按住拖动面板"
            className="mb-1.5 flex cursor-move select-none items-center justify-between rounded-md bg-slate-100 px-2 py-1"
          >
            <span className="truncate text-[11px] font-semibold text-ink-soft">
              ✏️ 改「{block.title}」
            </span>
            <span className="text-[10px] text-ink-faint">⠿ 拖动</span>
          </div>
          <EditBlockPanel
            block={block}
            edited={edited ?? false}
            /* 碰撞校验用的「同日其它块」——过滤只此一处，调用方只管把当天的块递进来 */
            occupied={(dayBlocks ?? [])
              .filter((x) => x.id !== block.id && x.dayOfWeek === block.dayOfWeek)
              .map((x) => ({ id: x.id, title: x.title, startMin: x.startMin, endMin: x.endMin }))}
            onSave={(next) => { onEditBlock(block, next); setEditPos(null); }}
            onRevert={() => { onRevertEdit(block); setEditPos(null); }}
            onCancel={() => setEditPos(null)}
          />
        </div>
      )}

      {/* T6：作业时长输入 —— **用户自己填**，不给「智能默认」。
          输入框里的 60 只是个起点，确认前用户能看到并改掉。
          （与编辑面板天然互斥：作业只课程块有、编辑只非课程块有。） */}
      {asgOpen && block.kind === 'course' && block.courseId && (
        <div className="absolute inset-x-0 top-full z-50 mt-1.5 flex flex-wrap items-center gap-1.5 rounded-md bg-indigo-50 px-2 py-1.5 text-[11px] text-indigo-900 shadow-sm ring-1 ring-indigo-200">
          <span>这门课的作业要多久？</span>
          <input
            type="number"
            min={10}
            max={600}
            step={10}
            value={asgMin}
            onChange={(e) => setAsgMin(Number(e.target.value))}
            className="w-16 rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-[11.5px]"
          />
          <span>分钟</span>
          <button
            type="button"
            onClick={() => {
              onSetAssignment(block.courseId as string, block.title, asgMin);
              setAsgOpen(false);
            }}
            className="rounded bg-indigo-700 px-2 py-0.5 text-[11px] font-medium text-white"
          >
            记下
          </button>
          {assignmentMin != null && (
            <button
              type="button"
              onClick={() => { onClearAssignment(block.courseId as string); setAsgOpen(false); }}
              className="rounded bg-white px-2 py-0.5 text-[11px] text-indigo-900 ring-1 ring-indigo-300"
            >
              取消标记
            </button>
          )}
        </div>
      )}

      {/*
       * 右键菜单本体（见文件头 T3 改造 ⑤）：fixed 在光标处（坐标打开时已夹回
       * 视口）。「改」点完后菜单关掉、编辑面板浮在**原菜单位置**（可拖动）；
       * 「作业」点完后内联输入条在块下方展开。fixed 定位不受祖先 overflow 裁剪，
       * 但会被祖先 transform 劫持 —— 周计划页容器没有 transform（已核查），安全。
       */}
      {menu && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`${block.title} 的操作`}
          style={{ left: menu.x, top: menu.y }}
          className="fixed z-50 w-52 rounded-lg bg-white py-1 shadow-xl ring-1 ring-ink/10"
        >
          {([
            {
              key: 'lock',
              label: locked ? '🔓 解除定住' : '🔒 定住这块',
              danger: false,
              run: () => onToggleLock(block),
            },
            /* T2.0 执行标记（2026-10-07 从块内按钮行**搬进菜单**）：
               块内那行已按 RAY 要求删除，功能必须在这里有 —— 否则「做了/没做/记用时」
               就彻底没入口了（顺延/估时学习都吃这份数据）。
               已标记时菜单项文案反映当前状态，点一下即取消。 */
            ...(markable
              ? [
                  {
                    key: 'done',
                    label: mark === 'done' ? '✓ 取消「做了」标记' : '✓ 标记「做了」',
                    danger: false,
                    run: () => applyMark(mark === 'done' ? null : 'done'),
                  },
                  {
                    key: 'skipped',
                    label: mark === 'skipped' ? '✗ 取消「没做」标记' : '✗ 标记「没做」',
                    danger: false,
                    run: () => {
                      if (mark === 'skipped') { applyMark(null); return; }
                      const raw = window.prompt('实际用了多少分钟？（直接回车 = 只记「没做」，取消 = 不改）', '');
                      if (raw == null) { applyMark('skipped'); return; }
                      applyMark('skipped');
                      const v = Number.parseInt(raw, 10);
                      if (Number.isFinite(v) && v > 0) applyActual(v);
                    },
                  },
                  ...(mark === 'done'
                    ? [{
                        key: 'actual',
                        label: `⏱ ${actual != null ? `记用时（现 ${actual} 分）` : '记实际用时'}`,
                        danger: false,
                        run: () => {
                          const raw = window.prompt('实际用了多少分钟？', actual != null ? String(actual) : String(block.endMin - block.startMin));
                          if (raw == null) return;
                          const v = Number.parseInt(raw, 10);
                          if (Number.isFinite(v) && v > 0) applyActual(v);
                        },
                      }]
                    : []),
                ]
              : []),
            ...(editable
              ? [{
                  key: 'edit',
                  label: edited ? '✏️ 再改 / 恢复引擎安排' : '✏️ 改时间、地点',
                  danger: false,
                  // 面板弹在原菜单位置（menu 坐标打开时已夹回视口）——RAY 2026-10-07
                  run: () => setEditPos(menu ? { x: menu.x, y: menu.y } : { x: 8, y: 8 }),
                }]
              : []),
            ...(block.kind === 'course' && block.courseId
              ? [{
                  key: 'asg',
                  label: assignmentMin != null ? `📝 作业标记（现 ${assignmentMin} 分）` : '📝 标记作业',
                  danger: false,
                  run: () => setAsgOpen(true),
                }]
              : []),
            ...(editable
              ? [{ key: 'del', label: '🗑 删除这块', danger: true, run: () => onExclude(block) }]
              : []),
          ] as { key: string; label: string; danger: boolean; run: () => void }[]).map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              onClick={() => { it.run(); setMenu(null); }}
              className={`block w-full px-3 py-1.5 text-left text-[12px] font-medium ${
                it.danger ? 'text-red-700 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
