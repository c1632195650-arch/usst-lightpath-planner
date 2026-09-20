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
        "forbidden_hits", "pass^k", "acc"]

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


def main():
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
    say("## 三、读法")
    say()
    say("1. `l0_all_pass` 必须恒为 1 —— 它掉说明确定性回归集被破坏了，优先处理。")
    say("2. `template_acc` 掉 = 省钱快路径退化（答案可能仍对，但每次多花钱）。")
    say("3. `recall@5` / `mrr` 掉 = 检索层退化，先看 `run_*.json` 里 rank=0 的题。")
    say("4. 质量提升后跑 `--update-baseline` 固化新基线，否则下次对比没意义。")

    os.makedirs(RUNS, exist_ok=True)
    out = os.path.join(RUNS, f"report_{time.strftime('%Y%m%d-%H%M%S')}.md")
    open(out, "w", encoding="utf-8").write("\n".join(BUF) + "\n")
    print(f"\n📄 报告已写出：{out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
