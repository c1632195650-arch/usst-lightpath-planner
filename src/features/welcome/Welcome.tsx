import { Logo120 } from '@/components/Logo120';

interface Props {
  onStart: () => void;
  onSkip: () => void;
}

/** 站点名：Ugh-Study-Saps-Time，首字母 U-S-S-T 拼出 USST */
function SiteName() {
  const words = [
    { lead: 'U', rest: 'gh' },
    { lead: 'S', rest: 'tudy' },
    { lead: 'S', rest: 'aps' },
    { lead: 'T', rest: 'ime' },
  ];
  return (
    <h1 className="text-[32px] sm:text-[42px] leading-tight text-ink font-black tracking-tight">
      {words.map((w, i) => (
        <span key={i} className="whitespace-nowrap">
          {i > 0 && <span className="text-ink/20">-</span>}
          <span className="text-brand">{w.lead}</span>
          <span>{w.rest}</span>
        </span>
      ))}
    </h1>
  );
}

export function Welcome({ onStart, onSkip }: Props) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 relative overflow-hidden">
      {/* 背景飘浮贴纸 */}
      <span className="absolute top-14 left-7 text-3xl animate-float-y select-none">⭐</span>
      <span className="absolute top-24 right-9 text-2xl animate-wiggle select-none">☁️</span>
      <span className="absolute top-40 left-16 text-xl animate-bounce-soft select-none">📚</span>
      <span className="absolute bottom-40 right-12 text-2xl animate-float-y select-none" style={{ animationDelay: '.6s' }}>🍜</span>
      <span className="absolute bottom-24 left-10 text-xl animate-wiggle select-none" style={{ animationDelay: '.3s' }}>✨</span>
      <span className="absolute top-1/2 right-5 text-lg animate-twinkle select-none">💤</span>
      {/* 角落几何贴纸 */}
      <div className="absolute top-8 left-1/2 -translate-x-1/2 w-28 h-6 rounded-full bg-brand/10 rotate-[-6deg]" />
      <div className="absolute bottom-10 right-10 w-16 h-16 rounded-2xl border-2 border-brand/15 rotate-12" />

      <div className="welcome-in relative z-10 flex flex-col items-center text-center max-w-xl">
        {/* 梨宝吉祥物 + 对话气泡 */}
        <div className="relative mb-2">
          <div className="text-[104px] leading-none animate-float-y select-none drop-shadow-sm">🍐</div>
          <div className="absolute -right-10 top-2 bg-white rounded-2xl rounded-bl-none border-2 border-ink/10 shadow-sticker px-3 py-1.5 text-[13px] font-bold text-ink whitespace-nowrap">
            嗨！我是梨宝 👋
          </div>
          <div className="absolute -left-6 -bottom-2 text-[22px] animate-bounce-soft select-none">🥄</div>
        </div>

        <p className="text-brand text-[12px] font-bold tracking-[0.3em] uppercase mb-3">上理生活助手</p>
        <p className="text-ink-faint text-[15px] tracking-[0.5em] font-medium mb-2">WELCOME</p>
        <SiteName />

        <p className="mt-5 text-ink-soft text-[15px] leading-relaxed">
          认识你，才能把<strong className="text-ink">学习 · 吃饭 · 娱乐 · 作息</strong>
          <br className="hidden sm:block" />都安排得明明白白，还带点小幽默
        </p>

        {/* 120 周年小徽章 + 校训 */}
        <div className="mt-6 flex items-center gap-3">
          <Logo120 size={46} className="animate-float-y" />
          <div className="text-left leading-tight">
            <div className="text-[12px] font-bold text-ink">信义勤爱 · 思学志远</div>
            <div className="text-[10.5px] text-ink-faint">1906 – 2026 · 建校 120 周年</div>
          </div>
        </div>

        <div className="mt-9 flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          <button
            onClick={onStart}
            className="w-full sm:w-auto px-10 py-3.5 rounded-full bg-brand text-white font-bold text-[15px] shadow-sticker-brand hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none transition-all"
          >
            开始我的上理画像 →
          </button>
          <button
            onClick={onSkip}
            className="w-full sm:w-auto px-6 py-3.5 rounded-full bg-white text-ink-soft border-2 border-ink/10 shadow-sticker text-[14px] font-medium hover:-translate-y-0.5 transition-all"
          >
            先逛逛，跳过测评
          </button>
        </div>

        <p className="mt-6 text-[11px] text-ink-faint">demo · 风格定调版，正式功能迭代中</p>
      </div>
    </div>
  );
}
