/**
 * 周计划页 · 待生效状态条（2026-10-07 · 提案第 7 条）
 * ============================================================
 * 要解决的问题：T3「攒批」语义的关键反馈原先混在操作条里，是一个小黄字标签：
 *   `WeekToolsPanel.tsx:171-176` 的
 *   `<span className="... bg-amber-50 ...">改动已记下，点左边「重新排一遍」才会生效</span>`
 *   它和四个操作按钮并排躺在同一个 `flex-wrap` 容器里 ⟹ **位置随窗口宽度漂移**，
 *   而且「点左边」这种方位词在换行后就指错了地方。
 *
 * 为什么要独立成条（而不是把那个 span 挪个位置）：
 *   · **状态最重要的事是不用找**。用户改了东西但没看到效果，90% 是因为
 *     没看见「还没生效」这四个字；把它放在操作条里就是赌用户会注意到；
 *   · 状态条能带**摘要**（删了几块、加了什么事），而不只是一句「有改动」；
 *   · 状态条能带**就地的主 CTA** —— 不用把眼睛移回左边找按钮；
 *   · 它同时是 Today 页等其它视图的复用点（同一套"攒批 → 生效"语义）。
 *
 * 🔴 本组件是**纯展示**：它不读store、不改layer，只把
 *    「有几项改动 / 具体是什么 / 现在重排」交给调用方的回调。
 *    计数与文案由调用方算好传进来 —— 因为「改动有几项」的口径归覆盖层所有
 *    （`userPlanStore`），本组件不该也不需要知道那套结构。
 */

export interface PendingEdit {
  /** 短标签，如「删了」「加了」「改了」 */
  kind: string;
  /** 具体内容，如「1 块」「英语听力」「1 处时间」 */
  detail: string;
}

export function PendingEditsBar({
  edits,
  onReplan,
  onInspect,
  /** 正在重排 ⟹ 主 CTA 转loading 且禁用，防连点 */
  running = false,
}: {
  edits: PendingEdit[];
  onReplan: () => void;
  /** 「查看改动」——可选。给了才渲染那个按钮 */
  onInspect?: () => void;
  running?: boolean;
}) {
  if (edits.length === 0) return null;
  const summary = edits.map((e) => `${e.kind} ${e.detail}`).join(' · ');
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-600/25 bg-amber-50 px-3.5 py-2.5"
    >
      <span className="flex shrink-0 items-center gap-2">
        {/* 状态点：不闪、不动 —— 静态的一点点视觉锚点就够了 */}
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600" aria-hidden />
        <span className="text-[12.5px] font-medium text-amber-900">
          有 {edits.length} 项改动还没生效
        </span>
      </span>
      <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-amber-800">
        {summary}
      </span>
      {onInspect && (
        <button
          type="button"
          onClick={onInspect}
          className="shrink-0 rounded-md bg-white px-2.5 py-1 text-[11.5px] font-medium text-amber-900 ring-1 ring-amber-700/20 transition hover:bg-amber-100"
        >
          查看改动
        </button>
      )}
      {/* 主 CTA 就地：用户不用把视线移回左边操作条 */}
      <button
        type="button"
        onClick={onReplan}
        disabled={running}
        title="按当前改动重新排一遍这一周"
        className={`shrink-0 rounded-md px-3 py-1 text-[11.5px] font-semibold transition ${
          running
            ? 'cursor-not-allowed bg-amber-700/40 text-white'
            : 'bg-slate-800 text-white hover:bg-slate-700'
        }`}
      >
        {running ? '正在重排…' : '重新排一遍'}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   计数（纯函数）
   ═══════════════════════════════════════════════════════════════
   🔑 为什么是纯函数而不是在视图里写 `useMemo`：
     · 「本周改了几处时间」依赖 `editedBlockIds`（→ `moveMap` → `plan`），那些都在
       `WeekPlanView` 的**下半部分**，而 `edits` 在上半部分 —— 写在视图里要么提前声明
       （用不到 `moveMap`），要么**就地改对象**（能工作，但极隐蔽：下游只看
       `pendingItems` 根本看不出它在别处被赋过值）；
     · 抽成纯函数后视图只调一行，`WeekPlanView` 行数不受影响
       （🔴 AC-7 闸门：`arch-guards.test.ts` 限死 ≤800 行，本项目已撞过一次）；
     · 纯函数能在 Node 里直接单测，不依赖 React。
   `editedIds` 传 `Set<string>`（BlockCard「✏️ 已改」的同一份），**口径不另立**。
 */
export function countPendingEdits(input: {
  pendingEdits: boolean;
  excludedCount: number;
  userTaskCount: number;
  editedIds: ReadonlySet<string>;
  /**
   * 目标设置改过（2026-10-07 补）。
   *
   * 🔴 为什么必须单独开一类：周页上**其它**改动（删除 / 加事 / 拖拽改时间 / 不可时段 /
   *    食堂 / 作业）都写 `layer`，一律经 `updateLayer` —— 那个函数是「写层 + 标记待生效」
   *    的收口，天然不会漏。**而目标走 `goalStore`，不经过 `layer`** ⟹
   *    `editedIds` 里看不见它。
   *    后果（RAY 2026-10-07 实测到的）：点了「延 2 周 / 减 20% / 转冲刺」，
   *    `goalStore` 确实写了、toast 也弹了，但计划不重算；而摘要里没有这一类 ⟹
   *    `items` 为空 ⟹ 连这条「有改动还没生效」的提示都不会出现，用户**没有任何重排入口**。
   */
  goalsChanged?: boolean;
}): PendingEdit[] {
  if (!input.pendingEdits) return [];
  const items: PendingEdit[] = [];
  if (input.excludedCount > 0) {
    items.push({ kind: '删了', detail: `${input.excludedCount} 块` });
  }
  if (input.userTaskCount > 0) {
    items.push({ kind: '加了', detail: `${input.userTaskCount} 件事` });
  }
  if (input.editedIds.size > 0) {
    items.push({ kind: '改了', detail: `${input.editedIds.size} 处时间` });
  }
  if (input.goalsChanged) {
    items.push({ kind: '调了', detail: '目标设置' });
  }
  return items;
}

/* ═══════════════════════════════════════════════════════════════
   骨架屏（2026-10-07 · 提案第 9 条）
   ═══════════════════════════════════════════════════════════════
   原��是 `正在排这一周……` 一句 12px 灰字（WeekPlanView.tsx:599-601）。
   排程要跑几百毫秒，这期间界面**完全空白** —— 用户看到的是「点了没反应」，
   而且内容出来时整页从空跳到满，视线要重新找位置。
 *
   骨架屏给出与真实布局**同尺寸**的占位，内容替换时不发生位移。
 *
 * 🔴 为什么列数写死成 4 而不是 `xl:grid-cols-${columns}`：
 *   Tailwind 只扫**源码里的完整字面量**类名，模板拼出来的
 *   `xl:grid-cols-3` 它扫不到 → 构建时静默不生成 → 大屏下变一列。
 *   （同一坑在类别色收口时已踩过一次，见 `tailwind.config.js` 的 safelist 注释。）
 *   `columns` 参数因此**不接断点**，只当「渲染几列骨架」的普通数字用。
 */
export function WeekPlanSkeleton({
  columns = 4,
  rows = 4,
}: {
  /** 渲染几个日列骨架（默认 4，与 xl 断点的 4 列一致） */
  columns?: number;
  /** 渲染几行（移动端单列时的段数） */
  rows?: number;
}) {
  return (
    <div aria-busy="true" aria-label="正在排这一周" className="space-y-4">
      {/* 阶段头占位：用同尺寸的灰块，内容出来时布局不跳 */}
      <div className="panel px-4 py-3.5 sm:px-5">
        <div className="h-4 w-40 rounded bg-ink/8" />
        <div className="mt-2 h-3 w-72 rounded bg-ink/5" />
        <div className="mt-2 h-3 w-56 rounded bg-ink/5" />
      </div>
      {/* 日列骨架：固定 `xl:grid-cols-4` 字面量（见上方说明） */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: columns }, (_, i) => (
          <div key={i} className="panel p-3">
            <div className="h-3.5 w-20 rounded bg-ink/8" />
            {/* 每列块数不等（真实数据里有课的日子块更多），做出高低差更接近真实 */}
            <div className="mt-2 space-y-1.5">
              {Array.from({ length: 3 + (i % 3) }, (_, k) => (
                <div key={k} className="rounded-lg bg-ink/5" style={{ height: k === 0 ? 40 : 28 }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {rows < 4 && <div className="h-24" aria-hidden />}
    </div>
  );
}

