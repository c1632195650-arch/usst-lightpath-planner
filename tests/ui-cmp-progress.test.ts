/**
 * UI v2 批次 C7 · Progress 断言（§10.3.1 / §10.5 矩阵：默认/禁用/加载/错误必验；环形数字在中心）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { ProgressBar, ProgressRing } from '@/components/ui/Progress';

test('C7 线性: role=progressbar + aria-valuenow + label/valueText + 数值 tabular', () => {
  const html = renderToStaticMarkup(
    createElement(ProgressBar, { value: 62, label: '学分进度', valueText: '62 / 100' } as never),
  );
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="62"/);
  assert.match(html, /aria-valuemin="0"/);
  assert.match(html, /aria-valuemax="100"/);
  assert.match(html, /62 \/ 100/);
  assert.match(html, /tabular-nums/);
});

test('C7 线性: 进行中斜纹类在位且 valuenow 置空（不确定态不报假值）；禁用/错误/加载三态', () => {
  const ind = renderToStaticMarkup(createElement(ProgressBar, { value: 40, indeterminate: true } as never));
  assert.match(ind, /progress-stripes/, '斜纹=仍在推进');
  assert.doesNotMatch(ind, /aria-valuenow="\d/, '不确定态不报假值');
  const dis = renderToStaticMarkup(createElement(ProgressBar, { value: 40, disabled: true } as never));
  assert.match(dis, /aria-disabled="true"/);
  const err = renderToStaticMarkup(createElement(ProgressBar, { value: 40, error: true } as never));
  assert.match(err, /bg-danger/, '错误轨道转 danger');
  const load = renderToStaticMarkup(createElement(ProgressBar, { value: 40, loading: true } as never));
  assert.match(load, /bg-ink\/15/, '加载态整条骨架灰');
});

test('C7 环形: 数字写在中心（不让人目测弧长）+ valuenow 同步', () => {
  const html = renderToStaticMarkup(createElement(ProgressRing, { value: 68, label: '当日完成度' } as never));
  assert.match(html, /aria-valuenow="68"/);
  assert.match(html, /aria-label="当日完成度"/);
  assert.match(html, /<span[^>]*tabular-nums[^>]*>68%<\/span>/, '68% 在中心');
  assert.match(html, /stroke-dasharray/, '环背景在位');
});
