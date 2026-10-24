/**
 * 可信度徽章（F2/B2 不确定分级，2026-10-24）
 * ============================================================
 * 四态：✅ 有据 / ⚠️ 含推断 / 🧩 校内数据 / ❌ 无据 —— server 一处计算，这里只呈现。
 * 口径过过 project-core「懂分寸」：如实标注、不吓人、不装权威。
 * 未知 level / 旧消息无该字段 → 不渲染（与 confidenceModel 的宁缺毋滥一致）。
 */
import { Tag } from '@/components/ui/Tag';
import { confidenceMeta } from '@/components/ui/confidenceModel';

export function ConfidenceBadge({ level, reason, testId }: {
  level: string | undefined | null;
  /** server 给的一句话理由（有则悬停可见，比默认 hint 更具体） */
  reason?: string;
  testId?: string;
}) {
  const meta = confidenceMeta(level);
  if (!meta) return null;
  return (
    <span data-testid={testId} title={reason || meta.hint} className="inline-flex">
      <Tag tone={meta.tone}>{meta.label}</Tag>
    </span>
  );
}
