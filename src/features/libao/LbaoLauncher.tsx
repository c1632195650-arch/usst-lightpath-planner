/**
 * 梨宝常驻呼出 launcher（UI v2 批次 D6，设计稿 §11 /libao 常驻态）
 * ============================================================
 * 任意主 Tab 右下角悬浮呼出 → 切到梨宝 Tab（现有 Tab 即全屏态，
 * 复用 mode-sched/mode-chat 既有结构，不新建对话壳）。
 * ≤32px 头像位按批次 B 约定用内联 SVG（梨宝品牌渐变）；命中区 ≥44px（WCAG 2.5.8）。
 */
interface Props {
  onClick: () => void;
}

export function LbaoLauncher({ onClick }: Props) {
  return (
    <button
      type="button"
      data-testid="libao-launcher"
      onClick={onClick}
      aria-label="呼出梨宝"
      title="呼出梨宝"
      className={[
        'libao-gradient fixed bottom-5 right-5 z-40 grid h-14 w-14 place-items-center rounded-full',
        'shadow-[0_10px_28px_rgba(22,35,63,0.24)] ring-1 ring-ink/10',
        'transition-transform duration-fast ease-out hover:scale-[1.04] active:scale-[.985]',
        'focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_#fff,0_0_0_4px_#4A73D1]',
      ].join(' ')}
    >
      <span className="grid h-7 w-7 place-items-center rounded-full bg-white/85 text-[13px] font-bold text-ink" aria-hidden="true">
        梨
      </span>
    </button>
  );
}
