/**
 * 「⚙️ 调整」抽屉（F3/N3 · 页面与使用逻辑规格书 §3.5 / §2.2 / §七）
 * ============================================================
 * 周计划页的低频干预入口收敛为一个右侧滑出抽屉，五个 tab：
 *   ① 加一件事（AddTaskPanel）—— 往这一周加自己的事（2026-09-28 从工具面板竖排栈并入）；
 *   ② 调课/停课（CourseOverrideEditor）—— 只本周 + 询问窗口，原始课表永不改；
 *   ③ 不可时段（SlotEditor）；
 *   ④ 指定食堂（MealPlaceSetting）；
 *   ⑤ 偏好校正清单（LearnedPreferencesPanel）。
 *
 * ── 开合为什么由父组件持有 ────────────────────────────────────
 * 触发按钮要跟「回到今天/撤销/重做/重新排一遍」**同一排**（那是 `WeekToolsPanel`
 * 的操作条），而抽屉本体挂在页面根。两者是兄弟节点，状态只能放到它们的共同父级
 * `WeekPlanView`（`open` / `onClose` 两个 props）。tab 仍是页内交互态（本组件自持）。
 *
 * ── 抽屉**常挂载**（关闭只平移出视口）───────────────────────────
 * 「加一件事」是个有 7 个受控输入的表单。若用 `{open && …}` 条件渲染，一收起就卸载、
 * 填到一半的内容全丢；切 tab 也一样。故：外层容器常驻，靠 `translate-x-full` 藏起来，
 * 「加一件事」用 `hidden` 切显隐 —— 表单状态在任何一次开合/切 tab 后都还在。
 *
 * 各编辑器仍直接走 `updateLayer` / `handleRulesChange` —— 数据通道零改动。
 */
import { useState } from 'react';
import type { Schedule } from '@/types';
import type { CorrectionRule } from '@/lib/planner/corrections';
import type { Goal } from '@/features/activity/goalStore';
import type { UserTask } from '@/lib/planner/templates';
import { AddTaskPanel } from './AddTaskPanel';
import { CourseOverrideEditor } from './CourseOverrideEditor';
import { SlotEditor } from './SlotEditor';
import { MealPlaceSetting } from './MealPlaceSetting';
import { LearnedPreferencesPanel } from '@/features/feedback/LearnedPreferencesPanel';
import type { UserPlanLayer } from './userPlanStore';
import { humanizeMinutes } from '@/constants/time';
import { removeSlot } from './userPlanStore';
import { Icon } from '@/components/icons/Icon';

type DrawerTab = 'addtask' | 'overrides' | 'slots' | 'meals' | 'prefs';

const TABS: Array<{ id: DrawerTab; label: string }> = [
  { id: 'addtask', label: '加一件事' },
  { id: 'overrides', label: '调课/停课' },
  { id: 'slots', label: '不可时段' },
  { id: 'meals', label: '指定食堂' },
  { id: 'prefs', label: '偏好校正' },
];

export interface AdjustDrawerProps {
  /** 开合归父组件（触发按钮在操作条那一排，不在本组件里） */
  open: boolean;
  onClose: () => void;
  weekNo: number;
  schedule: Schedule;
  layer: UserPlanLayer;
  updateLayer: (fn: (prev: UserPlanLayer) => UserPlanLayer) => void;
  rules: CorrectionRule[];
  goals: readonly Goal[];
  handleRulesChange: (next: CorrectionRule[]) => void;
  dateOfDay: (dayOfWeek: number) => string;
  derivedApplied: ReadonlyArray<{ courseName: string; periodLabel: string; action: string }>;
  /** 「加一件事」提交 —— 与周计划页同一条 `UserTask` 通道（T3 攒批语义不变） */
  onAddTask: (task: UserTask) => void;
  /** 有攒着没应用的改动（T3）—— 抽屉里也要明说，否则收起后用户看不到那条提示 */
  pendingEdits?: boolean;
}

export function AdjustDrawer({
  open, onClose, weekNo, schedule, layer, updateLayer, rules, goals, handleRulesChange,
  dateOfDay, derivedApplied, onAddTask, pendingEdits = false,
}: AdjustDrawerProps) {
  const [tab, setTab] = useState<DrawerTab>('addtask');

  return (
    <div
      className={`fixed inset-0 z-40 ${open ? '' : 'pointer-events-none'}`}
      // 常挂在 `space-y-4` 容器里会被父级加上 margin-top —— 固定层必须归零，否则整块下移
      style={{ marginTop: 0 }}
      aria-hidden={!open}
    >
      {/* 遮罩：点击关闭（关闭时透明度 0，且不再吃点击） */}
      <div
        className={`absolute inset-0 bg-ink/30 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`absolute right-0 top-0 flex h-full w-[22rem] max-w-[90vw] flex-col overflow-y-auto bg-paper shadow-2xl transition-transform duration-200 ${open ? 'visible translate-x-0' : 'invisible translate-x-full'}`}
        role="dialog"
        aria-modal={open}
        aria-label="调整"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink/10 bg-paper/95 px-4 py-3 backdrop-blur">
          <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-ink">
            <Icon name="settings" size="sm" />
            调整
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-[12px] text-ink-soft hover:bg-white"
          >
            收起
          </button>
        </div>

        {/* T3：改动攒着没生效 —— 抽屉里也要说。收起后提示仍在操作条上（两处一致） */}
        {pendingEdits && (
          <div className="mx-4 mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-900 ring-1 ring-amber-700/20">
            改动已记下 —— 收起抽屉后点操作条上的「重新排一遍」才会生效
          </div>
        )}

        <div className="flex flex-wrap gap-1 px-4 py-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`nav-item whitespace-nowrap text-[11.5px] ${tab === t.id ? 'nav-item-active' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="space-y-3 px-4 pb-6">
          {/* 「加一件事」常挂载（hidden 切显隐）—— 切 tab / 收起再打开都不丢表单内容 */}
          <div className={tab === 'addtask' ? '' : 'hidden'}>
            <AddTaskPanel onAdd={onAddTask} weekNo={weekNo} />
          </div>

          {tab === 'overrides' && (
            <>
              <CourseOverrideEditor
                schedule={schedule}
                weekNo={weekNo}
                overrides={layer.courseOverrides}
                onChange={(next) => updateLayer((prev) => ({ ...prev, courseOverrides: next }))}
              />
              {derivedApplied.length > 0 && (
                <div className="rounded-md bg-slate-50 px-3 py-2 text-[11.5px] text-ink-soft">
                  这周已应用 {derivedApplied.length} 处调课/停课：
                  {derivedApplied
                    .map((a) => `${a.courseName} ${a.periodLabel} ${a.action === 'cancel' ? '停课' : '调课'}`)
                    .join('、')}
                </div>
              )}
            </>
          )}
          {tab === 'slots' && (
            <SlotEditor
              weekNo={weekNo}
              slots={layer.slots}
              goals={goals}
              mondayISO={dateOfDay(1)}
              onChange={(next) => updateLayer((prev) => ({ ...prev, slots: next }))}
            />
          )}
          {tab === 'meals' && (
            <MealPlaceSetting value={layer.mealPlaces} onChange={handleMealPlacesChangeInternal} />
          )}
          {tab === 'prefs' && (
            <LearnedPreferencesPanel
              rules={rules}
              onChange={handleRulesChange}
              unavailable={layer.slots.map((s) => ({
                id: s.id,
                label: `${s.days.map((d) => `周${'一二三四五六日'[d - 1]}`).join('/')} ${humanizeMinutes(s.fromMin)}–${humanizeMinutes(s.toMin)}`,
                sub: s.scope === 'long' ? '每周' : '只一周',
              }))}
              onRemoveSlot={(id) => updateLayer((prev) => ({ ...prev, slots: removeSlot(prev.slots, id) }))}
            />
          )}
        </div>
      </aside>
    </div>
  );

  function handleMealPlacesChangeInternal(next: import('./userPlanStore').MealPlaces) {
    updateLayer((prev) => ({ ...prev, mealPlaces: next }));
  }
}
