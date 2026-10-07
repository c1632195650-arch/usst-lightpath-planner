#!/usr/bin/env node
/**
 * S 批 S3 · 规则层 harness（eval_plan_understand.py 的离线路径调用）
 * 三种模式：
 *   eval  <golden> <today>            旧离线对照（规则层直判，输出预测 JSON）
 *   rules <golden> <today>            生产忠实：每条的**规则层结果**（intent: action/intent/patch/missing；
 *                                     answer: contributed + 已填槽位的规则归一值）——生产路径
 *                                     规则先行，规则能接住的 LLM 根本不会被调
 *   canon <jsonFile> <today>          片段归一：{id:{slot:片段}} → {id:{slot:规则归一值}}
 *                                     （生产里 LLM 片段经 applyClarifyFragments/fillOneSlot 归一后落库，
 *                                      评测计分必须双侧同归一，否则「还没定→时间待定」互含不上）
 */
import { readFileSync } from 'node:fs';
import {
  looksLikeAction,
  parseIntentSlots,
  applyClarifyAnswers,
} from '@/features/libao/libaoIntent';

const argv = process.argv.slice(2);
const MODE = argv[0] ?? 'eval';
const GOLDEN = argv[1] ?? 'evals/golden/plan_understand.jsonl';
const TODAY = argv[2] ?? '2026-09-27';

/** 规则 patch（intent 项）：与端点 patch 字段一一同名，便于合并计分 */
function rulePatch(slots) {
  return {
    title: slots.title || undefined,
    when_text: slots.when?.text,
    weekday: slots.when?.weekday,
    weekNo: slots.when?.weekNo,
    relativeMonths: slots.when?.relativeMonths,
    targetHint: slots.targetHint,
    // 钟点起止（批次 1）+ 按时间定位（2026-10-07）—— 与端点 patch 同名，缺了新金标 EM 恒 miss
    ...(slots.clock?.startMin != null ? { startMin: slots.clock.startMin } : {}),
    ...(slots.clock?.endMin != null ? { endMin: slots.clock.endMin } : {}),
    ...(slots.targetDay != null ? { targetWeekday: slots.targetDay } : {}),
    ...(slots.targetClock?.startMin != null ? { targetStartMin: slots.targetClock.startMin } : {}),
    ...(slots.targetClock?.endMin != null ? { targetEndMin: slots.targetClock.endMin } : {}),
    perWeekCount: slots.perWeekCount,
    durationMin: slots.durationMin,
    totalHours: slots.totalHours,
    place: slots.place,
  };
}

/** 片段 → 规则归一值（生产 fillOneSlot 的落库口径） */
function canonSlot(slot, text, today) {
  const s = parseIntentSlots(text || '', today);
  if (slot === 'when') {
    if (!s.when) return { text: text || '' };
    return {
      text: s.when.text,
      ...(s.when.month != null ? { month: s.when.month } : {}),
      ...(s.when.day != null ? { day: s.when.day } : {}),
      ...(s.when.relativeDays != null ? { relativeDays: s.when.relativeDays } : {}),
      ...(s.when.relativeWeeks != null ? { relativeWeeks: s.when.relativeWeeks } : {}),
      ...(s.when.weekday != null ? { weekday: s.when.weekday } : {}),
      ...(s.when.unspecified ? { unspecified: true } : {}),
    };
  }
  if (slot === 'effort') {
    return {
      ...(s.perWeekCount != null ? { perWeekCount: s.perWeekCount } : {}),
      ...(s.durationMin != null ? { durationMin: s.durationMin } : {}),
      ...(s.totalHours != null ? { totalHours: s.totalHours } : {}),
    };
  }
  if (slot === 'title') return s.title || (text || '');
  if (slot === 'target') return s.targetHint || (text || '');
  return text || '';
}

const lines = readFileSync(GOLDEN, 'utf8').split('\n').filter((l) => l.trim());

if (MODE === 'canon') {
  // 输入：{id: {slot: 片段}} → 输出：{id: {slot: 归一值}}
  const input = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const out = {};
  for (const [id, slots] of Object.entries(input)) {
    out[id] = {};
    for (const [slot, frag] of Object.entries(slots)) {
      out[id][slot] = typeof frag === 'string' ? canonSlot(slot, frag, TODAY) : frag;
    }
  }
  console.log(JSON.stringify(out));
} else if (MODE === 'rules') {
  const out = [];
  for (const line of lines) {
    const item = JSON.parse(line);
    if (item.scene === 'intent') {
      const action = looksLikeAction(item.q);
      const slots = parseIntentSlots(item.q, TODAY);
      out.push({
        id: item.id,
        scene: 'intent',
        rule: {
          action,
          intent: action ? slots.intent : undefined,
          patch: rulePatch(slots),
          missing: slots.missing, // 生产口径：missing>0 才会调 LLM
        },
      });
    } else {
      // 生产口径：asked 的槽位在 prev 里必然为空（正是缺了才追问的）→ 空种子忠实
      const prev = parseIntentSlots('', TODAY);
      const asked = item.asked ?? [];
      const r = applyClarifyAnswers(item.q, prev, asked, TODAY);
      const slots = {};
      for (const k of asked) {
        if (k === 'when' && r.slots.when) slots.when = canonSlot('when', r.slots.when.text, TODAY);
        else if (k === 'effort' && (r.slots.perWeekCount != null || r.slots.durationMin != null || r.slots.totalHours != null)) {
          slots.effort = {
            ...(r.slots.perWeekCount != null ? { perWeekCount: r.slots.perWeekCount } : {}),
            ...(r.slots.durationMin != null ? { durationMin: r.slots.durationMin } : {}),
            ...(r.slots.totalHours != null ? { totalHours: r.slots.totalHours } : {}),
          };
        } else if (k === 'title' && r.slots.title) slots.title = r.slots.title;
        else if (k === 'target' && r.slots.targetHint) slots.target = r.slots.targetHint;
      }
      out.push({ id: item.id, scene: 'answer', rule: { contributed: r.contributed, slots } });
    }
  }
  console.log(JSON.stringify(out));
} else {
  // 旧 eval 模式：离线对照（规则层直判），保持原输出形状不动
  const out = [];
  for (const line of lines) {
    const item = JSON.parse(line);
    if (item.scene === 'intent') {
      const action = looksLikeAction(item.q);
      const slots = parseIntentSlots(item.q, TODAY);
      out.push({ id: item.id, scene: 'intent', action, intent: action ? slots.intent : undefined, patch: rulePatch(slots) });
    } else {
      const prev = parseIntentSlots('我要报名数学建模，帮我规划备赛', TODAY);
      const asked = item.asked ?? [];
      const r = applyClarifyAnswers(item.q, prev, asked, TODAY);
      const answers = {};
      for (const k of asked) {
        if (k === 'when' && r.slots.when) answers.when = r.slots.when.text;
        if (k === 'effort') {
          const bits = [];
          if (r.slots.perWeekCount != null) bits.push(`每周${r.slots.perWeekCount}次`);
          if (r.slots.durationMin != null) bits.push(`每次${r.slots.durationMin}分钟`);
          if (r.slots.totalHours != null) bits.push(`一共${r.slots.totalHours}小时`);
          if (bits.length) answers.effort = bits.join('、');
        }
        if (k === 'title' && r.slots.title) answers.title = r.slots.title;
        if (k === 'target' && r.slots.targetHint) answers.target = r.slots.targetHint;
      }
      out.push({ id: item.id, scene: 'answer', answers });
    }
  }
  console.log(JSON.stringify(out, null, 1));
}
