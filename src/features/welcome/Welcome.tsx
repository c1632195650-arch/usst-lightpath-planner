import { Logo120 } from '@/components/Logo120';

interface Props {
  onStart: () => void;
  onSkip: () => void;
}

export function Welcome({ onStart, onSkip }: Props) {
  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-6 sm:px-6 sm:py-8">
      {/* The campus-red field stays behind the entry surface so only the real entry panel feels elevated. */}
      <div className="absolute inset-x-0 top-0 h-[42vh] bg-ink" />
      <div className="absolute left-[8%] top-[20vh] h-64 w-64 rounded-full bg-brand/30 blur-3xl" />

      <div className="page-shell relative z-10 flex min-h-[calc(100vh-48px)] items-center">
        <div className="grid w-full overflow-hidden rounded-2xl border border-white/15 bg-white shadow-lg shadow-ink/10 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="flex min-h-[430px] flex-col justify-between bg-ink px-7 py-8 text-white sm:px-10 sm:py-12">
            <div className="flex items-center gap-3">
              <Logo120 size={42} />
              <div>
                <div className="text-sm font-semibold">上理生活助手</div>
                <div className="mt-1 text-[11px] font-medium tracking-[0.16em] text-white/50">USST · STUDENT LIFE</div>
              </div>
              </div>

            <div className="my-12 max-w-xl lg:my-20">
              <p className="text-xs font-semibold tracking-[0.2em] text-white/50">MAKE ROOM FOR LIFE</p>
              <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">让校园生活<br />有自己的节奏。</h1>
              <p className="mt-5 max-w-md text-sm leading-7 text-white/65">从课表、校园节点和你的习惯出发，梳理学习、休息与日常生活。计划不必填满，重要的是能被执行。</p>
            </div>

            <div className="flex items-center justify-between border-t border-white/10 pt-5 text-[11px] font-medium tracking-[0.1em] text-white/45">
              <span>UNIVERSITY OF SHANGHAI FOR SCIENCE AND TECHNOLOGY</span>
              <span>1906–2026</span>
            </div>
          </section>

          <section className="flex flex-col justify-center bg-paper px-7 py-10 sm:px-10 sm:py-12">
            <p className="section-label">FIRST SETUP</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink">先让安排认识你</h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-ink-soft">完成画像后，系统会把课表、校园节点和你的日常习惯放在同一个安排里。</p>

            <dl className="mt-8 divide-y divide-ink/10 border-y border-ink/10">
              <div className="flex items-baseline justify-between gap-4 py-4">
                <dt className="text-sm text-ink-soft">测评内容</dt>
                <dd className="text-sm font-semibold text-ink">35 个日常选择</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-4">
                <dt className="text-sm text-ink-soft">结果用途</dt>
                <dd className="text-sm font-semibold text-ink">用于调整建议强度</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-4">
                <dt className="text-sm text-ink-soft">数据位置</dt>
                <dd className="text-sm font-semibold text-ink">仅保存在此设备</dd>
              </div>
            </dl>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button onClick={onStart} className="button-primary flex-1">开始画像测评</button>
              <button onClick={onSkip} className="button-secondary flex-1">先浏览应用</button>
            </div>
            <p className="mt-4 text-xs leading-5 text-ink-faint">画像可以随时重做；暂时跳过也不影响浏览校历与课表。</p>
          </section>
        </div>
      </div>
    </div>
  );
}
