/**
 * 知识库参数解析层（设计书 §9 S2 / §10.7.6）
 * ============================================================
 * 把「参数值 + 语境 + 证据等级」合成一个**可安全消费**的接口。
 *
 * ── 为什么需要这一层 ──────────────────────────────────────────
 * CY 的参数是扁平的（§10.8.3）：
 *   · 没有适用条件 → 会被无条件误用（"跑步"也进"考前冲刺"）
 *   · 没有证据等级 → 分级使用规则落不了地
 *   · 没有禁忌 → 引擎不知道参数在什么情况下不该用
 *
 * 本层补上这三样，让调用方能安全地按语境取值。
 *
 * ── 分级使用规则（§10.7.6）────────────────────────────────────
 *   A/B → 硬默认 · C → 默认档可改 · D → 默认档 + 标等级 + 可覆盖
 *   contested → 只作提示 · escalate → 不进引擎
 */
import { METHOD_PARAMS } from '@/data/methodParams.generated.ts';
import { HEALTH_PARAMS } from '@/data/healthParams.generated.ts';
import {
  METHOD_CONTEXT, METHOD_PROVENANCE,
  type KbContext, type KbProvenance,
  type KbContextMap, type KbProvenanceMap,
} from '@/data/kbContext';

export type KbTier = 'A' | 'B' | 'C' | 'D';

export interface ParamContext {
  /** 当前阶段（如「期末」「冲刺」） */
  phase?: string;
  /** 当前任务（如 'mcm' 'cet'） */
  task?: string;
  /** 当前类别（如 'health' 'academic'） */
  category?: string;
}

export interface ResolvedParam<T = number | readonly number[] | readonly string[]> {
  key: string;
  /** 最终采用的值（未命中时 = fallback） */
  value: T;
  /** 知识库原值（供诊断对照） */
  kbValue: T;
  /** 适用条件是否命中 */
  applied: boolean;
  tier: KbTier | null;
  slug: string | null;
  contraindications: readonly string[];
  /** applied=false 时必填 —— 「为什么没用库里的值」 */
  reason?: string;
}

/* ── 来源数据 ────────────────────────────────────────────── */

type ParamSource = {
  blocks: Record<string, unknown>;
  context: KbContextMap;
  provenance: KbProvenanceMap;
};

const methodBlocks = METHOD_PARAMS.blocks as unknown as Record<string, unknown>;
const healthBlocks = HEALTH_PARAMS.blocks as unknown as Record<string, unknown>;

const SOURCES: Record<string, ParamSource> = {
  method: {
    blocks: methodBlocks,
    context: METHOD_CONTEXT,
    provenance: METHOD_PROVENANCE,
  },
  health: {
    blocks: healthBlocks,
    context: {},
    provenance: (HEALTH_PARAMS as unknown as { _meta: { provenance?: KbProvenanceMap } })._meta.provenance ?? {},
  },
};

/* ── 解析 ────────────────────────────────────────────────── */

function findInSources(key: string): { value: unknown; ctx?: KbContext; prov?: KbProvenance } | null {
  for (const src of Object.values(SOURCES)) {
    if (key in src.blocks) {
      return {
        value: src.blocks[key],
        ctx: src.context[key],
        prov: src.provenance[key],
      };
    }
  }
  return null;
}

/** 适用条件命中？—— `ctx` 为空或缺某维度 = 全部适用 */
function isApplicable(ctx: KbContext | undefined, pc: ParamContext): boolean {
  if (!ctx) return true;
  if (ctx.phase && pc.phase && !ctx.phase.includes(pc.phase)) return false;
  if (ctx.task && pc.task && !ctx.task.includes(pc.task)) return false;
  if (ctx.category && pc.category && !ctx.category.includes(pc.category)) return false;
  return true;
}

/** 按语境解析单个参数 */
export function resolveParam<T>(
  key: string,
  pc: ParamContext,
  fallback: T,
): ResolvedParam<T> {
  const found = findInSources(key);
  if (!found) {
    return {
      key, value: fallback, kbValue: fallback,
      applied: false, tier: null, slug: null,
      contraindications: [],
      reason: `参数 ${key} 在知识库中不存在`,
    };
  }

  const { ctx, prov } = found;
  const applicable = isApplicable(ctx, pc);
  const contraindications = ctx?.contraindications ?? [];

  if (!applicable) {
    const reasons: string[] = [];
    if (ctx?.phase && pc.phase && !ctx.phase.includes(pc.phase))
      reasons.push(`仅适用于阶段 ${ctx.phase.join('/')}，当前为 ${pc.phase}`);
    if (ctx?.task && pc.task && !ctx.task.includes(pc.task))
      reasons.push(`仅适用于任务 ${ctx.task.join('/')}，当前为 ${pc.task ?? '未知'}`);
    if (ctx?.category && pc.category && !ctx.category.includes(pc.category))
      reasons.push(`仅适用于类别 ${ctx.category.join('/')}，当前为 ${pc.category}`);

    return {
      key, value: fallback, kbValue: found.value as T,
      applied: false,
      tier: prov?.tier ?? null,
      slug: prov?.slug ?? null,
      contraindications,
      reason: reasons.join('；') || '语境不匹配',
    };
  }

  return {
    key,
    value: found.value as T,
    kbValue: found.value as T,
    applied: true,
    tier: prov?.tier ?? null,
    slug: prov?.slug ?? null,
    contraindications,
  };
}

/** 一次性解析全部已知参数（诊断窗口用） */
export function resolveAll(pc: ParamContext): ResolvedParam[] {
  const keys = new Set<string>();
  for (const src of Object.values(SOURCES)) {
    for (const k of Object.keys(src.blocks)) keys.add(k);
  }
  return [...keys].sort().map((k) => {
    // fallback 取第一个来源的值
    const found = findInSources(k);
    const fb = found?.value;
    return resolveParam(k, pc, fb as never);
  });
}
