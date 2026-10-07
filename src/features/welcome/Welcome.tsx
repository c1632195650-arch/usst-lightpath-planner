import type { ReactNode } from 'react';
import { LightpathMark } from '@/components/LightpathMark';
import { Icon } from '@/components/icons/Icon';

interface Props {
  onStart: () => void;
  onSkip: () => void;
  /** 欢迎页底部附加区（云账号卡片等，可选；不传完全不变） */
  footer?: ReactNode;
}

/** 同心刻度环（设计总成 §3.5 落地表原样照抄，纯装饰） */
function RingOrnament() {
  return (
    <svg
      className="hc-ring"
      width="368"
      height="368"
      viewBox="0 0 280 280"
      fill="none"
      stroke="#fff"
      aria-hidden="true"
    >
      <path d="M30.4 163.3A112 112 0 1 1 249.6 163.3" strokeOpacity=".09" />
      <path d="M69.6 155.0A72 72 0 1 1 210.4 155.0" strokeOpacity=".06" strokeDasharray="2.5 6" />
      <line x1="140.0" y1="56.0" x2="140.0" y2="47.0" strokeWidth="1.5" opacity="0.9" />
      <line x1="149.2" y1="52.5" x2="149.7" y2="47.5" strokeWidth="1.0" opacity="0.42" />
      <line x1="158.3" y1="53.9" x2="159.3" y2="49.0" strokeWidth="1.0" opacity="0.42" />
      <line x1="167.2" y1="56.3" x2="168.7" y2="51.6" strokeWidth="1.0" opacity="0.42" />
      <line x1="175.8" y1="59.6" x2="177.8" y2="55.0" strokeWidth="1.0" opacity="0.42" />
      <line x1="182.0" y1="67.3" x2="186.5" y2="59.5" strokeWidth="1.5" opacity="0.9" />
      <line x1="224.0" y1="140.0" x2="233.0" y2="140.0" strokeWidth="1.5" opacity="0.9" />
      <line x1="227.5" y1="149.2" x2="232.5" y2="149.7" strokeWidth="1.0" opacity="0.42" />
      <line x1="52.5" y1="149.2" x2="47.5" y2="149.7" strokeWidth="1.0" opacity="0.42" />
      <line x1="56.0" y1="140.0" x2="47.0" y2="140.0" strokeWidth="1.5" opacity="0.9" />
      <line x1="52.5" y1="130.8" x2="47.5" y2="130.3" strokeWidth="1.0" opacity="0.42" />
      <line x1="67.3" y1="98.0" x2="59.5" y2="93.5" strokeWidth="1.5" opacity="0.9" />
      <line x1="98.0" y1="67.3" x2="93.5" y2="59.5" strokeWidth="1.5" opacity="0.9" />
      <line x1="212.7" y1="98.0" x2="220.5" y2="93.5" strokeWidth="1.5" opacity="0.9" />
    </svg>
  );
}

export function Welcome({ onStart, onSkip, footer }: Props) {
  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-6 sm:px-6 sm:py-8">
      <div className="page-shell relative z-10 flex min-h-[calc(100vh-48px)] flex-col items-center justify-center gap-5">
        {/* 居中深色面：符号居中锚点，四层装饰（sym-beam ×2 / gridc / ring + glowc） */}
        <div className="hc w-full max-w-[860px]">
          <div className="sym-beam l" />
          <div className="sym-beam r" />
          <div className="gridc" />
          <RingOrnament />
          <div className="glowc" />

          <div className="hcin">
            <div className="mb-2 flex justify-center">
              <LightpathMark tone="on-dark" size={54} />
            </div>
            <p className="kicker">USST · LIGHTPATH</p>
            <h1>
              让校园生活，
              <em>有自己的节奏</em>
            </h1>
            <p className="sub">
              从课表、校园节点和你的习惯出发，梳理学习、休息与日常生活。计划不必填满，重要的是能被执行。
            </p>

            <div className="acts">
              <button onClick={onStart} className="button-on-dark">
                开始画像测评
              </button>
              <button
                onClick={onSkip}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/25 px-5 py-2 text-sm font-semibold text-white transition-colors duration-fast hover:bg-white/10"
              >
                先浏览应用
              </button>
            </div>

            <p className="mt-5 text-xs leading-5 text-white/45">
              画像可以随时重做；暂时跳过也不影响浏览校历与课表。
            </p>
          </div>

          <div className="spec-rule">
            <span className="sp" />
            <span className="tick" style={{ left: '24%' }} />
            <span className="tick" style={{ left: '38%' }} />
            <span className="tick" style={{ left: '62%' }} />
            <span className="tick" style={{ left: '76%' }} />
            <span className="sp r" />
          </div>

          {/* §9.6 I 组：页脚建筑剪影条 —— 密氏校门/湛恩图书馆/思晏堂/体育馆（指认层线描，
              低透明度装饰，呼应「1906–2026」；不可点、不可独立放大） */}
          <div className="relative z-[3] mt-1 flex items-end justify-center gap-8 text-white/50" aria-hidden="true">
            <Icon name="men" size="lg" />
            <Icon name="lib" size="lg" />
            <Icon name="yates" size="lg" />
            <Icon name="gym" size="lg" />
          </div>

          <div className="relative z-[3] flex items-center justify-between gap-3 px-8 pb-5 pt-3 text-[10px] font-medium tracking-[0.14em] text-white/40">
            <span>UNIVERSITY OF SHANGHAI FOR SCIENCE AND TECHNOLOGY</span>
            <span>1906–2026</span>
          </div>
        </div>

        {footer && <div className="w-full max-w-[860px]">{footer}</div>}
      </div>
    </div>
  );
}
