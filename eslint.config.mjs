// ESLint 平面配置（2026-09-19）：可访问性静态闸（P1#11）
// 只对 src/**/*.tsx 开 jsx-a11y —— 运行时另有 @axe-core/playwright 双闸（P1#9，待接）。
// 基线棘轮：现有违规数记入 data/a11y_baseline.json，只拦「新增」——永远红的门禁等于没有门禁。
import jsxA11y from 'eslint-plugin-jsx-a11y';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.tsx'],
    ...jsxA11y.flatConfigs.recommended,
    languageOptions: { parser: tsParser },
  },
  {
    files: ['src/**/*.tsx'],
    rules: {
      // 项目现状（Tailwind 重交互组件）个别规则噪声大，先降级观察再收紧：
      'jsx-a11y/no-autofocus': 'warn',
    },
  },
];
