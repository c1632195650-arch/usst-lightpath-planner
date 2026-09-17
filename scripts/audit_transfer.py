# -*- coding: utf-8 -*-
"""
转场数据质量审计（2026-09-18，CY 侧）
=====================================
用途：引擎的转场分钟来自 `campus.route()`，而 `campus.route()` 一半靠**手测/高德真值**
（`campus_map.walk_minutes`，42 条），一半靠**OSM 路网实算**。两套数据一旦互相矛盾，
引擎就会拿到错的转场 —— 而这个错**不会**在引擎自己的测试里暴露（对它来说那只是输入）。

所以这里做四件事（都是「机器可查」，替换掉人工翻清单）：

  A 真值覆盖   哪些对已实测（verified=True）、哪些还是 est —— 直接回答「还差多少」
  B 交叉核对   逐对比较 `walk_minutes`（真值） vs `route()`（路网），
               差异 ≥ max(2min, 30%) 记为**内部矛盾**（至少一方错，可执行）
  C 对称性     同一对若两个方向都有记录，分钟差 > 2 也记为矛盾
  D 定位精度   `route()` 返回 `reliable=False`（端点靠弱锚兜底）的对 + 桥接碎片清单

另有 E：**清单对照** —— 读 `docs/needs-check-list.md`，核对「仍需补的截图」类事项
在当前数据里是否已闭环（防「补一项其实早就补过」这种重复劳动）。

门禁口径：只有 B/C（内部矛盾）算失败；A/D/E 是信息性（它们指向既有文档与实地计划）。

用法：
  python scripts/audit_transfer.py                 # 摘要 + 写 evals/runs/transfer_audit.json
  python scripts/audit_transfer.py --gate          # 有内部矛盾则 exit 1
"""
import argparse
import json
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "server"))

import campus  # noqa: E402

DOC = os.path.join(ROOT, "docs", "needs-check-list.md")

# E · 清单对照（来源：docs/needs-check-list.md「⚠️ 仍需补的截图（3 张）」）
# 每项 = (清单里的说法, 数据侧用来判断的 (from,to) 关键字, 文档里应仍含的字样)
CHECKLIST = [
    ("第三教学楼 → 第一食堂 步行导航（清单说总时间被裁掉）",
     ("第三教学楼", "第一食堂"), "第三教学楼"),
    ("第二学生公寓 → 南校区思餐厅（清单说还是 est 6 分钟）",
     ("二公寓", "思餐厅"), "第二学生公寓"),
    ("第一教学楼 → 第三教学楼（清单说最常见课间转场）",
     ("第一教学楼", "第三教学楼"), "第一教学楼"),
]


def norm(f, t):
    return f"{f} ⇄ {t}"


def main():
    ap = argparse.ArgumentParser(description="转场数据质量审计")
    ap.add_argument("--gate", action="store_true", help="内部矛盾非零则 exit 1")
    ap.add_argument("--json", default=os.path.join(ROOT, "evals", "runs", "transfer_audit.json"))
    ap.add_argument("--max-show", type=int, default=12)
    args = ap.parse_args()

    m = campus.load_map()
    wm = m.get("walk_minutes", [])
    print(f"🧭 转场数据审计｜walk_minutes {len(wm)} 条（真值侧）")

    # ---------- A 真值覆盖 ----------
    verified = [x for x in wm if x.get("verified")]
    est = [x for x in wm if not x.get("verified")]
    print(f"\n== A 真值覆盖 ==")
    print(f"  已实测 {len(verified)}/{len(wm)}（{len(verified)/len(wm)*100:.0f}%）；仍为 est {len(est)} 条")
    for x in est[:args.max_show]:
        print(f"    · {x['from']} → {x['to']}  {x['minutes']}min ｜ {(x.get('note') or '')[:40]}")

    # ---------- B 交叉核对（真值 vs 路网）----------
    conflicts, checked, skipped = [], 0, 0
    for x in wm:
        a, b, truth = x["from"], x["to"], x["minutes"]
        try:
            r = campus.route(a, b)
        except Exception:
            r = None
        if not r or not r.get("minutes"):
            skipped += 1
            continue
        checked += 1
        got = r["minutes"]
        tol = max(2, 0.3 * truth)
        if abs(got - truth) >= tol:
            conflicts.append({
                "from": a, "to": b, "truth_min": truth, "route_min": round(got, 1),
                "route_meters": round(r.get("meters", 0)), "reliable": bool(r.get("reliable")),
                "delta": round(got - truth, 1), "note": (x.get("note") or "")[:60],
            })
    conflicts.sort(key=lambda c: -abs(c["delta"]))
    print(f"\n== B 交叉核对（walk_minutes 真值 ↔ OSM 路网）==")
    print(f"  可核对 {checked} 对｜路网算不出（端点未定位）{skipped} 对"
          f"｜**内部矛盾 {len(conflicts)} 对**（阈值 max(2min, 30%)）")
    for c in conflicts[:args.max_show]:
        print(f"    ⚠️ {c['from']} → {c['to']}：真值 {c['truth_min']}min vs 路网 {c['route_min']}min"
              f"（Δ{c['delta']:+}｜{c['route_meters']}m｜reliable={c['reliable']}）")

    # ---------- C 对称性 ----------
    pairs = {}
    for x in wm:
        pairs.setdefault(frozenset((x["from"], x["to"])), []).append(x)
    asym = []
    for k, v in pairs.items():
        if len(v) == 2:
            d = abs(v[0]["minutes"] - v[1]["minutes"])
            if d > 2:
                asym.append({"a": v[0]["from"], "b": v[0]["to"],
                             "m1": v[0]["minutes"], "m2": v[1]["minutes"], "delta": d})
    print(f"\n== C 对称性（同对两方向）==")
    print(f"  双向都记录的对 {sum(1 for v in pairs.values() if len(v) == 2)} 个"
          f"｜**分钟差 > 2 的 {len(asym)} 个**")
    for a in asym[:args.max_show]:
        print(f"    ⚠️ {a['a']} ⇄ {a['b']}：{a['m1']} vs {a['m2']} min")

    # ---------- D 定位精度与桥接碎片 ----------
    net = campus.network()
    bridged = list(getattr(net, "bridged", []) or []) if net else []
    print(f"\n== D 定位精度与桥接碎片 ==")
    print(f"  桥接碎片 {len(bridged)} 处（缺口米数, 碎片节点数）：{bridged}")
    print("  说明：桥接边按直线 ×1.2 估算 —— 这些区的对是精度最差来源（既有结论，非本轮新增）")
    weak = [c for c in conflicts if not c["reliable"]]
    print(f"  内部矛盾里 {len(weak)} 对的端点靠弱锚兜底（reliable=False）")

    # ---------- F 物理合理性：把「真值错」与「路网绕路」分开 ----------
    # 为什么要这节：B 节只说「两边不一致」，**谁错**才是可执行信息。
    # ⚠️ 口径要诚实：真值多数只有分钟、没有米数（米数写在 note 里，仅部分有）。
    #    所以先看**全局方向性**（若矛盾几乎全是"路网 > 真值"，那是系统性偏置，
    #    不是 8 条独立的真值错误），再对**有米数**的条目逐条定夺；
    #    没有米数的一律标 `needs_check`，**不武断**（第一版直接判"真值偏短"，
    #    但「二公寓→菜鸟驿站」实际是驿站就在二公寓旁、2min 合理 —— 是路网绕了）。
    SPEED_FAST = 150          # m/min，超过这个速度按「走不到」处理
    DETOUR = 1.4              # 路网米数 / 真值米数 ≥ 此值 → 路网绕路
    n_route_longer = sum(1 for c in conflicts if c["delta"] > 0)
    n_truth_longer = sum(1 for c in conflicts if c["delta"] < 0)
    print(f"\n== F 物理合理性（谁错才是可执行信息）==")
    if conflicts:
        share = n_route_longer / len(conflicts)
        pct = sum(abs(c["delta"]) / c["truth_min"] for c in conflicts) / len(conflicts) * 100
        direction = ("**系统性偏置：路网普遍偏长**" if share >= 0.8
                     else ("**系统性偏置：真值普遍偏长**" if n_truth_longer / len(conflicts) >= 0.8
                           else "方向不一致（更像逐条数据问题）"))
        print(f"  方向：路网偏长 {n_route_longer} 条 / 真值偏长 {n_truth_longer} 条 → {direction}"
              f"（平均偏差 {pct:.0f}%）")
        print(f"  含义：引擎拿到的是**偏保守的转场**（预留偏多）→ 计划会偏松，不会迟到；"
              f"根因候选：桥接边 ×1.2、校园捷径缺失、天桥未连通")

    triage = {"route_detour": [], "truth_suspect": [], "needs_check": []}
    for c in conflicts:
        r = campus.route(c["from"], c["to"]) or {}
        meters = r.get("meters") or 0
        note_m = re.search(r"(\d{2,4})\s*米", c.get("note") or "")
        truth_m = int(note_m.group(1)) if note_m else None
        item = {**c, "route_meters": round(meters), "truth_meters": truth_m}
        if truth_m:
            ratio = meters / truth_m
            if ratio >= DETOUR:
                item["verdict"] = f"路网绕路（{round(meters)}m / 真值 {truth_m}m = {ratio:.2f}×）"
                triage["route_detour"].append(item)
            elif truth_m / c["truth_min"] > SPEED_FAST:
                item["verdict"] = f"真值偏短（{truth_m}m / {c['truth_min']}min 走不到）"
                triage["truth_suspect"].append(item)
            else:
                item["verdict"] = "两值皆可（路径选择差异）"
                triage["needs_check"].append(item)
        else:
            item["verdict"] = ("无真值米数，无法定夺：真值偏短 or 路网绕路"
                               f"（隐含速度 {round(meters / c['truth_min'])} m/min）")
            triage["needs_check"].append(item)
    print(f"  🔎 路网绕路 {len(triage['route_detour'])} 条（有真值米数可比）"
          f"｜⚠️ 真值偏短 {len(triage['truth_suspect'])} 条"
          f"｜❔ 缺米数待定夺 {len(triage['needs_check'])} 条")
    for k, tag in (("route_detour", "路网绕路"), ("truth_suspect", "真值偏短"),
                   ("needs_check", "待定夺")):
        for it in triage[k][:args.max_show]:
            print(f"    [{tag}] {it['from']} → {it['to']}：{it['verdict']}")

    # ---------- E 清单对照（防重复劳动）----------
    doc_txt = open(DOC, encoding="utf-8").read() if os.path.exists(DOC) else ""
    print(f"\n== E 清单对照（docs/needs-check-list.md）==")
    if not doc_txt:
        print("  ⚠️ 找不到清单文档，跳过")
    closed, still_open, drift = [], [], []
    for label, (fa, fb), doc_kw in CHECKLIST:
        hit = next((x for x in wm
                    if fa in (x["from"] + x["to"]) and fb in (x["from"] + x["to"])), None)
        if hit and hit.get("verified"):
            closed.append((label, hit))
        else:
            still_open.append(label)
        if doc_kw and doc_kw not in doc_txt:
            drift.append(doc_kw)
    for label, hit in closed:
        print(f"  ✅ 已闭环：{label}\n       ↳ 数据：{hit['from']} → {hit['to']} {hit['minutes']}min"
              f"｜{(hit.get('note') or '')[:52]}")
    for label in still_open:
        print(f"  ⬜ 仍待补：{label}")
    if drift:
        print(f"  ⚠️ 清单文档疑似已改版（未找到字样 {drift}）→ 请复核本脚本的 CHECKLIST 常量")

    # ---------- 汇总 ----------
    payload = {
        "walk_minutes": len(wm), "verified": len(verified), "est": len(est),
        "checked_pairs": checked, "skipped_pairs": skipped,
        "conflicts": conflicts, "asymmetries": asym,
        "bridged_fragments": bridged,
        "triage": triage,
        "checklist_closed": [l for l, _ in closed], "checklist_open": still_open,
        "doc_drift": drift,
    }
    os.makedirs(os.path.dirname(args.json), exist_ok=True)
    json.dump(payload, open(args.json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n明细：{args.json}")

    bad = len(conflicts) + len(asym)
    print(f"结论：{'✅ 无内部矛盾' if bad == 0 else f'⚠️ {bad} 处内部矛盾（真值与路网至少一方错，需人工定夺）'}")
    return 1 if (args.gate and bad) else 0


if __name__ == "__main__":
    sys.exit(main())
