# -*- coding: utf-8 -*-
"""
S 批 S3 · /api/plan/understand 金标评测
==========================================
金标：evals/golden/plan_understand.jsonl（60 条 = 30 intent + 20 answer + 10 boundary）。
⚠️ 金标由 zcode 起草（2026-09-27），**CY 复核后才算定稿** —— 复核意见直接改 jsonl。

用法：
  在线（需后端在跑，如 PORT=8001 的 dev 后端）：
    python scripts/eval_plan_understand.py http://127.0.0.1:8001
  离线对照（LLM_EVAL_OFFLINE=1，只测规则兜底，用前端同款规则层）：
    LLM_EVAL_OFFLINE=1 python scripts/eval_plan_understand.py

口径：
  · action 二分：P / R / F1 + 混淆矩阵（FP/FN 逐条列 id）
  · 槽位 EM：intent 条目按 expect.slots 逐槽比对（字符串归一后互含即算命中——
    when_text/标题允许片段级出入；数值必须相等）；answer 条目按 asked 槽位
    比对片段归一互含。EM = 全部槽位命中的条目占比。
报告落 docs/eval-libao-understand-2026-09-27.md（追加，不覆盖）。
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GOLDEN = os.path.join(ROOT, "evals", "golden", "plan_understand.jsonl")
REPORT = os.path.join(ROOT, "docs", "eval-libao-understand-2026-09-27.md")

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def norm(s):
    if s is None:
        return ""
    return re.sub(r"\s+", "", str(s))


def frag_hit(pred, want):
    """片段级命中：归一后互相包含（LLM 被要求照抄原话，边界应一致；互含是容差）。"""
    p, w = norm(pred), norm(want)
    return bool(p) and bool(w) and (p in w or w in p)


def num_eq(pred, want):
    try:
        return pred is not None and abs(float(pred) - float(want)) < 1e-6
    except (TypeError, ValueError):
        return False


def slot_score(pred_slots, want_slots):
    """逐槽比对 → (命中槽数, 期望槽数)"""
    if not want_slots:
        return 0, 0
    hit = 0
    for k, wv in want_slots.items():
        pv = pred_slots.get(k)
        if isinstance(wv, (int, float)):
            if num_eq(pv, wv):
                hit += 1
        elif frag_hit(pv, wv):
            hit += 1
    return hit, len(want_slots)


def load_golden():
    items = []
    with open(GOLDEN, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                items.append(json.loads(line))
    return items


def eval_live(base):
    items = load_golden()
    results = []
    for it in items:
        body = {"scene": it["scene"], "q": it["q"], "today": "2026-09-27"}
        if it["scene"] == "answer":
            body["asked"] = [f"{k}: {k}" for k in it.get("asked", [])]
        req = urllib.request.Request(
            f"{base.rstrip('/')}/api/plan/understand",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                res = json.loads(r.read().decode("utf-8"))
        except Exception as e:
            res = {"ok": False, "reason": f"{type(e).__name__}: {e}"}
        res["_ms"] = int((time.time() - t0) * 1000)
        results.append({"item": it, "res": res})
        flag = "✓" if res.get("ok") else "✗"
        print(f"  {flag} {it['id']} ({res.get('_ms', -1)}ms)")
    return results


def eval_offline():
    items = load_golden()
    r = subprocess.run(
        ["node", "--import", "./scripts/register-alias.mjs",
         "scripts/eval_understand_offline.mjs", GOLDEN, "2026-09-27"],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", shell=(os.name == "nt"),
    )
    if r.returncode != 0:
        print("[offline] node 失败：", (r.stderr or "")[-400:])
        sys.exit(1)
    preds = {p["id"]: p for p in json.loads(r.stdout)}
    return [{"item": it, "res": preds.get(it["id"], {})} for it in items]


def score(results, source):
    tp = fp = fn = tn = 0
    fp_ids, fn_ids = [], []
    slot_hit = slot_total = 0
    slot_ok_items = slot_items = 0
    answer_items = 0
    answer_slot_hit = answer_slot_total = 0

    for r in results:
        it, res = r["item"], r["res"]
        exp = it.get("expect", {})
        if it["scene"] == "intent":
            want_action = bool(exp.get("action"))
            got_action = bool(res.get("action")) if res.get("ok") else bool(res.get("action"))
            if want_action and got_action:
                tp += 1
            elif want_action and not got_action:
                fn += 1
                fn_ids.append(it["id"])
            elif not want_action and got_action:
                fp += 1
                fp_ids.append(it["id"])
            else:
                tn += 1
            want_slots = exp.get("slots") or {}
            if want_slots:
                patch = res.get("patch") or {}
                pred = dict(patch)
                if isinstance(patch.get("when_text"), str) or "when_text" in want_slots:
                    pred.setdefault("when_text", (res.get("patch") or {}).get("when_text"))
                h, t = slot_score(pred, want_slots)
                slot_hit += h
                slot_total += t
                slot_items += 1
                if h == t:
                    slot_ok_items += 1
        else:
            answer_items += 1
            want = exp.get("answers") or {}
            got = res.get("answers") or {}
            asked = it.get("asked", [])
            for k in asked:
                answer_slot_total += 1
                if k in want and frag_hit(got.get(k), want[k]):
                    answer_slot_hit += 1

    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    em_slots = slot_hit / slot_total if slot_total else 0.0
    em_items = slot_ok_items / slot_items if slot_items else 0.0
    ans_acc = answer_slot_hit / answer_slot_total if answer_slot_total else 0.0
    return {
        "source": source, "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": round(prec, 3), "recall": round(rec, 3), "f1": round(f1, 3),
        "fp_ids": fp_ids, "fn_ids": fn_ids,
        "slot_em": round(em_slots, 3), "slot_em_items": round(em_items, 3),
        "answer_slot_acc": round(ans_acc, 3),
        "answer_slot_hit": answer_slot_hit, "answer_slot_total": answer_slot_total,
    }


def main():
    offline = os.environ.get("LLM_EVAL_OFFLINE", "") == "1"
    lines = ["", "## 评测运行 · " + time.strftime("%Y-%m-%d %H:%M"), ""]

    if offline:
        print("[offline] 规则兜底对照（不调 LLM）")
        results = eval_offline()
        s = score(results, "offline-rules")
        lines += [
            "### 离线对照（规则层，无 LLM）",
            f"- action P/R/F1 = {s['precision']} / {s['recall']} / {s['f1']}"
            f"（TP {s['tp']} · FP {s['fp']} · FN {s['fn']} · TN {s['tn']}）",
            f"- FP: {s['fp_ids']}｜FN: {s['fn_ids']}",
            f"- intent 槽位 EM = {s['slot_em']}（逐槽）/ {s['slot_em_items']}（逐条）",
            f"- answer 槽位命中率 = {s['answer_slot_acc']}（{s['answer_slot_hit']}/{s['answer_slot_total']}）",
        ]
    else:
        base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8001"
        print(f"[live] {base}/api/plan/understand")
        results = eval_live(base)
        s = score(results, "live-llm")
        n_ok = sum(1 for r in results if r["res"].get("ok"))
        lines += [
            "### 在线（LLM understand）",
            f"- 端点 ok 率：{n_ok}/{len(results)}",
            f"- action P/R/F1 = {s['precision']} / {s['recall']} / {s['f1']}"
            f"（TP {s['tp']} · FP {s['fp']} · FN {s['fn']} · TN {s['tn']}）",
            f"- FP: {s['fp_ids']}｜FN: {s['fn_ids']}",
            f"- intent 槽位 EM = {s['slot_em']}（逐槽）/ {s['slot_em_items']}（逐条）",
            f"- answer 槽位命中率 = {s['answer_slot_acc']}（{s['answer_slot_hit']}/{s['answer_slot_total']}）",
        ]
        gates_ok = s["f1"] >= 0.95 and s["slot_em"] >= 0.90
        lines.append(f"- 门槛（action F1≥0.95 且 槽位 EM≥0.90）：{'✅ 过' if gates_ok else '❌ 未过'}")

    text = "\n".join(lines) + "\n"
    print(text)
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "a", encoding="utf-8", newline="") as f:
        f.write(text + "\n")
    print(f"[done] 报告已追加 → {REPORT}")


if __name__ == "__main__":
    main()
