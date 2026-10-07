/**
 * UI v2 批次 C4 · 表单三件套断言（§10.2.3：外置 label / 占位符 #6E7688 / 错误说怎么改 / 禁用）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { Input, Select, Textarea, FieldShell } from '@/components/ui/FormControls';

test('C4 Input: 外置 label 在上方（label for + input id 配对）+ 必填 * ', () => {
  const html = renderToStaticMarkup(createElement(Input, { label: '课程名', name: 'course', required: true } as never));
  assert.match(html, /<label[^>]*for="course"/, '外置 label（不用占位符代替标签）');
  assert.match(html, /<input[^>]*id="course"/, 'id 配对');
  assert.match(html, /<label[^>]*>课程名<span[^>]*>\*<\/span>/, '必填 * 标出');
});

test('C4 Input: 占位符 #6E7688 + 聚焦双环+光晕 + 错误态边框转 danger + role=alert', () => {
  const idle = renderToStaticMarkup(createElement(Input, { label: '课程名', name: 'c', placeholder: '如 应用光学' } as never));
  assert.match(idle, /placeholder:text-\[#6E7688\]/, '占位符 4.56:1');
  assert.match(idle, /focus:shadow-\[0_0_0_2px_#fff,0_0_0_4px_#4A73D1/, '聚焦 2px 外环+光晕');
  const bad = renderToStaticMarkup(
    createElement(Input, { label: '课程名', name: 'c', error: true, hint: '结束时间早于开始时间，请调整时间顺序' } as never),
  );
  assert.match(bad, /border-\[#B0402F\]/, '错误边框');
  assert.match(bad, /aria-invalid="true"/);
  assert.match(bad, /role="alert"/, '错误提示对读屏可达');
  assert.match(bad, /请调整时间顺序/, '错误文案说清怎么改（不是「输入有误」）');
});

test('C4 Input: disabled 禁用态（背景转 paper + 光标 not-allowed）', () => {
  const html = renderToStaticMarkup(createElement(Input, { label: '课程名', name: 'c', disabled: true } as never));
  assert.match(html, /<input[^>]*disabled/);
  assert.match(html, /disabled:bg-paper/);
  assert.match(html, /disabled:cursor-not-allowed/);
});

test('C4 Select / Textarea: 同壳同规则；Textarea 两行高内部滚动', () => {
  const sel = renderToStaticMarkup(
    createElement(Select, { label: '校区', name: 'campus', error: true } as never, createElement('option', null, '军工路本部')),
  );
  assert.match(sel, /<select[^>]*id="campus"/);
  assert.match(sel, /aria-invalid="true"/);
  const ta = renderToStaticMarkup(createElement(Textarea, { label: '备注', name: 'note' } as never));
  assert.match(ta, /<textarea[^>]*id="note"/);
  assert.match(ta, /min-h-\[4\.2rem\]/, '两行可见高度');
  assert.match(ta, /overflow-y-auto/, '超出内部滚动');
});
