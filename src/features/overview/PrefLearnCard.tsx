import { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { loadRecords } from '@/lib/behaviorLog';
import {
  clearPrefLearn, learnPrefs, loadPrefLearnState, setPrefLearnEnabled,
  setSuggestionStatus, withStatus, type PrefLearnState, type PrefKind,
} from '@/lib/prefLearn';

interface Props {
  /** 今天（ISO 日期串）—— 统计窗口的「now」，由调用方注入（纯函数纪律：组件不读时钟） */
  todayIso: string;
}

/** 采纳后的去向说明（按建议类型给一句诚实的话 —— v1 不自动改排程） */
const APPLIED_NOTE: Record<PrefKind, string> = {
  routine: '已记下。到周计划页「作息设置」调整后，下次排程即生效（v1 不自动改）。',
  tier: '已记下。可按此在画像 / 排程设置里调整自习档位（v1 不自动改）。',
  estimate: '已记下。v1 仅提示，不自动改引擎估时。',
  // W12（v1.5）：weights 类建议采纳后下次排程注入权重补丁（调用侧接线批）
  weights: '已采纳。下次排程会按此微调节奏（留白/变动倾向）——可在本卡撤销。',
};

/**
 * 总览 · 偏好学习建议卡（F3 批 A1 v1）
 * ============================================================
 * 「越用越懂你」的落点：把 behaviorLog 近 4 周的执行记录统计成**人话建议**
 * （ learns 见 `lib/prefLearn.ts`），每条带证据 + 【采纳 / 忽略】两按钮。
 *
 * 边界（与 prefLearn.ts 文件头同一纪律）：
 *   · v1 采纳 = 记意向（写 `usst.preflearn-v1` 的 applied，幂等），**不自动改排程**；
 *   · 样本不足 → 「数据累积中」空态，不硬凑建议；
 *   · 总开关关 = 建议内容整卡隐藏 —— 但保留一行开关本体，避免「关了就找不回」
 *     的死路（这是对「整卡隐藏」的一处刻意放宽，见报告）；
 *   · 数据每次渲染即时读取（≤800 条，开销可忽略），不缓存不订阅。
 */
export function PrefLearnCard({ todayIso }: Props) {
  const [state, setState] = useState<PrefLearnState>(loadPrefLearnState);

  const records = loadRecords();
  const suggestions = withStatus(learnPrefs(records, todayIso), state.statuses);
  const pending = suggestions.filter((s) => !s.status);
  const appliedCount = suggestions.filter((s) => s.status === 'applied').length;

  /* 总开关关：建议内容不渲染，只留一行开关（重新开启的入口不能丢） */
  if (!state.enabled) {
    return (
      <section className="panel flex items-center justify-between gap-3 p-3">
        <span className="flex items-center gap-1.5 text-[12.5px] text-ink-soft">
          <Icon name="sparkle" size="sm" className="shrink-0 text-brand" />
          偏好建议已关闭
        </span>
        <Switch
          label={<span className="text-[12px]">显示建议</span>}
          checked={false}
          onChange={(next) => setState(setPrefLearnEnabled(next))}
          testId="preflearn-switch"
        />
      </section>
    );
  }

  return (
    <section className="panel p-4">
      <header className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
          <Icon name="sparkle" size="sm" className="shrink-0 text-brand" />
          越用越懂你
          {appliedCount > 0 && (
            <span className="text-[11px] font-normal text-ink-faint">已采纳 {appliedCount} 条</span>
          )}
        </h2>
        <Switch
          label={<span className="text-[12px]">显示建议</span>}
          checked={state.enabled}
          onChange={(next) => setState(setPrefLearnEnabled(next))}
          testId="preflearn-switch"
        />
      </header>

      {pending.length === 0 && suggestions.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-ink/15 bg-paper-sunken p-3 text-[12.5px] leading-relaxed text-ink-soft">
          数据累积中 —— 在周计划里标记「做了 / 没做」的块越多，这里越懂你
          （近 4 周内同一时段至少 6 条记录才会出第一条建议）。
        </p>
      ) : pending.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-ink/15 bg-paper-sunken p-3 text-[12.5px] leading-relaxed text-ink-soft">
          暂无新建议 —— 已处理 {suggestions.length} 条；想重新看到，可点右下角「清除学习记录」。
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {pending.map((s) => (
            <li key={s.id} className="rounded-xl border border-ink/10 bg-paper-sunken p-3">
              <p className="text-[13px] leading-relaxed text-ink">{s.text}</p>
              <p className="mt-1 text-[11.5px] text-ink-faint">{s.evidence}</p>
              <div className="mt-2 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setState(setSuggestionStatus(s.id, 'applied'))}
                  testId={`preflearn-adopt-${s.id}`}
                >
                  采纳
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setState(setSuggestionStatus(s.id, 'dismissed'))}
                  testId={`preflearn-dismiss-${s.id}`}
                >
                  忽略
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 已采纳条目的去向说明（诚实交代 v1 边界，不假装"已生效"） */}
      {appliedCount > 0 && (
        <ul className="mt-2 space-y-1">
          {suggestions.filter((s) => s.status === 'applied').map((s) => (
            <li key={s.id} className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-ink-faint">
              <Icon name="check" size="xs" className="mt-0.5 shrink-0 text-brand" />
              <span>{APPLIED_NOTE[s.kind]}</span>
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-3 flex items-center justify-between gap-3 border-t border-ink/10 pt-2">
        <p className="min-w-0 text-[11px] leading-snug text-ink-faint">
          v1 仅提示：采纳 / 忽略只记在本机，不自动修改排程。
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setState(clearPrefLearn())}
          testId="preflearn-clear"
        >
          清除学习记录
        </Button>
      </footer>
    </section>
  );
}
