/**
 * E8 聊天跨会话恢复 · 合并逻辑测试（纯函数，不碰浏览器 API）
 * ============================================================
 * 守住三条：
 *  · 快照 + 历史合并去重：同文不重复出现（同文重复按条数抵消，不多删）；
 *  · 历史重建：role 收敛（assistant→lbao）、顺序保持升序、带后端 id；
 *  · 恢复开关与空历史：RESTORE_CHAT 关闭 / 历史为空 → 不恢复。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  historyToMsgs, mergeHistory, restoredMessages,
  type RestorableMsg,
} from '@/features/libao/chatRestore';
import type { ChatHistoryRow } from '@/lib/api';

function row(id: number, role: 'user' | 'assistant', content: string): ChatHistoryRow {
  return { id, role, content, created_at: `2026-09-21T10:00:0${id % 10}` };
}

function msg(role: 'user' | 'lbao', text: string): RestorableMsg {
  return { role, text };
}

test('historyToMsgs：assistant→lbao、升序保持、mid 带上、未知角色丢弃', () => {
  const out = historyToMsgs([
    row(1, 'user', '学校有没有麦当劳'),
    row(2, 'assistant', '有嗷宝子！'),
    row(3, 'system', '不应出现'),
  ]);
  assert.deepEqual(out, [
    { role: 'user', text: '学校有没有麦当劳', mid: 1 },
    { role: 'lbao', text: '有嗷宝子！', mid: 2 },
  ]);
});

test('mergeHistory：快照与历史重叠时不重复（后端历史全量 vs 本地尾部）', () => {
  const history = [
    row(1, 'user', '第一句'),
    row(2, 'lbao', '第一答'),
    row(3, 'user', '第二句'),
    row(4, 'lbao', '第二答'),
  ];
  const snapshot = [msg('user', '第二句'), msg('lbao', '第二答')];
  const merged = mergeHistory(snapshot, history);
  assert.deepEqual(merged.map((m) => m.text),
    ['第一句', '第一答', '第二句', '第二答'],
    '快照没覆盖的更早消息排前面，重叠的只留一份');
});

test('mergeHistory：同文消息发两次，按条数抵消，不多删不少加', () => {
  const history = [
    row(1, 'user', '在吗'),
    row(2, 'user', '在吗'),
    row(3, 'lbao', '在的'),
  ];
  const snapshot = [msg('user', '在吗'), msg('lbao', '在的')];
  const merged = mergeHistory(snapshot, history);
  assert.equal(merged.filter((m) => m.text === '在吗').length, 2, '两处各一条 = 共两条');
  assert.equal(merged.filter((m) => m.text === '在的').length, 1);
});

test('mergeHistory：文本含多余空白也判重（两边同源折叠）', () => {
  const history = [row(1, 'user', '帮 我 安排 这周')];
  const snapshot = [msg('user', '帮我 安排这周')];
  const merged = mergeHistory(snapshot, history);
  assert.equal(merged.length, 1, '折叠空白后同文 → 抵消');
});

test('mergeHistory：空历史原样返回；空快照等于全量重建', () => {
  const snapshot = [msg('user', '第二句')];
  assert.deepEqual(mergeHistory(snapshot, []), snapshot);
  const full = mergeHistory([], [row(1, 'user', '第一句')]);
  assert.equal(full.length, 1);
  assert.equal(full[0].mid, 1);
});

test('restoredMessages：无快照走重建；有快照走合并；空历史不恢复', () => {
  const history = [row(1, 'user', '第一句'), row(2, 'lbao', '第一答')];
  assert.deepEqual(restoredMessages(null, history), historyToMsgs(history));
  const snapshot = [msg('lbao', '第一答')];
  assert.equal(restoredMessages(snapshot, history)![0].text, '第一句');
  assert.equal(restoredMessages(snapshot, []), null, '空历史 → null（调用方维持现状）');
  assert.equal(restoredMessages(null, []), null);
});
