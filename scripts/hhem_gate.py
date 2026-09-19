# -*- coding: utf-8 -*-
"""
幻觉一致性门禁（P1#7 · Vectara HHEM-2.1-Open，Apache-2.0，CPU 可跑）
====================================================================
定位：**分类器先筛**——对「回答 vs 证据」批量打 0-1 一致性分，低分样本高亮。
⚠️ 两条能力边界（官方模型卡 + 本项目调研双确认）：
  ① 只判「回答与证据是否一致」，**不判「是否回答了用户的问题」** → 与 fact_probe 互补不替代；
  ② 对「问题」不敏感 → 不能单独当忠实度门禁。

首次接入按纪律走**观察档**：--observe 只报分布不拦（阈值调到 0.5 直接拦会得到
"永远红的门禁"——项目在 --gate 上吃过的教训）。跑两周看分布再定真阈值。

用法：
  python scripts/hhem_gate.py --smoke              # 3 对内置样例验证模型可用（加载自检）
  python scripts/hhem_gate.py --observe            # 对 evals/judges/labels.jsonl 的 20 条真实问答打分
  python scripts/hhem_gate.py --observe --input <jsonl>   # 自定义输入（需 payload.answer/evidence）
模型缓存：首次运行经 hf-mirror 下载（约 3GB），之后离线可用。
"""
import argparse
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")  # 国内镜像；直连可用的用户可覆盖

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABELS = os.path.join(REPO, "evals", "judges", "labels.jsonl")
MODEL_ID = "vectara/hallucination_evaluation_model"

SMOKE = [
    ("上海理工大学主校区位于军工路516号。", "上理工的主校区在军工路516号。", "一致（复述）"),
    ("上海理工大学主校区位于军工路516号。", "上理工主校区位于上海市徐汇区。", "矛盾（地点错）"),
    ("上海理工大学主校区位于军工路516号。", "学校的猫很多，同学们都很喜欢撸猫。", "无关（应低分）"),
]


def load_model():
    from transformers import AutoModelForSequenceClassification
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_ID, trust_remote_code=True)
    model.eval()
    return model


def score(model, pairs):
    with __import__("torch").no_grad():
        out = model.predict([p for p, _ in pairs])
    return [float(x) for x in out]


def main():
    ap = argparse.ArgumentParser(description="HHEM 幻觉一致性（观察档）")
    ap.add_argument("--smoke", action="store_true", help="3 对内置样例，验证模型加载与打分方向")
    ap.add_argument("--observe", action="store_true", help="对标注集/trace 打分并报分布（不拦）")
    ap.add_argument("--input", default=LABELS, help="JSONL 输入（需 payload.answer 与 payload.evidence）")
    ap.add_argument("--gate", type=float, default=None,
                    help="阈值（慎用！先 --observe 看分布再定；低于阈值的条目 exit 1）")
    args = ap.parse_args()
    if not (args.smoke or args.observe or args.gate is not None):
        print(" nothing to do：--smoke / --observe / --gate 任选")
        return 2

    model = load_model()

    if args.smoke:
        pairs = [(p, h) for p, h, _ in SMOKE]
        scores = score(model, pairs)
        ok = scores[0] > scores[1] and scores[0] > scores[2]
        for (p, h, label), s in zip(SMOKE, scores):
            print(f"  {s:.3f}  {label}")
        print(f"✅ 方向自检{'通过' if ok else '失败'}：一致 > 矛盾/无关")
        return 0 if ok else 1

    rows = [json.loads(l) for l in open(args.input, encoding="utf-8") if l.strip()]
    pairs, ids = [], []
    for r in rows:
        p = r.get("payload") or {}
        ans = (p.get("answer") or "").strip()
        ev = p.get("evidence") or []
        ctx = "\n".join(str(x) for x in ev if str(x).strip())
        if ans and ctx:
            pairs.append((ctx, ans))
            ids.append(r["id"])
    if not pairs:
        print("❌ 没有可评样本（需要同时有 answer 与 evidence）")
        return 2

    scores = score(model, pairs)
    order = sorted(range(len(pairs)), key=lambda i: scores[i])
    print(f"== HHEM 观察档（{len(pairs)} 条）==")
    for i in order[:6]:
        print(f"  {scores[i]:.3f}  {ids[i]}")
    mn, mean = min(scores), sum(scores) / len(scores)
    below = [(ids[i], round(scores[i], 3)) for i in range(len(pairs)) if scores[i] < 0.5]
    print(f"\n  min={mn:.3f}  mean={mean:.3f}  <0.5 的条目 {len(below)} 条{('：' + str(below[:5])) if below else ''}")
    if args.gate is not None:
        bad = [(ids[i], round(scores[i], 3)) for i in range(len(pairs)) if scores[i] < args.gate]
        if bad:
            print(f"🚫 低于阈值 {args.gate}：{len(bad)} 条 {bad[:5]}")
            return 1
        print(f"✅ 全部 ≥ {args.gate}")
    else:
        print("（观察档：只报分布不拦。定阈值前先积累两周分布数据。）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
