/**
 * R批 Wave3（H1.3）· 日程评估面板
 * ============================================================================
 *
 * 用户点「让梨宝评估这版日程」后看到的全部内容。
 *
 * ── 这个界面最该做对的一件事：**不装懂** ────────────────────────────────
 *
 * 评估天然有「看起来很权威、其实不可靠」的风险。这里的每个设计决定都指向
 * 同一个目标：**让用户清楚哪些是「日程里看到了」，哪些是「日程里看不到」**。
 *
 * 所以：
 * ① `unknown` 结论**单独成区**，措辞是「看不到」而不是「不好」；
 * ② 每个可判定结论都能展开看「是哪几个块」+「依据知识库哪一条」；
 * ③ 分数永远和 `coverage`（能看到多少）同时出现 —— 单给分数就是在骗人；
 * ④ 顶部常驻免责声明，不藏在角落。
 *
 * 反过来，**不做**的事：不给「综合总分」。把运动/睡眠/学习/饮食压成一个数
 * 会让用户以为这是体检报告的分，各维度本就可以互相补偿（少运动多学习），
 * 压成总分等于替用户做了一个不该替他做的价值判断。
 */
import { useMemo, useState } from 'react';
import {
  citedSlugs,
  HEALTH_DISCLAIMER,
  type EvalFinding,
  type PlanEvaluation,
  type Severity,
} from '@/lib/planner/planEval';
import type { PlanDigest } from '@/lib/planner/planDigest';
import type { PlanReviewReport } from '@/lib/api';
import type { TimeBlock } from '@/types';

/* ============================================================
 * 展示映射（文案在此收口，不散落在 JSX）
 * ========================================================== */

const SEV_STYLE: Record<Severity, { dot: string; chip: string; label: string }> = {
  serious: { dot: 'bg-danger', chip: 'bg-danger-light text-danger-text border-danger/25', label: '需要调整' },
  warn: { dot: 'bg-warn', chip: 'bg-warn-light text-warn-text border-warn/25', label: '建议关注' },
  info: { dot: 'bg-brand', chip: 'bg-brand-light text-brand border-brand/25', label: '供参考' },
};

const STATUS_MARK: Record<EvalFinding['status'], { text: string; cls: string }> = {
  good: { text: '达标', cls: 'text-ok' },
  gap: { text: '不足', cls: 'text-warn-text' },
  unknown: { text: '看不到', cls: 'text-ink-faint' },
};

const hhmm = (min: number): string => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

const DAY_CN = ['', '一', '二', '三', '四', '五', '六', '日'];

/* ============================================================
 * 子组件
 * ========================================================== */

/** 展开看「是哪几个块 + 依据哪条」—— 可解释性的落地点。 */
function FindingRow({
  f,
  blocks,
}: {
  f: EvalFinding;
  blocks: readonly TimeBlock[];
}) {
  const [open, setOpen] = useState(false);
  const mark = STATUS_MARK[f.status];
  const sev = SEV_STYLE[f.severity];
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const evBlocks = f.evidence.map((id) => byId.get(id)).filter((b): b is TimeBlock => !!b);
  // evidence 很多时只列前 6 条 + 计数（否则一屏全是块名）
  const shown = evBlocks.slice(0, 6);
  const rest = evBlocks.length - shown.length;
  const expandable = f.basis != null || evBlocks.length > 0;

  return (
    <li className="border-b border-ink/10 py-3 last:border-b-0">
      <div className="flex items-start gap-2.5">
        <span className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${f.status === 'unknown' ? 'bg-ink-faint/50' : sev.dot}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-6 text-ink">
            {f.headline}
            <span className={`ml-2 text-[11px] font-medium ${mark.cls}`}>{mark.text}</span>
          </p>

          {f.notVisible && (
            <p className="mt-1 text-[12px] leading-5 text-ink-faint">{f.notVisible}</p>
          )}

          {f.advice.length > 0 && (
            <ul className="mt-2 space-y-1">
              {f.advice.map((a, i) => (
                <li key={i} className="text-[12px] leading-5 text-ink-soft">
                  <span className="mr-1 text-ink-faint">·</span>
                  {a}
                </li>
              ))}
            </ul>
          )}

          {expandable && (
            <>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                data-testid={`plan-eval-toggle-${f.id}`}
                className="mt-1.5 text-[11px] text-ink-faint underline decoration-dotted underline-offset-2 hover:text-ink-soft"
              >
                {open ? '收起依据' : '看依据'}
                {evBlocks.length > 0 && `（${evBlocks.length} 个块）`}
              </button>
              {open && (
                <div className="mt-2 rounded-lg bg-ink/[0.03] px-3 py-2.5" data-testid={`plan-eval-detail-${f.id}`}>
                  {f.basis && (
                    <p className="text-[11px] leading-5 text-ink-soft">
                      <span className="font-medium text-ink">依据：</span>
                      {f.basis.quote}
                      <span className="ml-1 text-ink-faint">
                        （知识库 {f.basis.slug} · {f.basis.tier} 级）
                      </span>
                    </p>
                  )}
                  {evBlocks.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {shown.map((b) => (
                        <li key={b.id} className="text-[11px] leading-5 text-ink-soft">
                          <span className="mr-1 text-ink-faint">
                            周{DAY_CN[b.dayOfWeek]} {hhmm(b.startMin)}–{hhmm(b.endMin)}
                          </span>
                          {b.title}
                        </li>
                      ))}
                      {rest > 0 && (
                        <li className="text-[11px] leading-5 text-ink-faint">…另有 {rest} 个</li>
                      )}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function DimensionBlock({
  dim,
  blocks,
}: {
  dim: PlanEvaluation['dimensions'][number];
  blocks: readonly TimeBlock[];
}) {
  const gaps = dim.findings.filter((f) => f.status === 'gap');
  const goods = dim.findings.filter((f) => f.status === 'good');
  const unknowns = dim.findings.filter((f) => f.status === 'unknown');
  const tone = gaps.length > 0 ? 'text-warn-text' : 'text-ok';
  const scoreText = dim.score == null ? '—' : String(dim.score);

  return (
    <section
      className="rounded-xl border border-ink/10 bg-white/60 px-4 py-3.5"
      data-testid={`plan-eval-dim-${dim.key}`}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h4 className="text-[13px] font-semibold text-ink">{dim.label}</h4>
        {/* 分数与覆盖度必须同时出现：单给分数就是在骗人 */}
        <span className="shrink-0 text-[11px] text-ink-faint">
          {dim.score == null ? (
            '日程里看不到'
          ) : (
            <>
              <span className={`text-[15px] font-semibold ${tone}`}>{scoreText}</span>
              <span className="ml-1">/100</span>
              <span className="ml-1.5">· 可判度 {Math.round(dim.coverage * 100)}%</span>
            </>
          )}
        </span>
      </header>

      <ul className="mt-1">
        {goods.map((f) => (
          <FindingRow key={f.id} f={f} blocks={blocks} />
        ))}
        {gaps.map((f) => (
          <FindingRow key={f.id} f={f} blocks={blocks} />
        ))}
        {unknowns.length > 0 && (
          <li className="pt-2">
            <p className="text-[11px] font-medium text-ink-faint">日程里看不到的（不等于你没做）</p>
            <ul className="mt-0.5">
              {unknowns.map((f) => (
                <li key={f.id} className="text-[12px] leading-5 text-ink-faint">
                  · {f.headline}
                  {f.notVisible && <span className="ml-1 opacity-80">{f.notVisible}</span>}
                </li>
              ))}
            </ul>
          </li>
        )}
      </ul>
    </section>
  );
}

/* ============================================================
 * 主组件
 * ========================================================== */

export function PlanEvalPanel({
  digest,
  evaluation,
  review,
  onAdopt,
}: {
  digest: PlanDigest;
  evaluation: PlanEvaluation;
  /** H2（R批 Wave3）：后端三库复核 —— loading 拉取中 / ok 有报告 / offline 不可达 */
  review?: { state: 'loading' | 'ok' | 'offline'; report?: PlanReviewReport };
  /** 采纳回调：把建议的任务骨架交回周计划（与「加一件事」同一条攒改动流 ——
   *  落到 layer.tasks + 🆕，重排后才出现在日程表；确认权仍在用户手里） */
  onAdopt?: (task: Record<string, unknown>) => void;
}) {
  const slugs = useMemo(() => citedSlugs(evaluation), [evaluation]);
  const judged = evaluation.dimensions.filter((d) => d.score != null);
  const unknownCount = evaluation.dimensions.flatMap((d) => d.findings).filter((f) => f.status === 'unknown').length;

  return (
    <div className="space-y-4" data-testid="plan-eval-panel">
      {/* 覆盖度横幅：先说「能判多少」，再给结论 */}
      <div className="rounded-xl border border-brand/25 bg-brand-light/60 px-4 py-3">
        <p className="text-[12px] leading-5 text-brand">
          这一版日程里，<span className="font-semibold">{judged.length} / {evaluation.dimensions.length}</span> 个维度能判，
          另有 <span className="font-semibold">{unknownCount}</span> 条「日程里看不到」。
          <span className="ml-1 text-brand/80">
            看不到不等于你没做 —— 线下运动、没排进日程的事，这里都看不到。
          </span>
        </p>
      </div>

      {evaluation.topAdvice.length > 0 && (
        <section className="rounded-xl border border-warn/25 bg-warn-light/50 px-4 py-3.5">
          <h3 className="text-[13px] font-semibold text-warn-text">优先看这几条</h3>
          <ul className="mt-1.5 space-y-1">
            {evaluation.topAdvice.map((a, i) => (
              <li key={i} className="text-[12px] leading-5 text-warn-text/90">
                <span className="mr-1 opacity-60">{i + 1}.</span>
                {a}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="space-y-2.5">
        {evaluation.dimensions.map((dim) => (
          <DimensionBlock key={dim.key} dim={dim} blocks={digest.blocks} />
        ))}
      </div>

      {evaluation.caveats.length > 0 && (
        <details className="rounded-xl border border-ink/10 px-4 py-3" data-testid="plan-eval-caveats">
          <summary className="cursor-pointer text-[12px] text-ink-faint">
            这些结论的局限（{evaluation.caveats.length} 条，建议看一眼）
          </summary>
          <ul className="mt-2 space-y-1">
            {evaluation.caveats.map((c, i) => (
              <li key={i} className="text-[11px] leading-5 text-ink-faint">
                · {c}
              </li>
            ))}
          </ul>
        </details>
      )}

      {slugs.length > 0 && (
        <details className="rounded-xl border border-ink/10 px-4 py-3" data-testid="plan-eval-basis">
          <summary className="cursor-pointer text-[12px] text-ink-faint">
            这些结论来自知识库的哪几条（{slugs.length} 条）
          </summary>
          <ul className="mt-2 space-y-1.5">
            {slugs.map((s) => (
              <li key={s.slug} className="text-[11px] leading-5 text-ink-soft">
                <span className="mr-1 rounded border border-ink/15 px-1 text-[10px] text-ink-faint">{s.tier} 级</span>
                {s.quote}
                <span className="ml-1 text-ink-faint">（{s.slug}）</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* H2（R批 Wave3）：后端三库复核 —— 每条建议带 source（库名 + slug + tier）。
          检索缺失时后端降级为静态口径并标「静态」，如实展示不冒充真检索。 */}
      {review?.state === 'loading' && (
        <p className="text-[11px] leading-5 text-ink-faint" data-testid="plan-review-loading">
          正在对照知识库复核…
        </p>
      )}
      {review?.state === 'offline' && (
        <p className="text-[11px] leading-5 text-ink-faint" data-testid="plan-review-offline">
          后端库检未连接 —— 以上是本地编译阈值评估；启动后端后可对照知识库复核。
        </p>
      )}
      {review?.state === 'ok' && review.report && (
        <details className="rounded-xl border border-ink/10 px-4 py-3" data-testid="plan-review-backend">
          <summary className="cursor-pointer text-[12px] text-ink-soft">
            后端三库复核（{review.report.dimensions.reduce((n, d) => n + d.advice.length, 0)} 条建议 ·{' '}
            {Object.values(review.report.retrieval).filter(Boolean).length}/{Object.keys(review.report.retrieval).length} 库命中）
          </summary>
          <div className="mt-2 space-y-2">
            {review.report.dimensions.map((dim) => (
              <div key={dim.key}>
                <p className="text-[11.5px] font-semibold text-ink">{dim.label}</p>
                <ul className="mt-1 space-y-1">
                  {dim.advice.length === 0 && (
                    <li className="text-[11px] leading-5 text-ink-faint">· 无需调整</li>
                  )}
                  {dim.advice.map((a, i) => (
                    <li key={i} className="text-[11.5px] leading-5 text-ink-soft">
                      · {a.text}
                      <span className="ml-1 whitespace-nowrap rounded border border-ink/15 px-1 text-[10px] text-ink-faint">
                        {a.source.lib} {a.source.tier} 级 · {a.source.slug}{a.source.retrieved ? '' : '（静态口径）'}
                      </span>
                      {onAdopt && a.action?.kind === 'add_task' && (
                        <button
                          type="button"
                          data-testid="plan-review-adopt"
                          onClick={() => onAdopt(a.action!.task)}
                          className="ml-1.5 rounded-md border border-brand/30 bg-brand/5 px-1.5 py-0.5 text-[10.5px] font-medium text-brand transition-colors hover:bg-brand/10"
                        >
                          采纳
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="text-[10.5px] leading-4 text-ink-faint">{review.report.caveats[0]}</p>
          </div>
        </details>
      )}

      <p className="text-[11px] leading-5 text-ink-faint">{HEALTH_DISCLAIMER}</p>
    </div>
  );
}

export default PlanEvalPanel;
