# -*- coding: utf-8 -*-
"""
S 批 S3 · /api/plan/understand 金标评测（CY 复核后修订版 v3 + D 批 dialog 组）
==========================================================
金标：evals/golden/plan_understand.jsonl（100 条 = 30 intent + 20 answer + 10 boundary
+ 40 dialog【D 批 D2：act 分类 25 + idx 消歧 8 + 防编造负例 7】）。
CY 复核结论（2026-09-27）落地方：
  ① a09 归位不稳 → **双侧同归一**：金标片段与预测片段都过规则层 canon
    （生产落库的本来就是归一值——「还没定，到时候再说」落库为「时间待定」），
    金标文件不动；配合规则先行，a09 类模糊回答根本不会走到 LLM。
  ② i30「隔天」→ **生产忠实**：规则层先跑，已抽到的槽位随请求传端点，
    合并计分只补空（mergeSlots 语义）；规则闸拦下的条目生产走 RAG，计 action=false，
    另发「端点直判」参考线量化闸门缺口。
  ③ 端点偶发 8s 超时 → 设计行为：ok:false 后生产回规则结果，评测同口径计分，
    不重试、不报错。

工程口径（v3 修复）：与 harness 的一切交接走**临时文件 + shell=False**——
JSON 串直接进 argv 会被 Windows shell 搅碎（首跑 ENOENT/NoneType 崩溃的根因）。

用法：
  在线：python scripts/eval_plan_understand.py http://127.0.0.1:8001
  离线对照：LLM_EVAL_OFFLINE=1 python scripts/eval_plan_understand.py
报告：docs/eval-libao-understand-2026-09-27.md（追加）。
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
TODAY = "2026-09-27"

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def norm(s):
    if s is None:
        return ""
    return re.sub(r"\s+", "", str(s))


def num_eq(a, b):
    try:
        return a is not None and abs(float(a) - float(b)) < 1e-6
    except (TypeError, ValueError):
        return False


def frag_hit(pred, want):
    p, w = norm(pred), norm(want)
    return bool(p) and bool(w) and (p in w or w in p)


def load_golden():
    items = []
    with open(GOLDEN, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                items.append(json.loads(line))
    return items


def run_node(mode, payload, tag):
    """跑 harness。payload 为 dict → 写临时文件传路径（绝不把 JSON 串放进 argv）。"""
    if isinstance(payload, (dict, list)):
        tmp = os.path.join(ROOT, f"_eval_tmp_{tag}.json")
        with open(tmp, "w", encoding="utf-8", newline="") as f:
            json.dump(payload, f, ensure_ascii=False)
        arg = tmp
    else:
        tmp = None
        arg = payload
    cmd = ["node", "--import", "./scripts/register-alias.mjs",
           "scripts/eval_understand_offline.mjs", mode, arg, TODAY]
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True,
                       encoding="utf-8", shell=False)
    if tmp:
        try:
            os.remove(tmp)
        except OSError:
            pass
    if r.returncode != 0:
        print(f"[node:{mode}] 失败：", (r.stderr or "")[-400:])
        sys.exit(1)
    return json.loads(r.stdout)


def post_understand(base, body, timeout=15):
    req = urllib.request.Request(
        f"{base.rstrip('/')}/api/plan/understand",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            res = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        res = {"ok": False, "reason": f"{type(e).__name__}: {e}"}
    res["_ms"] = int((time.time() - t0) * 1000)
    return res


def merge_fill(rule_patch, llm_patch):
    """mergeSlots 语义：规则值优先，LLM 只补空。"""
    merged = dict(rule_patch or {})
    for k, v in (llm_patch or {}).items():
        if merged.get(k) in (None, "") and v not in (None, ""):
            merged[k] = v
    return merged


def eval_production(base, items, rules):
    """生产忠实主线：规则先行 → LLM 补空/救援 → 合并计分。"""
    llm_fragments = {}   # {id: {slot: 片段}} —— 规则没接住的 answer 项
    records = []
    for it in items:
        rid = rules.get(it["id"], {})
        if it["scene"] == "intent":
            r = rid.get("rule", {})
            rec = {"id": it["id"], "scene": "intent",
                   "prod_action": bool(r.get("action")),
                   "prod_intent": r.get("intent"),
                   "patch": dict(r.get("patch") or {}),
                   "endpoint_called": False}
            if r.get("action"):
                res = post_understand(base, {
                    "scene": "intent", "q": it["q"],
                    "slots": {k: v for k, v in (r.get("patch") or {}).items() if v is not None},
                    "today": TODAY,
                })
                rec["endpoint_called"] = True
                rec["endpoint_ok"] = bool(res.get("ok"))
                rec["ms"] = res.get("_ms")
                if res.get("ok") and res.get("action"):
                    rec["prod_intent"] = res.get("intent") \
                        if (r.get("intent") in (None, "create") and res.get("intent")) else r.get("intent")
                    rec["patch"] = merge_fill(r.get("patch"), res.get("patch"))
                # ok:false（含 8s 超时）→ 生产回规则结果，patch 保持规则值（③口径）
            else:
                # 生产不调端点；另发一次无 slots 请求作「端点直判」参考
                res = post_understand(base, {"scene": "intent", "q": it["q"], "today": TODAY})
                rec["endpoint_called"] = True
                rec["endpoint_ok"] = bool(res.get("ok"))
                rec["endpoint_action"] = bool(res.get("action"))
                rec["ms"] = res.get("_ms")
            records.append(rec)
        else:
            r = rid.get("rule", {})
            rec = {"id": it["id"], "scene": "answer",
                   "slots": dict(r.get("slots") or {}),
                   "raws": {}, "from_llm": False}
            if not r.get("contributed"):
                res = post_understand(base, {
                    "scene": "answer", "q": it["q"],
                    "asked": [f"{k}: {k}" for k in it.get("asked", [])],
                    "today": TODAY,
                })
                rec["endpoint_called"] = True
                rec["endpoint_ok"] = bool(res.get("ok"))
                rec["ms"] = res.get("_ms")
                if res.get("ok") and res.get("answers"):
                    rec["from_llm"] = True
                    rec["raws"] = res["answers"]
                    llm_fragments[it["id"]] = res["answers"]
            records.append(rec)

    # 两次批量归一（走临时文件）：金标片段 + LLM 救援片段（生产 applyClarifyFragments 同款）
    golden_frags = {}
    for it in items:
        if it["scene"] == "answer":
            for k, v in (it.get("expect", {}).get("answers") or {}).items():
                golden_frags.setdefault(it["id"], {})[k] = v
    canon_llm = run_node("canon", llm_fragments, "llm") if llm_fragments else {}
    canon_gold = run_node("canon", golden_frags, "gold") if golden_frags else {}
    for rec in records:
        if rec["scene"] == "answer" and rec["from_llm"]:
            c = canon_llm.get(rec["id"], {})
            for slot, frag in rec["raws"].items():
                cv = c.get(slot)
                if isinstance(cv, dict):
                    base_dict = rec["slots"].get(slot) if isinstance(rec["slots"].get(slot), dict) else {}
                    rec["slots"][slot] = {**base_dict, **cv}
                else:
                    rec["slots"][slot] = cv if cv else frag
    return records, canon_gold


def score_production(items, rules, records, canon_gold):
    tp = fp = fn = tn = 0
    fp_ids, fn_ids = [], []
    ep_action_hits = ep_total = 0
    slot_hit = slot_total = 0
    slot_miss = []
    ans_hit = ans_total = 0
    ans_miss = []

    rec_by_id = {r["id"]: r for r in records}
    for it in items:
        exp = it.get("expect", {})
        rec = rec_by_id[it["id"]]
        if it["scene"] == "intent":
            want_action = bool(exp.get("action"))
            if want_action and rec["prod_action"]:
                tp += 1
            elif want_action and not rec["prod_action"]:
                fn += 1
                fn_ids.append(it["id"])
            elif not want_action and rec["prod_action"]:
                fp += 1
                fp_ids.append(it["id"])
            else:
                tn += 1
            if "endpoint_action" in rec:
                ep_total += 1
                if bool(exp.get("action")) == rec["endpoint_action"]:
                    ep_action_hits += 1
            # 槽位 EM 只在 TP（生产真的产出了槽位）上计——FN 条目生产走 RAG，
            # 槽位没产出，混入会双重惩罚、混淆两个口径
            want_slots = exp.get("slots") or {}
            if want_slots and rec["prod_action"] and want_action:
                for k, wv in want_slots.items():
                    slot_total += 1
                    pv = rec["patch"].get(k)
                    ok = num_eq(pv, wv) if isinstance(wv, (int, float)) else frag_hit(pv, wv)
                    if ok:
                        slot_hit += 1
                    else:
                        slot_miss.append((it["id"], k, wv, pv))
        else:
            want = exp.get("answers") or {}
            for k in it.get("asked", []):
                if k not in want:
                    continue
                ans_total += 1
                want_raw = want[k]
                want_canon = (canon_gold.get(it["id"], {}) or {}).get(k)
                pred_canon = rec["slots"].get(k)
                pred_raw = rec["raws"].get(k)
                if k == "effort":
                    ok = _hit_effort(want_canon, pred_canon, want_raw, pred_raw)
                elif k == "when":
                    ok = _hit_when(want_canon, pred_canon)
                else:
                    ok = frag_hit(pred_canon, want_canon)
                if ok:
                    ans_hit += 1
                else:
                    ans_miss.append((it["id"], k, want_raw, pred_raw or pred_canon))
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec_ = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec_ / (prec + rec_) if prec + rec_ else 0.0
    return {
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": round(prec, 3), "recall": round(rec_, 3), "f1": round(f1, 3),
        "fp_ids": fp_ids, "fn_ids": fn_ids,
        "em": round(slot_hit / slot_total, 3) if slot_total else 0.0,
        "slot_miss": slot_miss,
        "ans_acc": round(ans_hit / ans_total, 3) if ans_total else 0.0,
        "ans_hit": ans_hit, "ans_total": ans_total, "ans_miss": ans_miss,
        "ep_acc": round(ep_action_hits / ep_total, 3) if ep_total else None,
        "ep_total": ep_total,
    }


def _hit_effort(want_canon, pred_canon, want_raw, pred_raw):
    w = want_canon if isinstance(want_canon, dict) else {}
    p = pred_canon if isinstance(pred_canon, dict) else {}
    nums = ("perWeekCount", "durationMin", "totalHours")
    want_n = {k: w.get(k) for k in nums if w.get(k) is not None}
    if want_n:
        return all(num_eq(p.get(k), v) for k, v in want_n.items())
    return frag_hit(pred_raw, want_raw)  # 双方都无数值（如「二十个学时」）→ 原话互含


def _hit_when(want_canon, pred_canon):
    w = want_canon if isinstance(want_canon, dict) else {}
    p = pred_canon if isinstance(pred_canon, dict) else {}
    wt, pt = w.get("text"), p.get("text")
    if not (wt and pt) or not frag_hit(pt, wt):
        return False
    for k in ("weekday", "relativeDays", "relativeWeeks", "month"):
        if w.get(k) is not None and not num_eq(p.get(k), w[k]):
            return False
    return True


# ── D 批 D2：dialog 组评测 ──────────────────────────────────────

DIALOG_ACTS = {
    "ask_slot", "pick_candidate", "confirm_draft", "discard_topic",
    "resume_topic", "new_intent", "negotiate_block", "chit_chat",
}


def validate_dialog_response(res, state):
    """独立复核响应合法性（镜像后端 _clean_dialog + 前端 validateDialogAct 的合法域）。

    ok:false = 已被拦截（走规则兜底）——不算非法输出；
    ok:true  = act 必须在白名单里，且编造的 candidate_idx 必须不存在。
    """
    if not res.get("ok"):
        return True
    act = res.get("act")
    if act not in DIALOG_ACTS:
        return False
    args = res.get("args") or {}
    topic = ((state or {}).get("topic") or {})
    cands = [c for c in (topic.get("candidates") or []) if isinstance(c, dict)]
    if act == "pick_candidate":
        idx = args.get("candidate_idx")
        if idx is not None:
            if cands and idx not in [c.get("idx") for c in cands]:
                return False
            if not cands:
                return False  # 无候选清单还敢给 idx = 编造
        elif not args.get("target_text"):
            return False
    return True


def eval_dialog(base, items):
    """dialog 组在线评测：逐条发 scene=dialog，act 分类 + idx + 拦截率。"""
    records = []
    for it in items:
        res = post_understand(base, {
            "scene": "dialog",
            "q": it["q"],
            "today": TODAY,
            "state": it.get("state") or {},
        })
        records.append({"id": it["id"], "res": res})
    return records


def score_dialog(items, records):
    from collections import Counter
    rec_by_id = {r["id"]: r["res"] for r in records}
    y_true, y_pred = [], []
    idx_hit = idx_total = 0
    idx_miss = []
    intercepted = 0
    n_neg = 0
    fails = []
    for it in items:
        res = rec_by_id[it["id"]]
        pred = res["act"] if res.get("ok") else "FAIL"
        if not res.get("ok"):
            fails.append((it["id"], res.get("reason")))
        y_true.append(it["expect"]["act"])
        y_pred.append(pred)
        if it.get("negative"):
            n_neg += 1
            if validate_dialog_response(res, it.get("state")):
                intercepted += 1
        want_idx = (it.get("expect", {}).get("args") or {}).get("candidate_idx")
        if want_idx is None:
            want_idx = it.get("expect", {}).get("candidate_idx")  # 金标里 args 平铺在 expect 下
        if want_idx is not None:
            idx_total += 1
            got = (res.get("args") or {}).get("candidate_idx") if res.get("ok") else None
            if got == want_idx:
                idx_hit += 1
            else:
                idx_miss.append((it["id"], want_idx, got))
    # 逐 act F1 → 宏平均；另报准确率与混淆。
    # FAIL（端点拒收/超时）不是分类标签 —— 它由「非法输出拦截率」口径单独覆盖，
    # 计入宏平均会双重惩罚（分类错一次 + 拦截机制正常工作一次）。
    acts_true = sorted(set(y_true))
    per = {}
    tp_all = 0
    for act in acts_true:
        tp = sum(1 for t, p in zip(y_true, y_pred) if t == act and p == act)
        fp = sum(1 for t, p in zip(y_true, y_pred) if t != act and p == act)
        fn = sum(1 for t, p in zip(y_true, y_pred) if t == act and p != act)
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        per[act] = round(f1, 3)
        tp_all += tp
    macro_f1 = round(sum(per.values()) / len(per), 3) if per else 0.0
    n_fail = sum(1 for p in y_pred if p == "FAIL")
    acc = round(tp_all / len(y_true), 3) if y_true else 0.0
    confusions = Counter((t, p) for t, p in zip(y_true, y_pred) if t != p)
    return {
        "macro_f1": macro_f1, "acc": acc, "per_act": per,
        "acc_raw": f"{tp_all}/{len(y_true)}",
        "n_fail": n_fail,
        "idx_em": round(idx_hit / idx_total, 3) if idx_total else None,
        "idx_hit": idx_hit, "idx_total": idx_total, "idx_miss": idx_miss,
        "intercept_rate": round(intercepted / n_neg, 3) if n_neg else None,
        "n_neg": n_neg, "fails": fails, "confusions": confusions.most_common(8),
    }


def main():
    items = load_golden()
    lines = ["", "## 评测运行 · " + time.strftime("%Y-%m-%d %H:%M") + "（生产忠实口径 v3）", ""]

    if os.environ.get("LLM_EVAL_OFFLINE", "") == "1":
        print("[offline] 规则兜底对照（不调 LLM）")
        preds = {p["id"]: p for p in run_node("eval", GOLDEN, "gold")}
        tp = fp = fn = tn = 0
        fn_ids = []
        for it in items:
            if it["scene"] != "intent":
                continue
            want = bool(it.get("expect", {}).get("action"))
            got = bool(preds[it["id"]].get("action"))
            if want and got:
                tp += 1
            elif want and not got:
                fn += 1
                fn_ids.append(it["id"])
            elif not want and got:
                fp += 1
            else:
                tn += 1
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec_ = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * prec * rec_ / (prec + rec_) if prec + rec_ else 0.0
        lines += [
            "### 离线对照（规则层，无 LLM）",
            f"- action P/R/F1 = {round(prec,3)} / {round(rec_,3)} / {round(f1,3)}"
            f"（TP {tp} · FP {fp} · FN {fn} · TN {tn}）｜FN: {fn_ids}",
            "- dialog 组（40 条）离线不评：规则链路没有对话管理器，dialog 是纯 LLM 场景。",
        ]
    else:
        base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8001"
        # DIALOG_ONLY=1：只跑 dialog 组（S/T 组基线已在案，省 67 次调用；补测/复测 dialog 用）
        dialog_only = os.environ.get("DIALOG_ONLY", "") == "1"
        print(f"[live] {base}/api/plan/understand（生产忠实：规则先行 → 端点补空/救援）"
              + ("【DIALOG_ONLY】" if dialog_only else ""))
        s = None
        if not dialog_only:
            rules = {r["id"]: r for r in run_node("rules", GOLDEN, "rules")}
            records, canon_gold = eval_production(base, items, rules)
            s = score_production(items, rules, records, canon_gold)
            n_called = sum(1 for r in records if r.get("endpoint_called"))
            n_ok = sum(1 for r in records if r.get("endpoint_ok"))
            gates = s["f1"] >= 0.95 and s["em"] >= 0.90
            lines += [
            "### 在线（生产忠实口径：规则先行 → LLM 补空/救援 → 双侧归一合并计分）",
            f"- 端点调用 {n_called} 次，ok {n_ok}（ok:false 含偶发 8s 超时——③口径："
            "设计行为，生产回规则结果，评测同口径计分，不重试）",
            f"- action P/R/F1 = {s['precision']} / {s['recall']} / {s['f1']}"
            f"（TP {s['tp']} · FP {s['fp']} · FN {s['fn']} · TN {s['tn']}）",
            f"- FN: {s['fn_ids']}｜FP: {s['fp_ids']}",
            f"- 槽位 EM（TP 条目）= {s['em']}"
            f"（未命中: {[(m[0], m[1]) for m in s['slot_miss']] or '无'}）",
            f"- answer 槽位命中（双侧归一）= {s['ans_acc']}（{s['ans_hit']}/{s['ans_total']}）"
            f"｜未命中: {[(m[0], m[1]) for m in s['ans_miss']] or '无'}",
            f"- 端点直判参考线（规则拦下的 {s['ep_total']} 条若直询端点的命中率）："
            f"{s['ep_acc'] if s['ep_acc'] is not None else 'n/a'}",
            f"- 门槛（action F1≥0.95 且 槽位 EM≥0.90）：{'✅ 过' if gates else '❌ 未过'}",
            ]

        # ── D 批 D2：dialog 组 ──
        dialog_items = [it for it in items if it["scene"] == "dialog"]
        if dialog_items:
            drecs = eval_dialog(base, dialog_items)
            ds = score_dialog(dialog_items, drecs)
            d_gates = (ds["macro_f1"] >= 0.9) and (ds["intercept_rate"] == 1.0)
            lines += [
                "### dialog 组（D 批：act 分类 25 + idx 消歧 8 + 防编造负例 7）",
                f"- act 宏 F1 = {ds['macro_f1']}（逐 act: {ds['per_act']}）｜准确率 = {ds['acc']}（{ds['acc_raw']}）",
                f"- 混淆 Top: {ds['confusions'] or '无'}",
                f"- idx 消歧 EM = {ds['idx_em']}（{ds['idx_hit']}/{ds['idx_total']}）"
                f"｜未命中: {ds['idx_miss'] or '无'}",
                f"- 非法输出拦截率 = {ds['intercept_rate']}（负例 {ds['n_neg']} 条；"
                "ok:false 或合法域内都算拦住——镜像后端 _clean_dialog + 前端 validateDialogAct）",
                f"- 端点拒收（dialog_act_rejected/超时等）: {ds['fails'] or '无'}",
                f"- 门槛（act 宏 F1≥0.90 且 拦截率 100%）：{'✅ 过' if d_gates else '❌ 未过'}",
            ]

    text = "\n".join(lines) + "\n"
    print(text)
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "a", encoding="utf-8", newline="") as f:
        f.write(text + "\n")
    print(f"[done] 报告已追加 → {REPORT}")


if __name__ == "__main__":
    main()
