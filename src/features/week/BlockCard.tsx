/**
 * 时间轴块卡片（F2d/A5 拆出的第 ① 个纯展示子组件 · 前端架构规格书 §8.1）
 * ============================================================
 * 从 `WeekPlanView.tsx` 原样搬出：一块日程卡（课程/三餐/自习/活动/用户块），
 * 含定住 / 删除 / 作业标记 / 块级编辑 / 拖拽源与 🆕 标注。
 * 纯展示：不取数、不重排 —— 所有变更都经由回调上抛（交互态留在视图）。
 */
import { useState } from 'react';
import type { TimeBlock } from '@/types';
import { toHHmm } from '@/constants/time';
import { EditBlockPanel } from './EditBlockPanel';

export const KIND_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  course: { bg: 'bg-blue-100 border-blue-400', text: 'text-blue-900', label: '课' },
  meal: { bg: 'bg-amber-100 border-amber-400', text: 'text-amber-900', label: '饭' },
  study: { bg: 'bg-green-100 border-green-400', text: 'text-green-800', label: '学' },
  activity: { bg: 'bg-purple-100 border-purple-400', text: 'text-purple-900', label: '动' },
  user: { bg: 'bg-pink-100 border-pink-400', text: 'text-pink-900', label: '我' },
  commute: { bg: 'bg-gray-100 border-gray-400', text: 'text-gray-700', label: '走' },
  blank: { bg: 'bg-white border-gray-200', text: 'text-gray-400', label: '空' },
};

export function BlockCard({
  block, date, locked, onToggleLock, onExclude,
  assignmentMin, onSetAssignment, onClearAssignment,
  edited, onEditBlock, onRevertEdit,
  dragging, onDragStartCard, onDragEndCard,
  isNew, onDismissNew,
}: {
  block: TimeBlock;
  /** 这个块所属的 ISO 日期 —— 供无障碍标注（行为记录已下线，2026-09-19） */
  date: string;
  /** 用户已把这块「定住」 */
  locked: boolean;
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
  /** R2：块级编辑面板的展开状态（同 T6，纯 UI 状态） */
  const [editOpen, setEditOpen] = useState(false);
  const style = KIND_STYLE[block.kind] ?? KIND_STYLE.blank;
  const t = block.transfer;
  // 校历事件展开出来的准备块（光电杯材料、四六级真题…）单独标出来 ——
  // 否则用户只看到「又一个活动块」，意识不到它和那个截止日有关
  const isEvent = Boolean(block.fromEventId);
  return (
    <div
      draggable={block.kind !== 'course' && block.source !== 'course'}
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
      title={dragging ? '松手放到目标位置；拖到右侧投放区可删除' : '可以直接拖到别的天 / 别的时段'}
      onClick={() => { if (isNew && onDismissNew) onDismissNew(); }}
      className={`rounded-lg border-l-4 ${style.bg} px-2.5 py-2 ${isEvent ? 'ring-1 ring-purple-300' : ''} ${dragging ? 'opacity-50 ring-2 ring-brand' : ''} ${isNew ? 'ring-2 ring-green-400' : ''} ${block.kind !== 'course' && block.source !== 'course' ? 'cursor-grab' : ''}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-[13px] font-semibold ${style.text}`}>
          {locked && <span title="已定住：重排时不动">🔒 </span>}
          {block.emoji ? `${block.emoji} ` : ''}{block.title}
          {isNew && <span className="ml-1 rounded bg-green-600 px-1 align-middle text-[9px] text-white">🆕 新</span>}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-ink-faint">
          {toHHmm(block.startMin)}–{toHHmm(block.endMin)}
        </span>
      </div>
      {locked && (
        <div className="mt-1 inline-block rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-white">
          已定住 · 重排时不会挪动
        </div>
      )}
      {isEvent && (
        <div className="mt-1 inline-block rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-800">
          校历事件 · 提前准备
        </div>
      )}
      {/* 地点 —— 标题里已经说了就不再重复（T5）。
          例：「第一食堂 🍚 / @第一食堂」纯属噪音；重复信息会淹没真正要看的时刻。 */}
      {block.place && !block.title.includes(block.place) && (
        <div className="mt-0.5 text-[11px] text-ink-soft">
          @{block.place}{block.room ? ` ${block.room}` : ''}
        </div>
      )}
      {t && (
        <div className={`mt-1 rounded px-1.5 py-0.5 text-[11px] ${t.tight ? 'bg-white/70 text-red-700' : 'text-ink-soft'}`}>
          🚶 {t.fromPlace} → {t.toPlace}：{t.minutes} 分钟
          （余 {t.slackMin}{t.tight ? ' · 紧' : ''}）
        </div>
      )}
      {block.reason && (
        <div className="mt-1 text-[11px] leading-snug text-ink-faint">💡 {block.reason}</div>
      )}

      {/* 操作按钮区（2026-09-19 改版）：
          · 「做了 / 没做」执行标记**已下线**（用户确认不需要）——
            行为记录的 UI 入口随之移除，历史数据仍在本地，actualLoad 通道不破坏。
          · 「🗑 删除」沿用原「✕ 不做」的通道与 hover 浮现交互，只把文案改直白。 */}
      <div className="group mt-1.5 flex items-center gap-1.5">
        {/* 「定住」—— 把这块从「引擎可动的软块」变成「用户确认过的硬块」。
            ⚠️ 已锁定时**常显**（否则用户看不出这块被锁了）；未锁时 hover 才出现。 */}
        <button
          type="button"
          onClick={() => onToggleLock(block)}
          title={locked ? '解除锁定，允许重排时挪动' : '定住：以后重排都保持这个时间与地点'}
          className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium transition-opacity ${
            locked
              ? 'bg-slate-800 text-white'
              : 'bg-white/70 text-ink-soft opacity-0 hover:bg-slate-100 group-hover:opacity-100 focus-visible:opacity-100'
          }`}
        >
          {locked ? '🔒 已定住' : '🔓 定住'}
        </button>
        {/* 「🗑 删除」—— 把块从计划里拿掉，重排也不会回来。
            课程块不给：它是既成事实，改课走「调课」。
            拖到右侧投放区是同一件事的另一条路径。 */}
        {block.kind !== 'course' && block.source !== 'course' && (
          <button
            type="button"
            onClick={() => onExclude(block)}
            title="删除这块：从计划里拿掉，重排也不会回来（可在上方「全部恢复」撤销）"
            className="rounded bg-white/70 px-1.5 py-0.5 text-[10.5px] font-medium text-ink-soft opacity-0 transition-opacity hover:bg-red-50 hover:text-red-700 group-hover:opacity-100 focus-visible:opacity-100"
          >
            🗑 删除
          </button>
        )}
        {/* T6：作业 —— 只对课程块有意义。
            引擎不知道「这节课留了作业」，所以要用户说一句；时长也由用户填
            （「高数作业」和「大物实验报告」能差三倍，引擎猜不准，猜了也是噪音）。
            已标记时常显（让用户一眼看出这门课的作业已排进计划）。 */}
        {block.kind === 'course' && block.courseId && (
          <button
            type="button"
            onClick={() => setAsgOpen((v) => !v)}
            title={assignmentMin != null
              ? `已标记作业 ${assignmentMin} 分钟 —— 点一下可修改或取消`
              : '这节课留了作业？记一下要多久，引擎会给你留时间'}
            className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium transition-opacity ${
              assignmentMin != null
                ? 'bg-indigo-600 text-white'
                : 'bg-white/70 text-ink-soft opacity-0 hover:bg-indigo-50 hover:text-indigo-700 group-hover:opacity-100 focus-visible:opacity-100'
            }`}
          >
            {assignmentMin != null ? `📝 ${assignmentMin}分` : '📝 作业'}
          </button>
        )}
        {/* R2：「改」—— 改这块的时间/时长/地点（不用删掉重加）。
            课程块不给：课程时间变动是「调课」（R3），走另一个入口，
            语义不同（「只这周 / 以后都这样」），不能混。
            已改过的块常显（让用户知道这块有自己的改动在身）。 */}
        {block.kind !== 'course' && block.source !== 'course' && (
          <button
            type="button"
            onClick={() => setEditOpen((v) => !v)}
            title={edited ? '这块被你改过 —— 点一下可再改或恢复引擎安排' : '改这块的时间、时长或地点'}
            className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium transition-opacity ${
              edited
                ? 'bg-teal-600 text-white'
                : 'bg-white/70 text-ink-soft opacity-0 hover:bg-teal-50 hover:text-teal-700 group-hover:opacity-100 focus-visible:opacity-100'
            }`}
          >
            {edited ? '✏️ 已改' : '✏️ 改'}
          </button>
        )}
      </div>

      {/* R2：块级编辑面板 —— 同日改；改动攒着，「重新排一遍」才生效（T3 语义） */}
      {editOpen && block.kind !== 'course' && block.source !== 'course' && (
        <EditBlockPanel
          block={block}
          edited={edited ?? false}
          onSave={(next) => { onEditBlock(block, next); setEditOpen(false); }}
          onRevert={() => { onRevertEdit(block); setEditOpen(false); }}
          onCancel={() => setEditOpen(false)}
        />
      )}

      {/* T6：作业时长输入 —— **用户自己填**，不给「智能默认」。
          输入框里的 60 只是个起点，确认前用户能看到并改掉。 */}
      {asgOpen && block.kind === 'course' && block.courseId && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-md bg-indigo-50 px-2 py-1.5 text-[11px] text-indigo-900">
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
    </div>
  );
}
