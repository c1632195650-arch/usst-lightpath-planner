#!/usr/bin/env node
/**
 * S 批 S3 · 规则兜底对照 harness（python eval_plan_understand.py 的 LLM_EVAL_OFFLINE=1 路径调用）
 * 读 evals/golden/plan_understand.jsonl，用前端同款规则层（libaoIntent.ts）离线判一遍：
 *   intent 条目 → looksLikeAction + parseIntentSlots
 *   answer 条目 → applyClarifyAnswers（asked 位置对应）
 * 输出 JSON 到 stdout，由 python 侧汇总进对照报告。
 */
import { readFileSync } from 'node:fs';
import {
  looksLikeAction,
  parseIntentSlots,
  applyClarifyAnswers,
} from '@/features/libao/libaoIntent';

const GOLDEN = process.argv[2] ?? 'evals/golden/plan_understand.jsonl';
const TODAY = process.argv[3] ?? '2026-09-27';

const lines = readFileSync(GOLDEN, 'utf8').split('\n').filter((l) => l.trim());
const out = [];

for (const line of lines) {
  const item = JSON.parse(line);
  if (item.scene === 'intent') {
    const exp = item.expect ?? {};
    const action = looksLikeAction(item.q);
    const slots = parseIntentSlots(item.q, TODAY);
    const patch = {
      title: slots.title || undefined,
      when_text: slots.when?.text,
      targetHint: slots.targetHint,
      perWeekCount: slots.perWeekCount,
      durationMin: slots.durationMin,
      totalHours: slots.totalHours,
      place: slots.place,
    };
    out.push({ id: item.id, scene: 'intent', action, intent: action ? slots.intent : undefined, patch });
  } else {
    const prev = parseIntentSlots('我要报名数学建模，帮我规划备赛', TODAY); // 缺 when+effort 的通用种子
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
