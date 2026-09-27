/**
 * H2：模式问询窗口的对外模型壳（ModeSetupDialog / tests 消费）
 * ============================================================
 * 干跑本体 `modePreview` / `modeSetupRequest` 在 weekPlanForChat.ts（防腐层）——
 * construct/lifeModeExtrasOf 属 lib/planner，libao 侧只有那一个接缝
 * （AGENTS §三红线 6）。本文件只做 re-export 与模式卡元数据。
 */
import { LIFE_MODES } from '@/data/usst';

export {
  modePreview,
  modeSetupRequest,
  type ModePreviewResult,
  type ModePreviewStats,
} from './weekPlanForChat';

/** 模式卡元数据（名字 + emoji + tagline，来自 usst.ts 的六模式表） */
export const MODE_OPTIONS = LIFE_MODES.map((m) => ({
  id: m.id,
  name: m.name,
  emoji: m.emoji,
  tagline: m.tagline,
}));
