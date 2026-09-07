import { useState } from 'react';
import { useAppState } from '@/lib/storage';
import QuizPage from '@/features/quiz/QuizPage';
import ScheduleImportPage from '@/features/schedule/ScheduleImportPage';
import PlanPage from '@/features/plan/PlanPage';

/**
 * 应用外壳
 *
 * ⚠️ 刻意没有引入 react-router。
 *    理由：20 天 + 小白 + AI 生成，路由是多一个依赖就多一类坑。
 *    用 tab state 切换足够，需要深链接（分享某个计划）时再加。
 *
 * 这个文件由「人 A」统一维护。人 B 不要改 —— 要加页面在群里说一声。
 */

const TABS = [
  { id: 'quiz', label: '画像', icon: '🎯', owner: 'A' },
  { id: 'schedule', label: '课表', icon: '📅', owner: 'B' },
  { id: 'plan', label: '计划', icon: '🌿', owner: 'A' },
  { id: 'exam', label: '冲刺', icon: '⏳', owner: 'B' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function App() {
  const [tab, setTab] = useState<TabId>('quiz');
  const { state, patch, reset } = useAppState();

  return (
    <div className="page-shell">
      {/* 顶部品牌区 */}
      <header className="px-4 pt-6 pb-4">
        <div className="flex items-baseline gap-2">
          <h1 className="text-[22px] font-extrabold tracking-tight">光溯</h1>
          <span className="text-[12.5px] text-ink-faint">上理生涯规划助手</span>
        </div>
        <p className="text-[12.5px] text-ink-faint mt-1">
          不是帮你学更多，是让你的计划真的被执行。
        </p>
      </header>

      {/* 内容区 */}
      <main className="mt-2">
        {tab === 'quiz' && (
          <QuizPage profile={state.profile} onSave={(p) => patch({ profile: p })} />
        )}
        {tab === 'schedule' && (
          <ScheduleImportPage schedule={state.schedule} onSave={(s) => patch({ schedule: s })} />
        )}
        {tab === 'plan' && <PlanPage plan={null} />}
        {tab === 'exam' && (
          <div className="px-4 py-10 text-center text-[13.5px] text-ink-faint">
            TODO（人 B）：期末倒计时 T-21 / T-14 / T-7 / T-3 面板
          </div>
        )}
      </main>

      {/* 底部导航 */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[560px]
                      bg-paper-card/95 backdrop-blur border-t border-paper-line">
        <div className="flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={[
                'flex-1 py-2.5 flex flex-col items-center gap-0.5 transition-colors',
                tab === t.id ? 'text-brand' : 'text-ink-faint',
              ].join(' ')}
            >
              <span className="text-[17px] leading-none">{t.icon}</span>
              <span className="text-[11px] font-semibold">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* 开发用：重置（上线前移除或收进设置页） */}
      <div className="px-4 mt-6 text-center">
        <button
          onClick={reset}
          className="text-[11.5px] text-ink-faint/60 underline"
        >
          清空本地数据
        </button>
      </div>
    </div>
  );
}
