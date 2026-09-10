import { Logo120 } from '@/components/Logo120';

interface Props {
  onStart: () => void;
  onSkip: () => void;
}

export function Welcome({ onStart, onSkip }: Props) {
  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-6 sm:px-6 sm:py-8">
      {/* The quiet red field creates an institutional cue without competing with the welcome message. */}
      <div className="absolute inset-x-0 top-0 h-[42vh] bg-ink" />
      <div className="absolute left-[8%] top-[20vh] h-64 w-64 rounded-full bg-brand/30 blur-3xl" />

      <div className="page-shell relative z-10 flex min-h-[calc(100vh-48px)] items-center">
        <div className="grid w-full overflow-hidden rounded-2xl border border-white/15 bg-white shadow-2xl shadow-ink/10 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="flex min-h-[430px] flex-col justify-between bg-ink px-7 py-8 text-white sm:px-10 sm:py-12">
            <div className="flex items-center gap-3">
              <Logo120 size={42} />
              <div>
                <div className="text-sm font-semibold">上理生活助手</div>
                <div className="mt-1 text-[11px] font-medium tracking-[0.16em] text-white/50">USST · STUDENT LIFE</div>
              </div>
            </div>

            <div className="my-12 max-w-xl lg:my-20">
              <p className="text-[11px] font-semibold tracking-[0.2em] text-white/50">MAKE ROOM FOR LIFE</p>
              <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">让校园生活<br />有自己的节奏。</h1>
              <p className="mt-5 max-w-md text-sm leading-7 text-white/65">从课表、校园节点和你的习惯出发，梳理学习、休息与日常生活。计划不必填满，重要的是能被执行。</p>
            </div>

            <div className="flex items-center justify-between border-t border-white/10 pt-5 text-[11px] font-medium tracking-[0.1em] text-white/45">
              <span>UNIVERSITY OF SHANGHAI FOR SCIENCE AND TECHNOLOGY</span>
              <span>1906–2026</span>
            </div>
          </section>

          <section className="flex flex-col justify-center bg-paper px-7 py-10 sm:px-10 sm:py-12">
            <p className="section-label">START HERE</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink">先了解你的节奏</h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-ink-soft">用一组轻量问题建立你的学习与生活画像。之后，梨宝会把建议留在适合你的强度里。</p>

            <div className="mt-8 grid gap-3 border-y border-ink/10 py-6">
              <div className="flex items-start gap-3">
                <span className="mt-1 text-xs font-semibold text-brand">01</span>
                <div><div className="text-sm font-semibold text-ink">完成个人画像</div><p className="mt-1 text-xs leading-5 text-ink-faint">基于习惯而非标签，随时可以重测。</p></div>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-1 text-xs font-semibold text-brand">02</span>
                <div><div className="text-sm font-semibold text-ink">查看校历与课表</div><p className="mt-1 text-xs leading-5 text-ink-faint">重要节点、每周课程和可留出的空间一目了然。</p></div>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-1 text-xs font-semibold text-brand">03</span>
                <div><div className="text-sm font-semibold text-ink">向梨宝提问</div><p className="mt-1 text-xs leading-5 text-ink-faint">校园信息与生活安排，都有明确的下一步。</p></div>
              </div>
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button onClick={onStart} className="button-primary flex-1">开始画像测评</button>
              <button onClick={onSkip} className="button-secondary flex-1">先浏览应用</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
