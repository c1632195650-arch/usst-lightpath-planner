/**
 * 「我的住处」设置（2026-09-20；2026-10-01 改成三级联选）
 * ============================================================
 * 与「常去食堂」设置（MealPlaceSetting）并列的固定地点设置。
 *
 * ── 与食堂设置的关键差别：**没有默认值**（RAY 拍板）──────────
 * 食堂没设置 = 三餐地点留空（去哪吃自己定）；
 * 住处没设置 = 宿舍类块（午休/宿舍自习）地点留空 —— 不预填「第二学生公寓」，
 * 不替用户假设他住哪。
 *
 * ── 引擎接线 ────────────────────────────────────────────────
 * 设置随覆盖层 `layer.homeBase` 持久化，排程时 `construct` 把宿舍类模板的
 * `__HOME__` 占位替换为这里的值；未设置 = 地点留空。
 * ⚠️ 引擎**只读 `homeBase.name`**（`construct.ts:538 → homeBaseName`）。
 *    `homeBase.campus` 目前只是随行记录，引擎不消费 —— 详见
 *    `tests/homeBasePlacement.test.ts` 的实测定性。别把它当第二个消费点。
 *
 * ── 为什么改成三级联选（2026-10-01 RAY 反馈）─────────────────
 * 旧版是「4 个写死的胶囊 + 一个自由输入框」。问题：
 *   · 只有 4 栋楼，绝大多数人找不到自己住哪，只能手打；
 *   · 手打的楼名**引擎认不出**（`campusOfName` 靠关键字），也不进任何清单。
 * 现在改成 **校区 → 公寓 / 宿舍 → 楼栋** 三级联选，选项来自
 * `src/data/dorms.ts`（= 校园图谱 `data/campus_map.json` 的投影，33 条，
 * 由 `tests/dorms.test.ts` 钉住不许跑偏）。**不再提供自由输入**（RAY 明确要求）。
 *
 * ⚠️ 已知缺口：1100（大一基础学院）的 A/B/C 区宿舍**图谱里没有**，
 *    本轮按拍板「先不做 1100」，故联选只覆盖北校 / 南校。
 *
 * ── 两种形态 ────────────────────────────────────────────────
 *  · `embedded`：首次设置「个人信息」表单里的**一个字段** —— 只有标签 + 控件，
 *    样式与同表其它字段同源（`@/components/ui/field`），不带卡片外框、不带折叠开关；
 *  · 默认：周计划页工具面板里的可折叠卡片。
 * 两种情况下的控件完全一样，只有外壳不同。
 */
import { useState } from 'react';
import type { CampusName } from '@/lib/planner/templates.ts';
import { FIELD_HINT, FIELD_LABEL, fieldClsCompact } from '@/components/ui/field';
import {
  DORM_CAMPUSES,
  dormByName,
  dormCategories,
  dormsOf,
  isDormCampus,
  type DormCampus,
  type DormCategory,
} from '@/data/dorms';

export interface HomeBase {
  name: string;
  campus: CampusName;
}

interface Props {
  /** null = 未设置 */
  value: { name: string; campus: string } | null;
  onChange: (next: { name: string; campus: CampusName } | null) => void;
  defaultOpen?: boolean;
  /** 表单内嵌形态：当作 `BasicInfoStep` 网格里的一个字段渲染（无卡片外框、无折叠开关） */
  embedded?: boolean;
}

export function HomeBaseSetting({ value, onChange, defaultOpen = false, embedded = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  // 内嵌形态是「字段」，永远展开（字段不该需要用户先点一下才出现）
  const expanded = embedded || open;

  /** 已存的值能不能在清单里对上（对不上 = 旧版本自由输入的残留） */
  const saved = dormByName(value?.name);
  /** 校区回填：优先用清单判定，其次认已存的 campus 字段（收窄要靠单独的局部变量） */
  const valueCampus = value?.campus;
  const seedCampus: DormCampus | '' = saved?.campus ?? (isDormCampus(valueCampus) ? valueCampus : '');

  const [campus, setCampus] = useState<DormCampus | ''>(seedCampus);
  const [category, setCategory] = useState<DormCategory | ''>(saved?.category ?? '');
  /** 联选里的「楼栋」游标。只有选中一栋才 `onChange` 落库，中途态不落库。 */
  const [name, setName] = useState(value?.name ?? '');

  const categories = campus ? dormCategories(campus) : [];
  const buildings = campus && category ? dormsOf(campus, category) : [];

  const pickCampus = (next: DormCampus | '') => {
    setCampus(next);
    setCategory('');
    setName(''); // 换了校区，下面两级必须重选 —— 否则会留下跨校区的组合
  };

  const pickCategory = (next: DormCategory | '') => {
    setCategory(next);
    setName('');
  };

  const pickBuilding = (next: string) => {
    setName(next);
    const d = dormByName(next);
    if (d) onChange({ name: d.name, campus: d.campus });
  };

  const clear = () => {
    onChange(null);
    setCampus('');
    setCategory('');
    setName('');
  };

  const selectCls = `${fieldClsCompact()} w-auto min-w-0 flex-1`;

  return (
    <div className={embedded ? 'block' : 'rounded-xl border border-ink/10 bg-white p-3'}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={embedded ? FIELD_LABEL : 'text-[11.5px] font-medium text-ink'}>🏠 我的住处</span>
        {!embedded && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded bg-white px-2 py-0.5 text-[11px] text-ink-soft ring-1 ring-ink/15 hover:bg-slate-50"
          >
            {open ? '收起' : value ? '修改' : '＋ 设置'}
          </button>
        )}
      </div>

      {/* 已存值只有一处显示 —— 避免「胶囊高亮」和「下拉选中」两处各说各话 */}
      {!embedded && (
        <div className={FIELD_HINT}>
          {value
            ? <>当前：{value.name}（{value.campus}）—— 午休、宿舍自习等块的地点会跟随</>
            : <>未设置 —— 午休、宿舍自习等块的地点会留空（引擎不猜你住哪）</>}
        </div>
      )}

      {expanded && (
        <div className="mt-1.5 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              aria-label="校区"
              value={campus}
              onChange={(e) => pickCampus(e.target.value as DormCampus | '')}
              className={selectCls}
            >
              {/* 占位项用 `hidden`：只在未选时当框内提示，展开的列表里不出现（RAY：展开后不该再看到这类空选项） */}
              <option value="" disabled hidden>选择校区</option>
              {DORM_CAMPUSES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <select
              aria-label="公寓或宿舍"
              value={category}
              disabled={!campus}
              onChange={(e) => pickCategory(e.target.value as DormCategory | '')}
              className={`${selectCls} disabled:opacity-45`}
            >
              <option value="" disabled hidden>{campus ? '公寓 / 宿舍' : '先选校区'}</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <select
              aria-label="楼栋"
              value={name}
              disabled={!category}
              onChange={(e) => pickBuilding(e.target.value)}
              className={`${selectCls} disabled:opacity-45`}
            >
              <option value="" disabled hidden>{category ? '楼栋' : '先选类别'}</option>
              {/* 旧版本自由输入留下的值：清单里没有，但也不能让它凭空消失 */}
              {value?.name && !saved && <option value={value.name}>{value.name}（原有记录）</option>}
              {buildings.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}{d.verified ? '' : '（待核）'}
                </option>
              ))}
            </select>

            {value && (
              <button
                type="button"
                onClick={clear}
                className="shrink-0 text-[11px] text-ink-faint hover:text-red-600"
              >
                清除
              </button>
            )}
          </div>

          <span className={FIELD_HINT}>
            午休、宿舍自习等块的地点会跟着它；不填就留空（引擎不猜你住哪）。
            带「待核」的楼来自校园图谱里尚未核实的条目。
          </span>
        </div>
      )}
    </div>
  );
}
