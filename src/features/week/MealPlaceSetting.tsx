/**
 * 「我常去的食堂」设置（S4，2026-09-19）
 * ============================================================
 * 背景：T2 删掉了「引擎自动猜吃哪家」（依据不成立 —— 大部分人只去固定摊位，
 * 引擎既不知道你平时吃哪，也不知道你今天想吃什么）。于是三餐只占时间、不指定地点。
 *
 * 但**用户仍然想能自己设定** —— 这就是本组件：
 * **引擎不猜，但给你一个设定的地方。**
 *
 * ── 为什么按餐次分开（早/午/晚各一个）────────────────────────
 * 早餐多半在宿舍附近、午餐在教学楼附近，这是常态。合成一个「我的食堂」太粗。
 *
 * ── 为什么留空就等于「不指定」而不是给个默认值 ──────────────
 * 延续项目的「不猜」纪律：没设定就不给地点，而不是塞一个猜的。
 * 空值的餐次块与 T2 的行为完全一致。
 */
import { useState } from 'react';
import { DEFAULT_TEMPLATES } from '@/lib/planner/templates';
import type { MealPlaces } from './userPlanStore.ts';
import { setMealPlace } from './userPlanStore.ts';

/** 候选项来自内置的食堂模板（与引擎认的 POI 名同源，避免手打不一致） */
const MEAL_PLACES: string[] = [...new Set(
  DEFAULT_TEMPLATES
    .filter((t) => t.category === 'meal' && t.place)
    .map((t) => t.place as string),
)];

const ROWS: Array<{ key: keyof MealPlaces; label: string; emoji: string }> = [
  { key: 'breakfast', label: '早餐', emoji: '🥣' },
  { key: 'lunch', label: '午餐', emoji: '🍚' },
  { key: 'dinner', label: '晚餐', emoji: '🍜' },
];

interface Props {
  value: MealPlaces;
  onChange: (next: MealPlaces) => void;
  /** 默认是否展开 */
  defaultOpen?: boolean;
}

export function MealPlaceSetting({ value, onChange, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const specified = ROWS.filter((r) => value[r.key]).length;

  return (
    <div className="panel px-4 py-3 sm:px-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-baseline gap-x-2 text-left"
      >
        <span className="text-[13.5px] font-semibold text-ink">
          {open ? '▾' : '▸'} 我常去的食堂
        </span>
        <span className="text-[11.5px] text-ink-faint">
          {specified > 0 ? `已指定 ${specified} 餐` : '未指定 —— 三餐只占时间，去哪吃你临场定'}
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-1.5">
          <p className="text-[11px] leading-relaxed text-ink-faint">
            指定后，那一餐会标上食堂名。**不指定也完全可以** —— 引擎不会替你猜。
          </p>
          {ROWS.map(({ key, label, emoji }) => (
            <div key={key} className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="w-14 shrink-0 text-ink-soft">{emoji} {label}</span>
              <select
                value={value[key] ?? ''}
                onChange={(e) => onChange(setMealPlace(value, key, e.target.value || undefined))}
                className="min-w-[10rem] rounded-md border border-ink/15 bg-white px-2 py-1 text-[12px] text-ink"
              >
                <option value="">不指定</option>
                {MEAL_PLACES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              {value[key] && (
                <button
                  type="button"
                  onClick={() => onChange(setMealPlace(value, key, undefined))}
                  className="rounded bg-white px-2 py-0.5 text-[11px] text-ink-soft ring-1 ring-ink/15 hover:bg-slate-50"
                >
                  清除
                </button>
              )}
            </div>
          ))}
          <p className="text-[11px] text-ink-faint">
            改动会攒着 —— 点「重新排一遍」才会生效。
          </p>
        </div>
      )}
    </div>
  );
}
