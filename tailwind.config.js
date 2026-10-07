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
        /**
         * @deprecated UI v2 批次 A（2026-10-07）：accent 退役中，值已临时指向 gold 主色
         * #E8B44E（旧琥珀 #D98324 不再使用）。仍在用 accent-* 的 9 个文件由该映射零改动换色，
         * 批次 E 逐文件替换为 gold-* 后删除本键。新代码一律用 gold。
         */
        accent: {
          DEFAULT: '#E8B44E',
          light: '#FBF0DF',
        },
        /**
         * UI v2 金色板（设计总成 v2 §7）：光谱暖端的新主色。
         * DEFAULT 承操作点缀，light 承浅底，deep 承小字文字色。
         */
        gold: {
          DEFAULT: '#E8B44E',
          light: '#F2C879',
          deep: '#C08A45',
        },
        ok: { DEFAULT: '#1E7A4F', light: '#E6F2EC' },
        /**
         * 语义色必须成对（设计总成 §7.3）：`.DEFAULT` 只做图形与底色，
         * `.light` 是做底的那层，`.text` 才是**浅底/白底上承载文字**的那档。
         * 与 index.css 的 --warn-text / --danger-text 同一份值，改一处必须同步另一处。
         *   warn.text   #965C18 → 白底 5.47:1 / warn-light 上 4.89:1（AA）
         *   danger.text #B0402F → 白底 5.80:1 / danger-light 上 4.97:1（AA）
         * 直接用 DEFAULT 当小字文字色是不达标的（warn 3.69:1 / danger 在浅红底 4.12:1）。
         */
        warn: { DEFAULT: '#B9762A', light: '#FBF1E3', text: '#965C18' },
        danger: { DEFAULT: '#C24B3A', light: '#FAEAE7', text: '#B0402F' },

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
          /**
           * 青·深 / 青·浅（设计总成 §7.6「自定义」类的文字与块底，#147A8B 作小字
           * 只有 4.36:1 不够 AA，深一档才达标）。不进 SPECTRUM —— 那是「按波长排列」
           * 的 7 色契约，这两档是同一色的明度变体，只服务块内文字与底色。
           */
          'cyan-deep': '#0D5560',
          'cyan-soft': '#E7F3F5',
        },

        /**
         * 上理校色（B2 彩蛋批新增，不进 chart.* 数据色组 ——
         * SPECTRUM ↔ chart.* 的同步契约不受影响）。
         * 只允许小面积装饰：圆点、描边、≤0.15 透明度光晕、11px 小字，
         * 不与 brand 靛蓝大面积相邻（见 docs/ui-revamp-plan-flat2-bento.md B2 边界规则）。
         */
        school: {
          /** 上理红·参考值。白底 7.9:1 / paper 底 7.4:1，作小字也达标（WCAG AA）。
           *  待与官方 VI 手册《标准色与辅助色（正式版）》（xb.usst.edu.cn 可下载）核对后微调。 */
          red: '#9E1B32',
          /** 校红浅底：对 school.red 文字 6.9:1，对 ink 文字 13.7:1。 */
          light: '#FBEDEE',
        },
      },
      fontFamily: {
        /**
         * UI v2（批次 A）：正文西文前置 Inter；硬性版权要求——全栈禁止 Microsoft YaHei。
         * 中文回退 PingFang SC（macOS/iOS）→ HarmonyOS Sans SC / Source Han Sans SC → 系统。
         */
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'PingFang SC', 'HarmonyOS Sans SC', 'Source Han Sans SC', 'system-ui', 'sans-serif'],
        /** 标题层：霞鹜文楷 Screen（本地分片，见 index.css 顶部 @import）。 */
        display: ['"LXGW WenKai Screen"', '"PingFang SC"', 'HarmonyOS Sans SC', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      /**
       * 动效令牌四档（UI v2 §05：instant 反馈 / fast 微移 / base 面板 / slow 场景）。
       * 组件动画一律引用这四档，不再手写时长。
       */
      transitionDuration: {
        instant: '90ms',
        fast: '140ms',
        base: '220ms',
        slow: '360ms',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(.16,.84,.44,1)',
        in: 'cubic-bezier(.55,0,1,.45)',
        standard: 'cubic-bezier(.4,0,.2,1)',
        spring: 'cubic-bezier(.34,1.56,.64,1)',
      },
      /** 容器三档（UI v2 §10）：narrow 表单/详情，default 常规页，wide 数据密集页。 */
      maxWidth: {
        narrow: '720px',
        default: '1200px',
        wide: '1440px',
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
