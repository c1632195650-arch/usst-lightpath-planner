/**
 * 知识库 → 排程引擎的接线层（E 批 E1 · 2026-09-28 · 纯函数）
 * ============================================================
 * 为什么要有这个文件：methods.ts / health.ts 早已把 method_kb / health_kb 编译成
 * 机器参数，但引擎从未 import 过它们（E 批前实测 construct.ts 的 import 表零命中）
 * ——「知识在库里，决策在拍脑袋」。本文件是**唯一**把两库参数接进引擎的点。
 *
 * 边界（与 methods.ts / health.ts 同构且更严）：
 *   · 只做**钳制与档位替换**，不发明任何新数值 —— 每个数字都能溯源到
 *     methodParams.generated / healthParams.generated（构建期编译，出处见 _meta.provenance）；
 *   · 总开关 `knowledgeWired()`：缺省**开启**（G 批 2026-10-01 拍板全开，golden 已按
 *     开启态重拍）；env 显式置 `'0'`/`'false'` 可关闭 —— 逃生门，回 E 批前行为；
 *   · 本文件是 CY 新增叶子：不 import `templates.ts`，也不被它 import；
 *     目录归属 Ray，归属与命名请 B 复核（AGENTS.md 文件红线）。
 *
 * 「知识」与「决策」的分工（懂分寸）：
 *   知识库给出的是**人群底线**（深度工作单块上限、久坐打断、自习档位）——
 *   它赢过画像的自动调整，但**永远输给用户明确说过的话**（corrections 层在其后生效）。
 */

import { DEEP_WORK, STUDY_DURATIONS } from './methods.ts';
import { SEDENTARY } from './health.ts';
import type { PhasePolicy } from '@/types';

/* ============================================================
 * 一、总开关（缺省开启；G 批 2026-10-01 起，golden 已按开启态重拍）
 * ========================================================== */

/**
 * 知识接线开关。双路读取：
 *   · Node（测试/脚本）：`process.env.KNOWLEDGE_WIRED`；
 *   · Vite（浏览器）：`import.meta.env.VITE_KNOWLEDGE_WIRED`。
 * 两个环境各缺一样，所以按「谁在谁说了算」读。**缺省 true**（E 批灰度期已结束）；
 * env 显式置 `'0'`/`'false'` 关闭。每次调用都读（不在 import 期定死）——
 * 测试可以在用例内翻开关再复原。
 */
export function knowledgeWired(): boolean {
  const on = (v: string | undefined) => v == null || (v !== '0' && v !== 'false');
  let v: string | undefined;
  try {
    v = typeof process !== 'undefined'
      ? (process as unknown as { env?: Record<string, string | undefined> }).env?.KNOWLEDGE_WIRED
      : undefined;
  } catch {
    v = undefined;
  }
  if (v != null) return on(v);
  try {
    v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.VITE_KNOWLEDGE_WIRED;
  } catch {
    v = undefined;
  }
  return on(v);
}

/* ============================================================
 * 二、阶段策略补丁（buildPhases 消费；画像之后、校正之前）
 * ========================================================== */

export interface KnowledgePolicyPatch {
  patch: Partial<PhasePolicy>;
  reasons: string[];
}

/**
 * 知识库对阶段策略的**钳制**（不是建议）：
 *   · maxBlockMin ≤ DEEP_WORK.blockMin（90）—— 深度工作 + 超日节律：
 *     单块专注约一个周期（90 分钟），超过的拆开排，否则效率陡降。
 *
 * 只在确实需要钳制时才产出键 —— 没超限就空 patch，不无中生有理由。
 * `_kind` 保留在签名里：将来健康库/方法库若有按阶段不同的底线（如考试周睡眠窗口），
 * 在这里分 kind 展开，调用方不用改。
 */
export function policyPatchFromKnowledge(
  _kind: PhasePolicy extends never ? never : import('@/types').PhaseKind,
  current: PhasePolicy,
): KnowledgePolicyPatch {
  const patch: Partial<PhasePolicy> = {};
  const reasons: string[] = [];
  if (current.maxBlockMin > DEEP_WORK.blockMin) {
    patch.maxBlockMin = DEEP_WORK.blockMin;
    reasons.push(
      `深度工作研究：单块专注不超过 ${DEEP_WORK.blockMin} 分钟（约一个注意力周期），超过的拆开排`,
    );
  }
  return { patch, reasons };
}

/* ============================================================
 * 三、自习块档位（construct 消费）
 * ========================================================== */

/**
 * 自习块时长档位 —— 方法库间隔重复/番茄条目编译出的 [25, 50]，
 * 替代 construct 里拍脑袋的 [45, 60, 90]（methods.ts 头注点名的去向）。
 * 只在 knowledgeWired() 时由调用方取用；这里不做开关判断（纯函数）。
 */
export function studyBlockDurations(): readonly number[] {
  return STUDY_DURATIONS;
}

/**
 * 久坐安全档位：从既有档位里**剔除**超过 `SEDENTARY.breakEveryMin`（60 分钟）的档
 * —— 连坐一小时就该起身（健康库久坐条目）。不发明新数值：
 * 全部超限时兜底 = min(最小档, 上限)，仍是「原档位与人群上限的较小者」。
 * 纯函数；开关判断在调用方（construct.placeTemplate，只对 kind==='study' 生效）。
 */
export function sedentarySafeDurations(durations: readonly number[]): number[] {
  const safe = durations.filter((d) => d <= SEDENTARY.breakEveryMin);
  if (safe.length > 0) return [...safe];
  return [Math.min(...durations, SEDENTARY.breakEveryMin)];
}

/* ============================================================
 * 四、本批**未接线**的知识（如实登记，防「以为接了」）
 * ========================================================== */

/**
 * 睡眠保底窗口的**未来**接法提示：construct 的 placeTemplate 已支持
 * `notBeforeMin` / `notAfterMin`（D4 加的对偶上界），睡眠保底要做的是
 * 给非豁免块的候选空档叠「不在睡眠窗口内」约束 —— 但窗口的锚点
 * （用户就寝/起床时间）在 identity 基础信息里，PlanRequest 尚未携带。
 * 等契约侧把 sleepMin 递进来再接（改契约须双方确认，见工作单 §5 备注）。
 */
export const KNOWLEDGE_PARTIALS: readonly string[] = [
  // 2026-10-02 白天批 P1-2 结项：就寝时间经 dayWindowWithFallback（作息设置真源 →
  // 问卷 sleepMin 兜底）进 PlanRequest.dayStart/dayEnd 正式契约，引擎零改动消费。
  '每周活动量下限未接线（需 construct 活动块生成策略，150min/周均摊）',
  '模块库（templates.ts）既有自习档位 [45,60,90] 未动（属地文件不在本批授权表）；'
    + '仅策略现场工厂与久坐安全档受 knowledgeWired 控制',
];
