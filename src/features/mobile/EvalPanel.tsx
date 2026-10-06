/**
 * 光溯移动端 · 「我的执行状态」折叠区（任务书 P3-1）
 * ============================================================
 * CY 定位：Today 页**不下拉到底**的独立折叠区，**不干扰执行**。
 *   · 五维**独立展示**（各自一条 7 日迷你趋势，无总分、无排名 —— 铁律 1，
 *     由 tests/eval-tips.test.ts 源码锁守护）；
 *   · 每维旁显示**可判度**：confident=false → 「数据累积中（N/7 天）」，绝不显示 0 分；
 *   · 一句「本周最该改的一件事」→ 最弱且可判的一维 + 指向习惯库方法（可展开看详情）。
 */
import { useState } from 'react';
import type { DailySeries } from './eval/compute.ts';
import type { DimId, DimResult, ExecutionProfile } from './eval/model.ts';
import { DIM_IDS, DIM_LABELS } from './eval/model.ts';

/** 各维迷你趋势的归一上限（曲线只做形状参考，数值以文字为准） */
const SERIES_MAX: Record<DimId, number> = {
  completion: 100,
  procrastination: 3,
  continuity: 7,
  timeDiscipline: 60,
  selfReport: 100,
};

function valueText(dim: DimId, r: DimResult & { confident: true }): string {
  switch (dim) {
    case 'completion': return `${r.value}%`;
    case 'procrastination': return r.value === 0 ? '按时完成' : `平均晚 ${r.value} 天`;
    case 'continuity': return `连续 ${r.value} 天`;
    case 'timeDiscipline': return r.value === 0 ? '开始挺准时' : `平均晚开始 ${r.value} 分钟`;
    case 'selfReport': return `${r.value} 分`;
  }
}

/** 一维的 7 日迷你柱（null = 当天无数据，留空档不补 0） */
function DimSpark({ dim, series }: { dim: DimId; series: DailySeries }) {
  const max = SERIES_MAX[dim];
  const points = series[dim];
  return (
    <span data-testid={`m-eval-spark-${dim}`} className="ml-2 inline-flex h-5 items-end gap-0.5" aria-hidden>
      {points.map((v, i) => (
        v === null
          ? <span key={i} className="h-0.5 w-1.5 rounded-full bg-ink/15" />
          : <span key={i} className="w-1.5 rounded-full bg-brand/70" style={{ height: `${Math.max(12, (v / max) * 100)}%` }} />
      ))}
    </span>
  );
}

export default function EvalPanel({ profile, series, demoBadge }: {
  profile: ExecutionProfile;
  series: DailySeries;
  /** M4b：dev 样例通道 → 「样例数据」角标（不得伪装成真实数据） */
  demoBadge?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const anyConfident = DIM_IDS.some((d) => profile.dims[d].confident);

  return (
    <section data-testid="m-eval-panel" className="rounded-card bg-paper-card shadow-sm">
      <button
        type="button"
        data-testid="m-eval-toggle"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          我的执行状态
          {demoBadge && (
            <span data-testid="m-eval-demo-badge" className="rounded-full bg-accent-light px-2 py-0.5 text-[10px] font-semibold text-ink-soft">
              样例数据
            </span>
          )}
        </span>
        <span className="text-xs text-ink-faint">{open ? '收起 ▲' : '展开 ▼'}</span>
      </button>

      {open && (
        <div className="space-y-2 px-4 pb-4">
          {DIM_IDS.map((dim) => {
            const r = profile.dims[dim];
            return (
              <div key={dim} data-testid={`m-eval-dim-${dim}`} className="flex items-center justify-between rounded-xl bg-paper-sunken px-3 py-2">
                <div className="flex items-center">
                  <span className="text-sm text-ink">{DIM_LABELS[dim]}</span>
                  {r.confident && <DimSpark dim={dim} series={series} />}
                </div>
                {r.confident ? (
                  <span className="text-sm font-semibold text-ink">{valueText(dim, r)}</span>
                ) : (
                  <span className="text-xs text-ink-faint">数据累积中（{r.sampleSize}/7 天）</span>
                )}
              </div>
            );
          })}

          {/* 本周最该改的一件事：只挑一个维度给方法，不做任何合成分数 */}
          {profile.focus ? (
            <div data-testid="m-eval-focus" className="rounded-xl bg-brand-light px-3 py-2.5">
              <p className="text-sm font-semibold text-ink">
                本周最该改的一件事：{profile.focus.tip.title}
              </p>
              <button type="button" className="mt-1 text-xs text-brand underline" onClick={() => setTipOpen((v) => !v)}>
                {tipOpen ? '收起方法' : '看方法'}
              </button>
              {tipOpen && (
                <p className="mt-1 text-xs leading-5 text-ink-soft">{profile.focus.tip.summary}</p>
              )}
            </div>
          ) : (
            <p className="px-1 text-xs leading-5 text-ink-faint">
              {anyConfident ? '' : '数据还在累积 —— 每天来这里点一下完成、答几道小题，7 天后就能看见趋势和方法建议。'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
