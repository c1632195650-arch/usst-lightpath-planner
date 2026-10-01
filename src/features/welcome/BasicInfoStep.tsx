import { useState, type ReactNode } from 'react';
import {
  CAMPUS_OPTIONS,
  GRADE_LABELS,
  loadBasicInfo,
  saveBasicInfo,
  type BasicInfo,
} from '@/lib/identity';
import { FIELD_LABEL, fieldCls } from '@/components/ui/field';
import { EMPTY_DRAFT, parseBasicInfo, validateBasicInfo, type BasicInfoDraft } from './basicInfo';

interface Props {
  onComplete: () => void;
  onBack: () => void;
  /**
   * 「住处 + 作息」字段 —— 由**组合根**（`App.tsx`）注入 week 域组件。
   * 本组件只当插槽，绝不 import `features/week/**`（否则新增 welcome → week
   * 跨域依赖，撞架构护栏 AC-6·R5）。详见 `features/week/OnboardingSetup.tsx` 头注。
   *
   * ⚠️ 注入的是**同一张表单网格里的若干格**（fragment，不带自己的外框/标题），
   * 不是「表单下面另起一栏」—— RAY 2026-10-01 明确要求统一风格并入。
   * 因此这里把它放进 `.grid` 内部，让注入项与其它字段共享同一条栅格。
   */
  children?: ReactNode;
}

/**
 * 基础信息前置（v2 方案 WP1）：欢迎页之后、画像测评之前收集客观事实。
 * 必填：称呼 / 年级 / 学院 / 校区；其余选填。
 * 校验逻辑在 ./basicInfo.ts（纯函数，node --test 可直跑）；
 * 必填缺失禁「下一步」，campus 只认军工路本部 | 1100（数据红线）。
 * 提交写入 identity.ts 的单一来源（localStorage），与画像页的基础信息卡同源。
 *
 * 2026-09-28：本步同时承载「住处 + 作息」（`children` 注入）——
 * 即 onboarding 由「个人信息 → 问卷 → 作息」三段收成「个人信息（含住处/作息）→ 问卷」。
 * 2026-10-01：并入方式改为**同一张表单网格内的统一字段**（不再另起带边框的区块），
 * 外观由中立层 `@/components/ui/field` 统一提供，week 域组件与这里共用同一套样式。
 */
export function BasicInfoStep({ onComplete, onBack, children }: Props) {
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

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 sm:py-8">
      <div className="page-shell mx-auto max-w-2xl">
        <div className="panel rounded-2xl border border-ink/[0.07] bg-white px-6 py-8 sm:px-10">
          <p className="section-label">FIRST SETUP · 基础信息</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">先让梨宝认识你</h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-ink-soft">
            填基本事实就够了，30 秒。年级和校区会影响后面的题与建议；这些都只保存在本机。
          </p>

          {/*
            单条表单网格：必填事实 + 选填「住处 / 作息」都在这里。
            注入的 children 是若干 `.grid` 子项（见文件头注），与其它字段同宽同款。
          */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={FIELD_LABEL}>称呼 *</span>
              <input
                value={draft.nickname}
                onChange={(e) => set('nickname', e.target.value)}
                placeholder="怎么称呼你"
                className={fieldCls(touched && errors.nickname)}
              />
              {touched && errors.nickname && <span className="mt-1 block text-xs text-warn">{errors.nickname}</span>}
            </label>

            <label className="block">
              <span className={FIELD_LABEL}>年级 *</span>
              <select
                value={draft.grade}
                onChange={(e) => set('grade', e.target.value)}
                className={fieldCls(touched && errors.grade)}
              >
                <option value="">请选择</option>
                {([1, 2, 3, 4] as const).map((g) => (
                  <option key={g} value={String(g)}>{GRADE_LABELS[g]}</option>
                ))}
              </select>
              {touched && errors.grade && <span className="mt-1 block text-xs text-warn">{errors.grade}</span>}
            </label>

            <label className="block">
              <span className={FIELD_LABEL}>学院 *</span>
              <input
                value={draft.college}
                onChange={(e) => set('college', e.target.value)}
                placeholder="如：光电学院"
                className={fieldCls(touched && errors.college)}
              />
              {touched && errors.college && <span className="mt-1 block text-xs text-warn">{errors.college}</span>}
            </label>

            <label className="block">
              <span className={FIELD_LABEL}>专业</span>
              <input
                value={draft.major}
                onChange={(e) => set('major', e.target.value)}
                placeholder="如：光电信息科学与工程"
                className={fieldCls()}
              />
            </label>

            <label className="block">
              <span className={FIELD_LABEL}>校区 *</span>
              <select
                value={draft.campus}
                onChange={(e) => set('campus', e.target.value)}
                className={fieldCls(touched && errors.campus)}
              >
                <option value="">请选择</option>
                {CAMPUS_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {touched && errors.campus && <span className="mt-1 block text-xs text-warn">{errors.campus}</span>}
            </label>

            {/*
              「宿舍楼号」输入已移除（2026-09-28）：同一步里已经有「🏠 我的住处」
              （App 注入的 OnboardingSetup 提供），那才是引擎真正消费的字段
              （`layer.homeBase` → `construct` 替换宿舍类块的 `__HOME__` 占位）。
              旁边再放一个自由文本的「楼号」只会制造第二个真源。
              `BasicInfo.dorm` 字段与校验保留（向后兼容读取旧数据），但 UI 不再产出。
            */}

            <label className="block">
              <span className={FIELD_LABEL}>每周运动几次（0-7）</span>
              <input
                value={draft.exercisePerWeek}
                onChange={(e) => set('exercisePerWeek', e.target.value)}
                inputMode="numeric"
                placeholder="如：3"
                className={fieldCls(touched && errors.exercisePerWeek)}
              />
              {touched && errors.exercisePerWeek && <span className="mt-1 block text-xs text-warn">{errors.exercisePerWeek}</span>}
            </label>

            {/*
              选填硬边界（住处 + 作息）：由组合根注入的 week 域组件。
              它是**本网格的若干格**（fragment）—— 不是表单下另起的一栏。
              不注入时这里什么都不渲染。
            */}
            {children}
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
