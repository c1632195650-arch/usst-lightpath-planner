import { useState } from 'react';
import {
  CAMPUS_OPTIONS,
  GRADE_LABELS,
  loadBasicInfo,
  saveBasicInfo,
  type BasicInfo,
} from '@/lib/identity';
import { EMPTY_DRAFT, parseBasicInfo, validateBasicInfo, type BasicInfoDraft } from './basicInfo';
import { Input, Select } from '@/components/ui/FormControls';

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
 *
 * W9-批1（2026-10-25）：8 处手写 input/select 换 ui/FormControls 三件套——
 * 外置 label + 44px 命中 + 聚焦外环 + 错误态成体系（placeholder/select 选项序保持，
 * E2E 锚点零漂移；错误提示从「label 内嵌 span」移到 FieldShell 的 hint 槽位）。
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

  const hint = (msg?: string | false) => (touched && msg ? msg : undefined);

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
            <Input
              label="称呼"
              required
              name="nickname"
              value={draft.nickname}
              onChange={(e) => set('nickname', e.target.value)}
              placeholder="怎么称呼你"
              error={touched && Boolean(errors.nickname)}
              hint={hint(errors.nickname)}
            />

            <Select
              label="年级"
              required
              name="grade"
              value={draft.grade}
              onChange={(e) => set('grade', e.target.value)}
              error={touched && Boolean(errors.grade)}
              hint={hint(errors.grade)}
            >
              <option value="">请选择</option>
              {([1, 2, 3, 4] as const).map((g) => (
                <option key={g} value={String(g)}>{GRADE_LABELS[g]}</option>
              ))}
            </Select>

            <Input
              label="学院"
              required
              name="college"
              value={draft.college}
              onChange={(e) => set('college', e.target.value)}
              placeholder="如：光电学院"
              error={touched && Boolean(errors.college)}
              hint={hint(errors.college)}
            />

            <Input
              label="专业"
              name="major"
              value={draft.major}
              onChange={(e) => set('major', e.target.value)}
              placeholder="如：光电信息科学与工程"
            />

            <Select
              label="校区"
              required
              name="campus"
              value={draft.campus}
              onChange={(e) => set('campus', e.target.value)}
              error={touched && Boolean(errors.campus)}
              hint={hint(errors.campus)}
            >
              <option value="">请选择</option>
              {CAMPUS_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>

            <Input
              label="宿舍楼号"
              name="dorm"
              value={draft.dorm}
              onChange={(e) => set('dorm', e.target.value)}
              placeholder="如：五公寓，只填楼号"
              error={touched && Boolean(errors.dorm)}
              hint={hint(errors.dorm)}
            />

            <Input
              label="平日就寝（分钟 0-1440）"
              name="sleepMin"
              value={draft.sleepMin}
              onChange={(e) => set('sleepMin', e.target.value)}
              inputMode="numeric"
              placeholder="如：1380（23:00）"
              error={touched && Boolean(errors.sleepMin)}
              hint={hint(errors.sleepMin)}
            />

            <Input
              label="每周运动几次（0-7）"
              name="exercisePerWeek"
              value={draft.exercisePerWeek}
              onChange={(e) => set('exercisePerWeek', e.target.value)}
              inputMode="numeric"
              placeholder="如：3"
              error={touched && Boolean(errors.exercisePerWeek)}
              hint={hint(errors.exercisePerWeek)}
            />
          </div>

          {touched && !canNext && errorList.length > 0 && (
            <p role="alert" className="mt-5 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn-text">
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
