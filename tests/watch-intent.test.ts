/**
 * W11 · watch 意图（半代办「盯一件事」）验收（2026-10-25）
 * RV：摘 watch INTENT_PATTERN → 识别恰红；摘 watchProposal 门槛 → needDate 恰红；
 *     W11-⑤ 幂等反向：同卡重复「确认」不双记（title+date 去重兜底）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectIntent, watchProposal } from '@/features/libao/libaoIntent';
import { addUserDeadline, loadUserDeadlines } from '@/features/calendar/deadlineStore';

/** node --test 无 localStorage：deadlineStore 的 try/catch 容错会把读写静默吞掉，
 *  接缝测必须先装内存 stub，才能验证「确认 → 落库」真的发生了。 */
function installMemoryLocalStorage() {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  };
}
installMemoryLocalStorage();

test('W11-① watch 识别：盯/提醒我/别让我忘 三族全命中', () => {
  for (const q of [
    '帮我盯着光电杯', '六级报名提醒我一下', '别让我忘记交材料',
    '盯一下答辩时间', '帮我盯紧项目进度',
  ]) {
    assert.equal(detectIntent(q), 'watch', `应识别为 watch：${q}`);
  }
});

test('W11-② 顺序敏感：既有意图不被 watch 抢（cancel/改期优先）', () => {
  assert.equal(detectIntent('取消盯着我上次说的那件事'), 'cancel', '取消优先');
  assert.equal(detectIntent('把盯的那件事挪到周五'), 'reschedule', '改期优先');
  // 「要盯着六级报名」的「报名」不抢——add_deadline 在 watch 之前（顺序敏感）
  assert.equal(detectIntent('要盯着六级考试别错过报名'), 'watch', '纯盯事命中');
});

test('W11-③ watchProposal：有日期出卡片；缺日期 needDate（不许猜）', () => {
  const slots = {
    intent: 'watch' as const, title: '光电杯决赛', certainty: 'exact' as const,
    dateFrom: '2026-11-01', dateTo: '2026-11-01', missing: [], unclear: [], raw: '',
  };
  const p = watchProposal(slots);
  assert.ok(!('needDate' in p), '有日期应出提案');
  assert.equal(p.prepDays, 0, '盯事不产准备块');
  assert.match(p.message, /盯「光电杯决赛」/);
  assert.match(p.message, /重要日里可随时取消/, '可撤销口径在卡上（L3）');
  const noDate = watchProposal({ ...slots, dateFrom: undefined });
  assert.ok('needDate' in noDate, '缺日期 → 追问（不许猜）');
});

test('W11-④ 接缝契约：卡载荷 → addUserDeadline 落库（prepDays=0 不产准备块）', () => {
  const slots = {
    intent: 'watch' as const, title: '光电杯决赛', certainty: 'exact' as const,
    dateFrom: '2026-11-01', dateTo: '2026-11-01', missing: [], unclear: [], raw: '',
  };
  const prop = watchProposal(slots);
  assert.ok(!('needDate' in prop));
  // LbaoChat.confirmDeadline 的实际调用形状（title/date/prepDays → leadDays）
  const list = addUserDeadline({ title: prop.title, date: prop.date, leadDays: prop.prepDays });
  const saved = list.find((d) => d.title === '光电杯决赛' && d.date === '2026-11-01');
  assert.ok(saved, '确认后必须落库');
  assert.equal(saved.source, 'user');
  assert.equal(saved.leadDays, 0, '盯事 prepDays=0 → 不产准备块（只提醒）');
  assert.equal(loadUserDeadlines().some((d) => d.id === saved!.id), true, 'loadUserDeadlines 可读回');
});

test('W11-⑤ 幂等反向：同一张卡重复「确认」不双记（title+date 去重兜底）', () => {
  const payload = { title: '答辩材料终稿', date: '2026-11-20', leadDays: 0 };
  addUserDeadline(payload);
  const twice = addUserDeadline(payload);
  const hits = twice.filter((d) => d.title === payload.title && d.date === payload.date);
  assert.equal(hits.length, 1, 'title+date 去重：重复确认不产生第二条');
});
