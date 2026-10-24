/**
 * 置信度徽章 + 来源卡片的纯逻辑模型（F2/B1+B2，2026-10-24）
 * ============================================================
 * server 端（server/confidence.py）一处计算四态，这里只做**呈现映射**：
 * 文案 / 色调 / 截断逻辑全部确定性，node:test 直接测本文件（无 DOM 依赖）。
 * 文案口径过过 project-core「懂分寸」：如实分级、不吓人、不装权威。
 */
import type { RagSource } from '@/lib/api';

export type ConfidenceLevel = 'cited' | 'inferred' | 'structured' | 'none';

export interface ConfidenceMeta {
  /** 徽章短文案（符号前缀与 F2 工作单四态表一致） */
  label: string;
  /** ui/Tag 的 tone */
  tone: 'ok' | 'warn' | 'brand' | 'line';
  /** 无障碍/悬停兜底解释（server 没给 reason 时用） */
  hint: string;
}

export const CONFIDENCE_META: Record<ConfidenceLevel, ConfidenceMeta> = {
  cited: { label: '✅ 依据校园公开信息', tone: 'ok', hint: '回答依据校园公开资讯，可点开下方来源核对' },
  inferred: { label: '⚠️ 部分为梨宝的推断', tone: 'warn', hint: '官方信息与梨宝经验混合，具体以官方通知为准' },
  structured: { label: '🧩 来自校内数据', tone: 'brand', hint: '来自校内空间/方法/健康知识库的结构化数据' },
  none: { label: '❌ 没查到可靠依据', tone: 'line', hint: '知识库外或没有可靠来源，梨宝只能凭经验聊聊' },
};

/** level → 呈现元数据；未知/缺失（旧后端、恢复的历史消息）返回 null → 不渲染徽章，宁缺毋滥。 */
export function confidenceMeta(level: string | undefined | null): ConfidenceMeta | null {
  if (level === 'cited' || level === 'inferred' || level === 'structured' || level === 'none') {
    return CONFIDENCE_META[level];
  }
  return null;
}

/** 来源卡片可见集：默认截前 max 条，展开后全量；空来源恒空数组。 */
export function visibleSources(sources: RagSource[], expanded: boolean, max = 3): RagSource[] {
  if (!sources || sources.length === 0) return [];
  return expanded ? sources : sources.slice(0, max);
}
