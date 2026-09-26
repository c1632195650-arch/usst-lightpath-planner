import { useState } from 'react';
import {
  CAMPUS_OPTIONS,
  GRADE_LABELS,
  loadBasicInfo,
  saveBasicInfo,
  type BasicInfo,
} from '@/lib/identity';
import { EMPTY_DRAFT, parseBasicInfo, validateBasicInfo, type BasicInfoDraft } from './basicInfo';

interface Props {
  onComplete: () => void;
  onBack: () => void;
}

/**
 * 基础信息前置（v2 方案 WP1）：欢迎页之后、画像测评之前收集客观事实。
 * 必填：称呼 / 年级 / 学院 / 校区；其余选填。
 * 校验逻辑在 ./basicInfo.ts（纯函数，node --test 可直跑）；
 * 必填缺失禁「下一步」，campus 只认军工路本部 | 1100（数据红线）。
 * 提交写入 identity.ts 的单一来源（localStorage），与画像页的基础信息卡同源。
 */
export function BasicInfoStep({ onComplete, onBack }: Props) {
  const [draft, setDraft] = useState<BasicInfoDraft>(() => {
    // 已有基础信息（如中途刷新回来）→ 预填，不让人重打一遍
    const saved: BasicInfo = loadBasicInfo();
    return {
      ...EMPTY_DRAFT,
      nickname: saved.nickname ?? '',
      grade: saved.grade ? String(saved.grade) : '',
      college: saved.college ?? '',
      major: saved.major ?? '',
      campus: saved.campus ?? '',
      dorm: saved.dorm ?? '',
      sleepMin: saved.sleepMin !== undefined ? String(saved.sleepMin) : '',
      exercisePerWeek: saved.exercisePerWeek !== undefined ? String(saved.exercisePerWeek) : '',
    };
  });
  const [touched, setTouched] = useState(false);

  const errors = validateBasicInfo(draft);
  const errorList = Object.values(errors);
  const canNext = errorList.length === 0;

  const set = (key: keyof BasicInfoDraft, value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const submit = () => {
    setTouched(true);
    if (!canNext) return;
    saveBasicInfo(parseBasicInfo(draft));
    onComplete();
  };

  const inputCls = (err?: string | false) =>
    `mt-1.5 min-h-11 w-full rounded-xl border bg-paper px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:ring-2 ${
      err ? 'border-warn focus:border-warn focus:ring-warn/10' : 'border-ink/15 focus:border-brand focus:ring-brand/10'
    }`;

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 sm:py-8">
      <div className="page-shell mx-auto max-w-2xl">
        <div className="panel rounded-2xl border border-ink/[0.07] bg-white px-6 py-8 sm:px-10">
          <p className="section-label">FIRST SETUP · 1/2</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">先让梨宝认识你</h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-ink-soft">
            填基本事实就够了，30 秒。年级和校区会影响后面的题与建议；这些都只保存在本机。
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs text-ink-faint">称呼 *</span>
              <input
                value={draft.nickname}
                onChange={(e) => set('nickname', e.target.value)}
                placeholder="怎么称呼你"
                className={inputCls(touched && errors.nickname)}
              />
              {touched && errors.nickname && <span className="mt-1 block text-xs text-warn">{errors.nickname}</span>}
            </label>

            <label className="block">
              <span className="text-xs text-ink-faint">年级 *</span>
              <select
                value={draft.grade}
                onChange={(e) => set('grade', e.target.value)}
                className={inputCls(touched && errors.grade)}
              >
                <option value="">请选择</option>
                {([1, 2, 3, 4] as const).map((g) => (
                  <option key={g} value={String(g)}>{GRADE_LABELS[g]}</option>
                ))}
              </select>
              {touched && errors.grade && <span className="mt-1 block text-xs text-warn">{errors.grade}</span>}
            </label>

            <label className="block">
              <span className="text-xs text-ink-faint">学院 *</span>
              <input
                value={draft.college}
                onChange={(e) => set('college', e.target.value)}
                placeholder="如：光电学院"
                className={inputCls(touched && errors.college)}
              />
              {touched && errors.college && <span className="mt-1 block text-xs text-warn">{errors.college}</span>}
            </label>

            <label className="block">
              <span className="text-xs text-ink-faint">专业</span>
              <input
                value={draft.major}
                onChange={(e) => set('major', e.target.value)}
                placeholder="如：光电信息科学与工程"
                className={inputCls()}
              />
            </label>

            <label className="block">
              <span className="text-xs text-ink-faint">校区 *</span>
              <select
                value={draft.campus}
                onChange={(e) => set('campus', e.target.value)}
                className={inputCls(touched && errors.campus)}
              >
                <option value="">请选择</option>
                {CAMPUS_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {touched && errors.campus && <span className="mt-1 block text-xs text-warn">{errors.campus}</span>}
            </label>

            <label className="block">
              <span className="text-xs text-ink-faint">宿舍楼号</span>
              <input
                value={draft.dorm}
                onChange={(e) => set('dorm', e.target.value)}
                placeholder="如：五公寓，只填楼号"
                className={inputCls(touched && errors.dorm)}
              />
              {touched && errors.dorm && <span className="mt-1 block text-xs text-warn">{errors.dorm}</span>}
            </label>

            <label className="block">
              <span className="text-xs text-ink-faint">平日就寝（分钟 0-1440）</span>
              <input
                value={draft.sleepMin}
                onChange={(e) => set('sleepMin', e.target.value)}
                inputMode="numeric"
                placeholder="如：1380（23:00）"
                className={inputCls(touched && errors.sleepMin)}
              />
              {touched && errors.sleepMin && <span className="mt-1 block text-xs text-warn">{errors.sleepMin}</span>}
            </label>

            <label className="block">
              <span className="text-xs text-ink-faint">每周运动几次（0-7）</span>
              <input
                value={draft.exercisePerWeek}
                onChange={(e) => set('exercisePerWeek', e.target.value)}
                inputMode="numeric"
                placeholder="如：3"
                className={inputCls(touched && errors.exercisePerWeek)}
              />
              {touched && errors.exercisePerWeek && <span className="mt-1 block text-xs text-warn">{errors.exercisePerWeek}</span>}
            </label>
          </div>

          {touched && !canNext && errorList.length > 0 && (
            <p role="alert" className="mt-5 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
              还差 {errorList.length} 项没填对，补上就能继续。
            </p>
          )}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button onClick={onBack} className="button-secondary flex-1">返回</button>
            <button
              onClick={submit}
              disabled={touched && !canNext}
              aria-disabled={touched && !canNext}
              className="button-primary flex-1"
            >
              下一步：开始画像
            </button>
          </div>
          <p className="mt-4 text-xs leading-5 text-ink-faint">
            这些信息随时可在「我的画像」页修改；梨宝在对话里听到变化时，也会先问你确认才更新。
          </p>
        </div>
      </div>
    </div>
  );
}
