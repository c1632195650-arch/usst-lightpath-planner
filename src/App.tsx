import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import QuizPage from '@/features/quiz/QuizPage';
import ScheduleImportPage from '@/features/schedule/ScheduleImportPage';
import PhasePage from '@/features/plan/PhasePage';
import PlanPage from '@/features/plan/PlanPage';
import ExamPage from '@/features/exam/ExamPage';

/**
 * 应用外壳 —— 演示版（Demo）
 *
 * 用「欢迎页 → 五步流程」的方式走查产品整体界面与操作流程。
 * 真实版会接 localStorage（useAppState）+ 底部 tab 导航；这里用 mock 数据 + 步骤导航。
 */

const STEPS = [
  { id: 'quiz', label: '画像', icon: '🎯' },
  { id: 'schedule', label: '课表', icon: '📅' },
  { id: 'phase', label: '阶段', icon: '🌱' },
  { id: 'week', label: '周计划', icon: '🌿' },
  { id: 'exam', label: '冲刺', icon: '⏳' },
] as const;

export default function App() {
  // 0 = 欢迎页，1..5 = 五步流程
  const [step, setStep] = useState(0);

  const goNext = () => setStep((s) => Math.min(s + 1, STEPS.length));
  const goPrev = () => setStep((s) => Math.max(s - 1, 1));
  const isLast = step === STEPS.length;

  return (
    <div className="page-shell">
      {/* 顶部品牌区 */}
      <header className="px-4 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <h1 className="text-[22px] font-extrabold tracking-tight">光溯</h1>
            <span className="text-[12.5px] text-ink-faint">上理生涯规划助手</span>
          </div>
          {step > 0 && (
            <button onClick={() => setStep(0)} className="text-[12px] text-ink-faint underline">
              回首页
            </button>
          )}
        </div>
        <p className="text-[12.5px] text-ink-faint mt-1">
          不是帮你学更多，是让你的计划真的被执行。
        </p>
      </header>

      {/* 步骤进度 */}
      {step > 0 && (
        <div className="px-4 mb-5">
          <div className="flex items-center gap-1.5">
            {STEPS.map((s, i) => (
              <div key={s.id} className="flex-1">
                <div
                  className={`h-1.5 rounded-full transition-colors ${
                    i < step ? 'bg-brand' : i === step - 1 ? 'bg-brand' : 'bg-paper-line'
                  }`}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1.5 text-[11px] text-ink-faint">
            <span>
              {step}/{STEPS.length} · {STEPS[step - 1].label}
            </span>
            <span>{STEPS[step - 1].icon}</span>
          </div>
        </div>
      )}

      {/* 内容区 */}
      <main className="mt-1">
        {step === 0 && (
          <Welcome onStart={() => setStep(1)} onSkip={() => setStep(4)} />
        )}
        {step === 1 && <QuizPage />}
        {step === 2 && <ScheduleImportPage />}
        {step === 3 && <PhasePage />}
        {step === 4 && <PlanPage />}
        {step === 5 && <ExamPage />}
      </main>

      {/* 底部导航 */}
      {step > 0 && (
        <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[560px] bg-paper-card/95 backdrop-blur border-t border-paper-line px-4 py-3">
          <div className="flex gap-3">
            {step > 1 && (
              <Button variant="secondary" onClick={goPrev} className="flex-1">
                上一步
              </Button>
            )}
            {!isLast ? (
              <Button onClick={goNext} full className="flex-[2]">
                下一步
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setStep(0)} full>
                重新体验
              </Button>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}

function Welcome({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  return (
    <div className="px-4 flex flex-col items-center text-center pt-8">
      <div className="w-16 h-16 rounded-2xl bg-brand-light flex items-center justify-center text-[32px] mb-4">
        🌅
      </div>
      <h2 className="text-[24px] font-extrabold tracking-tight text-ink leading-snug">
        把课表，变成一份<br />真的会执行的计划
      </h2>
      <p className="mt-3 text-[13.5px] text-ink-soft leading-relaxed max-w-[320px]">
        导入课表 → 测出学习画像 → 一学期切成五段 → 排出每周计划。
        和别的工具不同：我们帮你<b className="text-brand">理直气壮地休息</b>。
      </p>

      <div className="mt-8 w-full max-w-[320px] space-y-3">
        <Button full onClick={onStart}>开始体验</Button>
        <Button full variant="secondary" onClick={onSkip}>
          跳过，直接看排程结果
        </Button>
      </div>

      <div className="mt-10 grid grid-cols-3 gap-3 w-full max-w-[340px] text-center">
        {[
          ['🌿', '反内卷排程', '考试周留白反而更多'],
          ['🚌', '上理工原生', '五校区跨校区转场'],
          ['🔒', '数据不出设备', '课表与画像存本地'],
        ].map(([icon, title, sub]) => (
          <div key={title} className="rounded-xl bg-paper p-3">
            <div className="text-[20px]">{icon}</div>
            <div className="mt-1 text-[12px] font-semibold text-ink">{title}</div>
            <div className="text-[10.5px] text-ink-faint mt-0.5 leading-tight">{sub}</div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-[11px] text-ink-faint">
        演示版 · 数据均为模拟，无后端
      </p>
    </div>
  );
}
