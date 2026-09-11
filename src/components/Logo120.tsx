/**
 * 120 周年校庆标识（致敬版）
 * 圆形徽章 + 中性石板灰渐变 + "USST" 与 "120" 组合 + 1906–2026
 * 注意：这是对官方标识精神的致敬与简化，非官方原件。
 *
 * 用石板灰而不是品牌靛蓝：徽章同时出现在浅色页头和深色首屏上，
 * 需要一个在两种底色上都有足够对比的中间调；靛蓝在深靛面上会糊掉。
 */
export function Logo120({ size = 120, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      className={className}
      role="img"
      aria-label="上海理工大学建校 120 周年"
    >
      <defs>
        <linearGradient id="usst120g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3C4353" />
          <stop offset="0.5" stopColor="#5A6377" />
          <stop offset="1" stopColor="#727B8E" />
        </linearGradient>
        <linearGradient id="usst120ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#C3C9D6" stopOpacity="0.45" />
        </linearGradient>
      </defs>

      {/* 外环 */}
      <circle cx="100" cy="100" r="96" fill="url(#usst120g)" />
      <circle cx="100" cy="100" r="88" fill="none" stroke="url(#usst120ring)" strokeWidth="2" />
      <circle cx="100" cy="100" r="82" fill="none" stroke="#ffffff" strokeOpacity="0.18" strokeWidth="1" />

      {/* 顶部弧线文字 */}
      <path
        id="usst120arc"
        d="M 40 100 A 60 60 0 0 1 160 100"
        fill="none"
      />
      <text fontSize="11" letterSpacing="3" fill="#ffffff" fillOpacity="0.85" fontFamily="inherit">
        <textPath href="#usst120arc" startOffset="50%" textAnchor="middle">
          UNIVERSITY OF SHANGHAI FOR SCIENCE AND TECHNOLOGY
        </textPath>
      </text>

      {/* USST */}
      <text x="100" y="86" textAnchor="middle" fontSize="26" fontWeight="800" letterSpacing="4" fill="#ffffff" fontFamily="inherit">
        USST
      </text>

      {/* 120 */}
      <text x="100" y="148" textAnchor="middle" fontSize="64" fontWeight="900" fill="#ffffff" fontFamily="inherit" style={{ letterSpacing: '-2px' }}>
        120
      </text>

      {/* 底部年份 */}
      <text x="100" y="170" textAnchor="middle" fontSize="11" letterSpacing="2" fill="#ffffff" fillOpacity="0.9" fontFamily="inherit">
        1906 · 2026
      </text>
    </svg>
  );
}
