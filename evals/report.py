# -*- coding: utf-8 -*-
"""
评测系统 · 趋势报告（2026-09-18 P1）
=====================================
把两份数据合成「一眼看懂」的周报：
  1) `evals/runs/run_*.json`   —— 每次门禁的指标 → 趋势与退步预警
  2) `evals/runs/trace_*.jsonl` —— 线上每轮对话 → 模式分布、延迟分位数、估算成本

为什么需要它：评测的价值在**趋势**，不在某一次数字。没有趋势，团队仍会回到
「凭体感判断改完有没有变好」。终端打印的同时落一份 Markdown，便于贴给 B 或存档。

用法：
  python evals/report.py            # 最近 10 次门禁 + 全部 trace
  python evals/report.py --last 20
"""
import argparse
import glob
import json
import os
import sys
import time
from collections import Counter

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNS = os.path.join(ROOT, "evals", "runs")
KEYS = ["l0_all_pass", "entity_recall", "template_acc", "recall@5", "mrr",
        "forbidden_hits", "pass^k", "acc",
        # P2：ITC 字典序（软成本可上趋势）+ ④ 延迟/成本观测档
        "engine_soft_cost_sum", "engine_optimality_ratio_avg",
        "lat_p95_ms", "est_cost_cny"]

# 估算用：deepseek-chat 一次调用（约 1.5k in + 250 out）≈ 0.003 元。
# 只用于「量级感知」，不是账单价（真实账单以平台为准）。
COST_PER_CALL = 0.003

BUF = []


def say(s=""):
    print(s)
    BUF.append(s)


def pctl(vals, p):
    if not vals:
        return None
    s = sorted(vals)
    return s[min(len(s) - 1, int(round((len(s) - 1) * p)))]


def _task_pass(rec):
    """从一条 task 记录里判「这次过没过」。判不出返回 None（不计入，宁可少判不误判）。"""
    if not isinstance(rec, dict):
        return None
    for k in ("pass_all_k", "pass_any", "template_ok", "entity_hit", "ok"):
        if isinstance(rec.get(k), bool):
            return rec[k]
    if isinstance(rec.get("doc_rank"), int):
        return rec["doc_rank"] > 0
    return None


def _graduation(runs, min_runs=3):
    """能力题毕业机制（P2）：扫历史 run 的 tasks。

    返回 (毕业候选, 长期未过)。
      · capability 连续 min_runs 次全过 → 毕业候选（可升格为 regression 进硬门槛）
      · regression 连续 min_runs 次全未过 → 长期未过（先查是不是题本身有问题）
    ⚠️ 只给候选，不自动改 golden 的 split —— 升格是人工决定（防「门禁自己放松自己」）。
    """
    per_run = []
    for p in runs:
        try:
            tasks = json.load(open(p, encoding="utf-8")).get("tasks") or []
        except Exception:
            continue
        d = {}
        for t in tasks:
            if not isinstance(t, dict) or "id" not in t:
                continue
            sp = t.get("split")
            if sp not in ("capability", "regression"):
                continue
            v = _task_pass(t)
            if v is not None:
                d[t["id"]] = (sp, v)
        if d:
            per_run.append(d)
    tail = per_run[-min_runs:]
    if len(tail) < min_runs:
        return [], []
    grad, chronic = [], []
    ids = sorted(set().union(*[set(d) for d in tail]))
    for tid in ids:
        present = [d[tid] for d in tail if tid in d]
        if len(present) < min_runs:
            continue
        splits = {sp for sp, _ in present}
        if len(splits) != 1:
            continue
        sp = next(iter(splits))
        vals = [v for _, v in present]
        if sp == "capability" and all(vals):
            grad.append((tid, len(vals)))
        elif sp == "regression" and not any(vals):
            chronic.append((tid, len(vals)))
    return grad, chronic


def _selftest():
    """毕业机制自检（反向验证纪律：把 all/any 判反、或把 tail 切片去掉必须变红）。"""
    import tempfile
    tmp = tempfile.mkdtemp(prefix="eval-report-selftest-")
    # 真实形态的夹具：每次运行都含同一批题（题集在多次运行间是稳定的；
    # 第一版夹具把 r-chron 只放进 2 次运行 → 「连续 3 次」自然凑不满，
    # 自检立刻报红。这正是反向验证要抓的东西：夹具不真实，结论就不成立。）
    seq = {
        "cap-stable":  ("capability", [True, True, True]),
        "cap-flaky":   ("capability", [True, False, True]),
        "reg-passing": ("regression", [True, True, True]),
        "reg-chronic": ("regression", [False, False, False]),
    }
    paths = []
    for i in range(3):
        rows = [{"id": tid, "split": sp, "pass_any": vals[i]}
                for tid, (sp, vals) in seq.items()]
        p = os.path.join(tmp, f"run_{i}.json")
        json.dump({"tasks": rows}, open(p, "w", encoding="utf-8"))
        paths.append(p)
    grad, chronic = _graduation(paths, min_runs=3)
    gids = {g[0] for g in grad}
    cids = {c[0] for c in chronic}
    checks = [
        ("capability 连续全过 → 毕业候选", "cap-stable" in gids),
        ("capability 中途红过 → 不毕业", "cap-flaky" not in gids),
        ("regression 连续全未过 → 长期未过", "reg-chronic" in cids),
        ("regression 一直绿 → 不误报", "reg-passing" not in cids),
        ("run 数不足 min_runs → 一律不报", _graduation(paths[:2], min_runs=3) == ([], [])),
        ("doc_rank=0 判未过", _task_pass({"split": "capability", "doc_rank": 0}) is False),
        ("doc_rank=3 判过", _task_pass({"split": "capability", "doc_rank": 3}) is True),
        ("判不出的记录返回 None 不计入", _task_pass({"id": "x"}) is None),
    ]
    bad = 0
    for name, ok in checks:
        if not ok:
            bad += 1
        print(f"  {'✅' if ok else '❌'} {name}")
    print(f"\n{'✅' if bad == 0 else '❌'} 毕业机制自检 {len(checks) - bad}/{len(checks)}")
    return 0 if bad == 0 else 1


def main():
    if "--selftest" in sys.argv:
        return _selftest()
    ap = argparse.ArgumentParser(description="评测趋势报告")
    ap.add_argument("--last", type=int, default=10)
    args = ap.parse_args()

    runs = sorted(glob.glob(os.path.join(RUNS, "run_*.json")))[-args.last:]
    say(f"# 评测趋势报告")
    say()
    say(f"- 生成时间：{time.strftime('%Y-%m-%d %H:%M')}")
    say(f"- 门禁运行：{len(runs)} 次｜目录 `evals/runs/`")
    say()
    say("## 一、门禁指标趋势（旧 → 新）")
    say()
    if not runs:
        say("（还没有门禁运行记录 —— 先跑 `npm run eval:gate`）")
    else:
        names = [os.path.basename(r)[4:19][-8:] for r in runs]
        say("| 指标 | " + " | ".join(names) + " | 备注 |")
        say("|---" * (len(names) + 2) + "|")
        for k in KEYS:
            row = [json.load(open(r, encoding="utf-8")).get("metrics", {}).get(k)
                   for r in runs]
            if all(v is None for v in row):
                continue
            valid = [v for v in row if isinstance(v, (int, float))]
            note = ""
            if len(valid) >= 2 and valid[-1] < valid[-2]:
                note = "⚠️ 较上次退步"
            say(f"| `{k}` | " + " | ".join("-" if v is None else str(v) for v in row)
                + f" | {note} |")
    say()

    recs = []
    traces = sorted(glob.glob(os.path.join(RUNS, "trace_*.jsonl")))
    for t in traces:
        for line in open(t, encoding="utf-8"):
            if line.strip():
                try:
                    recs.append(json.loads(line))
                except Exception:
                    pass

    say("## 二、流量侧（线上 trace）")
    say()
    if not recs:
        say("（还没有 trace —— 用 `LIBAO_DEBUG=1` 起后端聊几句就会落盘）")
    else:
        modes = Counter(r.get("mode") for r in recs)
        routes = Counter(r.get("route") for r in recs)
        ms = [r["ms"] for r in recs if isinstance(r.get("ms"), (int, float))]
        templ = modes.get("template", 0)
        agent = sum(1 for r in recs if r.get("tools"))
        calls = (modes.get("llm", 0) - agent) + \
                sum(len(r.get("tools") or []) + 1 for r in recs if r.get("tools"))
        space_rate = round(100 * sum(1 for r in recs if r.get("used_space")) / len(recs))
        say(f"- 轮次 **{len(recs)}**（{len(traces)} 个文件）")
        say(f"- 模式分布：`{dict(modes)}`")
        say(f"- 路由分布：`{dict(routes)}`")
        say(f"- 延迟：P50 **{pctl(ms, .5)}ms**｜P95 **{pctl(ms, .95)}ms**"
            f"｜均值 {round(sum(ms)/len(ms)) if ms else '-'}ms")
        say(f"- 空间注入率 {space_rate}%｜**模板直答占比 {round(100*templ/len(recs))}%**"
            f"（这部分 0 次 LLM）")
        say(f"- 估算 LLM 调用 ≈ {calls} 次 → ≈ {round(calls*COST_PER_CALL, 3)} 元"
            f"（量级感知，非账单）")
    say()
    say("## 三、能力题毕业候选（P2 机制）")
    say()
    say("机制：`split=capability` 的题**不参与门禁**（软期望，噪声大）。但若它连续多次全过，")
    say("说明该能力已稳定 → 应「毕业」为 regression 进硬门槛；反之若长期红则是出题有问题。")
    say("本表只给候选，**升格动作仍需人工确认**（改 golden 的 split 字段）。")
    say()
    grad, chronic = _graduation(runs)
    if not grad and not chronic:
        say("（运行记录不足以判断 —— 需要 ≥3 次含 capability 题的结果）")
    else:
        if grad:
            say("**建议毕业（连续全过 → 可升为 regression）**")
            say()
            say("| 题 id | 连续通过次数 | 建议 |")
            say("|---|---|---|")
            for tid, n in grad:
                say(f"| `{tid}` | {n} | 把 `split` 改成 `regression` 后跑一次门禁确认 |")
            say()
        if chronic:
            say("**长期未过（capability 里一直红 → 先当成出题问题查，别急着当退步）**")
            say()
            say("| 题 id | 连续未过次数 |")
            say("|---|---|")
            for tid, n in chronic:
                say(f"| `{tid}` | {n} |")
            say()
    say("## 四、读法")
    say()
    say("1. `l0_all_pass` 必须恒为 1 —— 它掉说明确定性回归集被破坏了，优先处理。")
    say("2. `template_acc` 掉 = 省钱快路径退化（答案可能仍对，但每次多花钱）。")
    say("3. `recall@5` / `mrr` 掉 = 检索层退化，先看 `run_*.json` 里 rank=0 的题。")
    say("4. 质量提升后跑 `--update-baseline` 固化新基线，否则下次对比没意义。")
    say("5. `engine_soft_cost_sum` 上升**不等于**退步 —— 判据是 acceptance.ts 的字典序"
        "（先比硬违约，硬相同才比软成本）；本表只作趋势。")
    say("6. `lat_p95_ms` / `est_cost_cny` 是观测档：先攒分布，再定阈值（假红门禁等于没有门禁）。")

    os.makedirs(RUNS, exist_ok=True)
    out = os.path.join(RUNS, f"report_{time.strftime('%Y%m%d-%H%M%S')}.md")
    open(out, "w", encoding="utf-8").write("\n".join(BUF) + "\n")
    print(f"\n📄 报告已写出：{out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
