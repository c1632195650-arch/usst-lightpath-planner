/**
 * S 批 S2：排程会话状态机纯函数回归（`src/features/libao/schedSession.ts`）
 * ============================================================
 * 对应 CY 诉求：①追问中插话不再静默掉回文本回答（保留式追问）；
 * ③单独排程模式 —— collect 态消息不再逐句过 looksLikeAction 闸门。
 *
 * ⚠️ 反向验证（RV）锚点，删对应实现必红：
 *   · 删退出词表 / 放宽为子串匹配 → 退出组或误伤组红；
 *   · 删 nextMissStreak 的「算回应清零」分支 → 折返剧本红（一轮无关就作废）；
 *   · 删「无关 +1」→ 永不过期，作废剧本红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXIT_ACK,
  MISS_STREAK_LIMIT,
  isExitCommand,
  nextMissStreak,
  normalizeExitPhrase,
  shouldExpireSession,
} from '@/features/libao/schedSession';

test('S2 退出词：collect 态的显式退出说法要能命中', () => {
  const yes = [
    '退出排程', '退出', '取消排程',
    '不排了', '先不排', '不排', '别排了', '不安排了', '不弄了',
    '算了', '那算了', '算了算了', '就先这样',
    // 归一化：语气词 / 空白不挡路
    '不排了吧', '算了吧', '先不排吧', '退出排程 吧', '不排了啊',
  ];
  for (const q of yes) {
    assert.equal(isExitCommand(q), true, `「${q}」应判为退出`);
  }
});

test('S2 退出词：普通句子不许被误伤（这是收紧为整句相等的原因）', () => {
  const no = [
    '算了一下这周忙不忙',
    '帮我安排这周',
    '周五下午',
    '每天两小时',
    '我想算了这个月的生活费',
    '退出登录的入口在哪',
    '图书馆几点开门',
    '要不要报名四六级',
    '取消周四的复习', // 排程动作句，不是退出会话
  ];
  for (const q of no) {
    assert.equal(isExitCommand(q), false, `「${q}」被误判为退出`);
  }
});

test('S2 退出词：长句守卫 —— 含退出词的长句不算退出', () => {
  assert.ok('算了，帮我把数学建模备赛排进这周'.length > 8);
  assert.equal(isExitCommand('算了，帮我把数学建模备赛排进这周'), false);
});

test('S2 归一：去空白 + 去句尾语气词，但不吞正文', () => {
  assert.equal(normalizeExitPhrase('  不排了 吧 '), '不排了');
  assert.equal(normalizeExitPhrase('算了呀'), '算了');
  assert.equal(normalizeExitPhrase('不排了'), '不排了');
  assert.equal(normalizeExitPhrase(''), '');
});

test('S2 missStreak：算回应清零 / 无关累加（RV 锚点：删任一分支对应剧本红）', () => {
  assert.equal(nextMissStreak(0, true), 0, '算回应必须清零 —— 否则折返剧本一轮就废');
  assert.equal(nextMissStreak(1, true), 0);
  assert.equal(nextMissStreak(0, false), 1);
  assert.equal(nextMissStreak(1, false), 2);
});

test('S2 missStreak：上限为 2 —— 一轮无关只提醒，两轮才作废', () => {
  assert.equal(MISS_STREAK_LIMIT, 2, 'CY 诉求：追问中插话后想折返，一轮就丢太脆');
  assert.equal(shouldExpireSession(0), false);
  assert.equal(shouldExpireSession(1), false, '第 1 轮无关必须保留会话（折返诉求）');
  assert.equal(shouldExpireSession(2), true, '第 2 轮才作废，且作废前必须说明（不静默）');
});

test('S2 剧本：折返 —— 插一句无关 → 保留 → 回答仍被收进槽位', () => {
  // 对应 E2E 剧本「追问中插话折返不丢态」的纯逻辑骨架
  let streak = 0;
  streak = nextMissStreak(streak, false); // 「图书馆几点开门」—— 无关
  assert.equal(shouldExpireSession(streak), false, '插话一轮不许作废');
  streak = nextMissStreak(streak, true); // 「每周 3 次、每次 2 小时」—— 算回应
  assert.equal(streak, 0, '回应后计数清零，后续无关仍有一次折返机会');
});

test('S2 剧本：连续两轮无关才作废', () => {
  let streak = 0;
  streak = nextMissStreak(streak, false);
  assert.equal(shouldExpireSession(streak), false);
  streak = nextMissStreak(streak, false);
  assert.equal(shouldExpireSession(streak), true, '连续两轮无关 → 作废（作废前先说明）');
});

test('S2 退出回执话术存在且非空（UI 与按钮共用同一句，口径一致）', () => {
  assert.ok(EXIT_ACK.length > 0);
  assert.match(EXIT_ACK, /先不排|不排/);
});
