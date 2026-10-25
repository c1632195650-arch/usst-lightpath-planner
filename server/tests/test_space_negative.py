# -*- coding: utf-8 -*-
"""W6 · 玄学问句空间意图守卫测试（纯 Python；金标 evals/golden/space_negative.jsonl 只增）
RV：摘掉玄学守卫（或回填单字「近」）→ 对应用例恰红。
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from campus import has_space_intent  # noqa: E402

GOLDEN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                      "evals", "golden", "space_negative.jsonl")


def run():
    rows = [json.loads(l) for l in open(GOLDEN, encoding="utf-8")]
    assert len(rows) >= 15, f"否定金标至少 15 条（实际 {len(rows)}）"
    bad = [r for r in rows if has_space_intent(r["q"]) != r["want_space"]]
    for r in bad:
        print(f"  ✗ {r['q']} → want {r['want_space']}")
    assert not bad, f"{len(bad)} 条与金标不符"
    # 存量空间类正例零回归（真实问路句不被玄学守卫误伤）
    for q in ("图书馆几点开门", "附近哪里有打印店", "三教怎么走", "学校有没有麦当劳"):
        assert has_space_intent(q), f"正例被误拦：{q}"
    print(f"✓ W6：否定金标 {len(rows)}/{len(rows)} 过门 + 存量正例 4/4 零回归")


if __name__ == "__main__":
    run()
