/**
 * 光溯移动端 · 欢迎页（M-W1，2026-10-07）
 * ============================================================
 * 定位（docs/移动端定位重定义）：「规划在网页端，执行在手机端」——
 * 欢迎页把这个分工在第一次打开时讲清楚，顺便给品牌第一印象。
 *
 * 显示条件（MobileApp 接线）：**首次打开且未登录**；点「开始使用」后记住
 * （localStorage `usst.mobile.welcomed`），已登录老用户打开直接进今日页，不叨扰。
 * 不承载任何账号/画像逻辑 —— 画像与课表在网页端完成，这里只负责分工说明。
 */
import { LightpathMark } from '@/components/LightpathMark';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';

// 图标统一走本仓图鉴（2026-10-08 CY：图标再优化）——不再用 emoji
const POINTS: Array<{ icon: IconName; title: string; desc: string }> = [
  { icon: 'dashboard', title: '规划在网页端', desc: '画像、课表导入、周计划调整，都在电脑上完成' },
  { icon: 'bell', title: '执行在手机端', desc: '到点前 10 分钟提醒，一键顺延 15 分钟，完成即打卡' },
  { icon: 'sparkle', title: '它记得你', desc: '说过的偏好会被记住 —— 但每一条都由你确认才生效' },
];

export default function MobileWelcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-paper">
      {/* 品牌头部：与登录页同一块 hero（光谱冷端短条），保持两端一致 */}
      <header className="hero-surface-flat flex flex-col items-center gap-3 px-6 pb-12 pt-[calc(4rem+env(safe-area-inset-top))] text-white">
        <LightpathMark tone="plate" size={52} />
        <div className="text-center">
          <h1 className="font-display text-3xl font-semibold tracking-[0.01em]">光溯</h1>
          <p className="mt-1 text-[11px] font-medium tracking-[0.28em] text-white/55">USST · LIGHTPATH</p>
        </div>
        <p className="mt-2 max-w-64 text-center text-[13px] leading-6 text-white/80">
          懂上理、懂你、懂分寸的校园智能伙伴 —— 把你的生活算明白给你看。
        </p>
      </header>

      <main className="flex flex-1 flex-col gap-3 px-6 pt-6">
        {POINTS.map((p) => (
          <div key={p.title} className="flex items-start gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-3.5">
            <Icon name={p.icon} size="lg" className="text-brand" />
            <div>
              <p className="text-[14px] font-semibold text-ink">{p.title}</p>
              <p className="mt-0.5 text-[12px] leading-5 text-ink-soft">{p.desc}</p>
            </div>
          </div>
        ))}
        <p className="mt-1 text-center text-[11px] leading-5 text-ink-faint">
          先在网页端完成画像与课表，手机端用同一个账号连接即可同步
        </p>
      </main>

      <footer className="px-6 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-4">
        <Button
          type="button"
          variant="primary"
          full
          testId="m-welcome-start"
          onClick={onStart}
        >
          开始使用
        </Button>
      </footer>
    </div>
  );
}
