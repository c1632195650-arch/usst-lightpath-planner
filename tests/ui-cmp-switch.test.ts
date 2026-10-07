/**
 * UI v2 批次 C5 · 开关/复选/单选断言（§10.2.4：native + role=switch / accent-brand / 键盘可达）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { Switch, Checkbox, Radio } from '@/components/ui/Switch';

test('C5 Switch: role=switch + checked 可达 + 文案在左拨杆在右 + 禁用', () => {
  const on = renderToStaticMarkup(createElement(Switch, { label: '日程冲突提醒', checked: true, onChange: () => {} } as never));
  assert.match(on, /role="switch"/, '拨杆语义');
  assert.match(on, /checked/, '开启态对读屏与测试可见');
  assert.match(on, /日程冲突提醒/, '文案在左（不给是/否标签）');
  const off = renderToStaticMarkup(createElement(Switch, { label: 'x', checked: false, onChange: () => {} } as never));
  assert.doesNotMatch(off, / checked=/, '关闭态不误报');
  const dis = renderToStaticMarkup(createElement(Switch, { label: 'x', checked: false, disabled: true, onChange: () => {} } as never));
  assert.match(dis, /<input[^>]*disabled/);
});

test('C5 Checkbox/Radio: native input + accent-brand + 双环焦点 + min-h-11 命中', () => {
  const cb = renderToStaticMarkup(createElement(Checkbox, { label: '已完成项', checked: true, onChange: () => {} } as never));
  assert.match(cb, /type="checkbox"/);
  assert.match(cb, /accent-brand/);
  assert.match(cb, /focus-visible:shadow-\[0_0_0_2px_#fff,0_0_0_4px_#4A73D1\]/, '双环焦点');
  assert.match(cb, /min-h-11/, '命中区 ≥44px');
  const rd = renderToStaticMarkup(createElement(Radio, { label: '提前 10 分钟', name: 'remind', value: '10' } as never));
  assert.match(rd, /type="radio"/);
  assert.match(rd, /name="remind"/);
});
