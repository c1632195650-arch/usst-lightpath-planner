import { EmptyState } from '@/components/ui/EmptyState';
import type { UserProfile } from '@/types';

/**
 * 【人 A 负责】问卷与学习画像
 *
 * ── 输入 ──   无（用户填答）
 * ── 输出 ──   UserProfile 对象 → patch({ profile })
 *
 * ── 要做的事（见 docs/features.md M1）──
 *   1. 15 题问卷：目标 / 作息 / 能量曲线 / 压力承受 / 兴趣
 *   2. 画像雷达图 + 人话解读
 *   3. 结果写入 storage
 *
 * ── 硬性约束 ──
 *   · 不要用 MBTI。问「可观测行为」，不问「你觉得你是什么样的人」。
 *     例：不问"你是内向还是外向"，问"连续独处 3 小时后你会想找人说话吗"。
 *   · 测评结果只存本地，绝不上传。
 *   · 必须支持中途退出后回填上次的答案。
 */
interface Props {
  profile: UserProfile | null;
  onSave: (p: UserProfile) => void;
}

export default function QuizPage({ profile, onSave }: Props) {
  if (profile) {
    return (
      <div className="px-4">
        <EmptyState
          icon="🎯"
          title="画像已生成"
          description={`目标：${profile.goal} · 作息：${profile.wakeTime}–${profile.sleepTime} · 期望留白 ${Math.round(profile.blankRate * 100)}%`}
        />
      </div>
    );
  }

  return (
    <div className="px-4">
      <EmptyState
        icon="📝"
        title="TODO：15 题问卷"
        description="人 A 负责。输入输出契约见本文件顶部注释，详细条目见 docs/features.md。"
      />
      {/* 完成后删除占位按钮，接真实表单 */}
      <div className="mt-4 text-center">
        <button
          className="text-[13px] text-ink-faint underline"
          onClick={() =>
            onSave({
              version: 1,
              goal: 'explore',
              chronotype: 'neutral',
              weeklyStudyHours: 20,
              stressTolerance: 3,
              interests: [],
              wakeTime: '07:30',
              sleepTime: '23:30',
              blankRate: 0.35,
              createdAt: new Date().toISOString(),
            })
          }
        >
          （占位）填入一份示例画像
        </button>
      </div>
    </div>
  );
}
