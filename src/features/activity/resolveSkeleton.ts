/**
 * 骨架四级解析（设计书 §6.10.2 / §16）
 * ============================================================
 * 纯函数：同输入必得同输出。永远有结果，永远不抛。
 *
 * 四级解析（优先级从高到低）：
 *   ① Goal 里已存 `subAreas`？→ 用用户改过的
 *   ② 撞上模板？→ 用模板的具名子领域
 *   ③ 按六大类取骨架？→ 打底 / 主线 / 收口
 *   ④ 通用骨架（兜底）
 *
 * **decomposeGoal 只认结果，不认它从哪一级来。**
 */
import type { Goal } from './goalStore';
import { categoryOf } from './goalStore';
import {
  GENERIC_SKELETON, CATEGORY_SKELETONS,
  type SlotDef,
} from '@/data/goalSkeletons';

/** 解析结果 —— 统一的槽位形状，无论来自哪一级 */
export interface ResolvedSlot {
  slot: SlotDef['slot'];
  name: string;
  weight: number;
  shape: SlotDef['shape'];
  action: string;
}

/** 从模板名匹配具名子领域（四级解析的第②层） */
function matchTemplate(goal: Goal): ResolvedSlot[] | null {
  // 目标模板匹配：title 包含已知模板的关键词
  const t = goal.title;
  if (t.includes('考研')) {
    return [
      { slot: 'base',  name: '数学',   weight: 0.40, shape: 'deep',     action: '专题练习' },
      { slot: 'base',  name: '英语',   weight: 0.30, shape: 'fragment', action: '词汇阅读' },
      { slot: 'base',  name: '政治',   weight: 0.15, shape: 'fragment', action: '要点梳理' },
      { slot: 'main',  name: '专业课', weight: 0.15, shape: 'deep',     action: '教材推导' },
    ];
  }
  if (t.includes('建模') || t.includes('数模')) {
    return [
      { slot: 'base',  name: '建模', weight: 0.40, shape: 'deep', action: '模型构建' },
      { slot: 'base',  name: '编程', weight: 0.35, shape: 'deep', action: '代码实现' },
      { slot: 'close', name: '论文', weight: 0.25, shape: 'deep', action: '论文写作' },
    ];
  }
  if (t.includes('四六级') || t.includes('英语') && t.includes('级')) {
    return [
      { slot: 'base',  name: '词汇',   weight: 0.30, shape: 'fragment', action: '词汇背诵' },
      { slot: 'main',  name: '听力阅读', weight: 0.40, shape: 'deep',   action: '真题练习' },
      { slot: 'close', name: '写作',    weight: 0.30, shape: 'sprint',  action: '写作练习' },
    ];
  }
  return null;
}

/**
 * 四级解析。**永远返回非空数组**（至少有通用骨架兜底）。
 * 权重和 = 1（浮点容差 1e-9）。
 */
export function resolveSkeleton(goal: Goal): ResolvedSlot[] {
  // ① 用户自己定的 subAreas（最高优先）
  if (goal.subAreas && goal.subAreas.length > 0) {
    return goal.subAreas.map((sa) => ({
      slot: 'main' as const,
      name: sa.name,
      weight: sa.weight,
      shape: sa.shape,
      action: sa.name,
    }));
  }

  // ② 模板具名子领域
  const tpl = matchTemplate(goal);
  if (tpl) return tpl;

  // ③ 类别骨架
  const cat = categoryOf(goal);
  const catSlots = CATEGORY_SKELETONS[cat];
  if (catSlots) return catSlots.map((s) => ({ ...s }));

  // ④ 通用骨架（兜底 —— 任何目标都套得上）
  return GENERIC_SKELETON.map((s) => ({ ...s }));
}
