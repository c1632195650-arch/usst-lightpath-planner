/**
 * 光溯移动端 · 「我的执行状态」折叠区（任务书 P3-1）
 * ============================================================
 * CY 定位：Today 页**不下拉到底**的独立折叠区，**不干扰执行**。
 *   · 五维**独立展示**（各自一条 7 日迷你趋势，不合成一个数、无排名 —— 铁律 1，
 *     由 tests/eval-tips.test.ts 源码锁守护）；
 *   · 每维旁显示**可判度**：confident=false → 「数据累积中（N/7 天）」，绝不显示 0 分；
 *   · 一句「本周最该改的一件事」→ 最弱且可判的一维 + 指向习惯库方法（可展开看详情）。
 *
 * 2026-10-08（CY 反馈「每条是啥、有啥影响看不明白」）：每维改为**可展开小卡** ——
 *   · 常显：维度名 + **一句「在量什么」**（用户视角定义）；
 *   · 展开：「怎么看」（怎么读这个数、偏低时通常意味着什么）+「数据依据」
 *     （compute 层早已算好的 basis 原文，如实回显）+「可以怎么做」（该维习惯库方法）；
 *   · 引导语一句话交代数据从哪来、为什么有些维度显示「数据累积中」。
 *   三条铁律不变：不合成、unknown 不降级为 0、不跨维比较。
 */
import { useState } from 'react';
import type { DailySeries } from './eval/compute.ts';
import { tipForDim } from './eval/compute.ts';
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

/** 每维一句「在量什么」——常显在维度名下方（用户视角，不复述字段名） */
const DIM_BLURB: Record<DimId, string> = {
  completion: '排进日程的事，你真正勾「完成」的比例',
  procrastination: '中长期待办平均比计划晚几天办成（只算已办成的）',
  continuity: '连续多少天有完成记录 —— 习惯靠惯性省力',
  timeDiscipline: '平均比计划晚开始几分钟（提前不计）',
  selfReport: '每天几道自评题的近期均分（行为锚定，不是心情打分）',
};

/** 每维「怎么看」——读法 + 偏低时通常意味着什么（只给方向，不造精度） */
const DIM_READ: Record<DimId, string> = {
  completion: '越接近 100% 说明计划排得住；明显偏低时，多半不是懒 —— 是排太满或太散，先把一件事拆小再排。',
  procrastination: '这个数字就是你平均攒的天数；攒到两三天，就把大事拆成当天能完成的小块。',
  continuity: '连续越久越省力；断了不算惩罚 —— 今天勾一笔，就从 1 重新数。',
  timeDiscipline: '几分钟以内＝基本按点开始；超过半小时，通常是把时间排太紧了，留点缓冲会更好执行。',
  selfReport: '和你实际的勾选情况对照着看：差值就是「自我感觉」和「真实执行」之间的距离。',
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
    <span data-testid={`m-eval-spark-${dim}`} className="inline-flex h-5 items-end gap-0.5" aria-hidden>
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
  const [openDim, setOpenDim] = useState<DimId | null>(null);
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
        <span className="font-display flex items-center gap-2 text-sm font-semibold text-ink">
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
          <p className="px-1 text-xs leading-5 text-ink-faint">
            全部来自你自己的记录（勾完成的块、顺延的动作、答过的小题）。五个维度分开看、各管各的；
            记录还不满 7 天的维度会显示「数据累积中」，不会替你编一个 0 分填在这里。
          </p>

          {DIM_IDS.map((dim) => {
            const r = profile.dims[dim];
            const tip = tipForDim(dim);
            const basisText = r.basis.objective[0] ?? r.basis.selfReport[0] ?? '';
            const expanded = openDim === dim;
            return (
              <div key={dim} data-testid={`m-eval-dim-${dim}`} className="rounded-xl bg-paper-sunken">
                <button
                  type="button"
                  data-testid={`m-eval-dim-toggle-${dim}`}
                  onClick={() => setOpenDim((v) => (v === dim ? null : dim))}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                >
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">{DIM_LABELS[dim]}</span>
                    <span className="mt-0.5 block text-[11px] leading-4 text-ink-faint">{DIM_BLURB[dim]}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {r.confident && <DimSpark dim={dim} series={series} />}
                    {r.confident ? (
                      <span className="font-display text-sm font-semibold text-ink">{valueText(dim, r)}</span>
                    ) : (
                      <span className="text-xs text-ink-faint">数据累积中（{r.sampleSize}/7 天）</span>
                    )}
                    <span className="text-xs text-ink-faint">{expanded ? '▾' : '▸'}</span>
                  </span>
                </button>

                {expanded && (
                  <div data-testid={`m-eval-dim-detail-${dim}`} className="space-y-1.5 px-3 pb-2.5">
                    <p className="text-[11px] leading-5 text-ink-soft">
                      <span className="font-semibold text-ink">怎么看：</span>{DIM_READ[dim]}
                    </p>
                    {basisText !== '' && (
                      <p className="text-[11px] leading-5 text-ink-faint">
                        <span className="font-semibold">数据依据：</span>{basisText}
                      </p>
                    )}
                    {tip && (
                      <p className="text-[11px] leading-5 text-ink-soft">
                        <span className="font-semibold text-ink">可以怎么做：</span>
                        {tip.title} —— {tip.summary}
                      </p>
                    )}
                  </div>
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
