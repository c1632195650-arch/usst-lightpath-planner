/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /**
         * 光谱色板 —— 产品叫「光溯 / LightPath」，配色本身就是一条光谱：
         * 深靛（ink）承载大面积深色面，靛蓝（brand）负责操作与选中，
         * 琥珀（accent）作为光谱暖端只做点缀。
         *
         * 所有文字色对 paper 底的对比度均 ≥ 4.5:1（WCAG AA 小字标准），
         * 注释里的数值是实测值，改色前请重新核对。
         */
        ink: {
          DEFAULT: '#16233F', // 14.6:1 主文字，同时是深色面底色
          soft: '#414D68', //  7.9:1 正文次级
          faint: '#66708A', //  4.6:1 标签与说明（小字也达标）
        },
        paper: {
          DEFAULT: '#F6F7FA', // 页面底
          card: '#FFFFFF', // 卡片
          sunken: '#EDEFF5', // 进度槽、输入框底
        },
        brand: {
          DEFAULT: '#2B4C9B', // 主操作、选中态（承白字 8.1:1）
          dark: '#1F3A78', // hover
          light: '#E5EAF6', // 选中底
          bright: '#4A73D1', // 深色面上的强调
        },
        accent: {
          DEFAULT: '#D98324', // 琥珀，光谱暖端
          light: '#FBF0DF',
        },
        ok: { DEFAULT: '#1E7A4F', light: '#E6F2EC' },
        warn: { DEFAULT: '#B9762A', light: '#FBF1E3' },
        danger: { DEFAULT: '#C24B3A', light: '#FAEAE7' },

        /**
         * 数据色：按波长从短到长排列（紫→靛→青→绿→琥珀→珊瑚）。
         * 课表类别、校历事件、时间节点三处共用这一套，
         * 语义映射集中在 src/constants/chartColors.ts，不要再各处硬编码 hex。
         */
        chart: {
          violet: '#6B4BA3',
          indigo: '#2B4C9B',
          cyan: '#147A8B',
          green: '#1E7A4F',
          amber: '#B9762A',
          coral: '#C24B3A',
          slate: '#5A6377',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', 'sans-serif'],
        display: ['"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
      },
      borderRadius: { card: '16px' },
      /**
       * 扁平 2.0（Skin Spec v1，见 docs/ui-revamp-plan-flat2-bento.md §2.3）：
       * 阴影与颜色一样是一处可改的皮肤资产，禁止在组件里再写硬编码投影。
       */
      boxShadow: {
        /** 贴地轻影：层次主要靠 border 承担，阴影永远单层、透明度 ≤ 0.05。 */
        card: '0 1px 2px rgba(22,35,63,0.04), 0 4px 14px rgba(22,35,63,0.04)',
        /** 深色大卡的第二档（原值保留）。 */
        'card-dark': '0 18px 44px rgba(22,35,63,0.10)',
        /** 主按钮投影，从 0_6px_16px_.22 减淡。 */
        btn: '0 1px 3px rgba(43,76,155,0.18)',
      },
    },
  },
  plugins: [],
};
