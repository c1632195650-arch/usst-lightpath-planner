# -*- coding: utf-8 -*-
"""L5 · 骑行时间估计 —— 给 `campus_map.json` 的 `walk_minutes` 每行补 `bike_minutes`

## 口径（重要）

用户口径：**不做骑行寻路，只在步行表上加一列估计值**。
原因见 `data/access_policy.json`：主校区 OSM 里 `bicycle` 标签 0 条 —— 我们不知道哪条路
禁骑、限行时段、哪里能停车。做真正的骑行寻路等于编数据。

所以本脚本：

    bike_minutes = 步行路网距离 ÷ 12 km/h ÷ 60 + 取放车 2 分钟

**沿的是步行路线**，不是骑行路线。校内 `footway` / `pedestrian` / `steps` 按 OSM 默认
是禁骑的，真骑行路线会明显不同 —— 因此这一列是 `est`，对外必须标注『估算』。

副产品：它会顺带暴露「这趟骑车到底划不划算」——
500 m 以内取放车 2 分钟几乎吃掉全部收益，只有 800 m 以上才明显省时间。

用法：
    python scripts/build_bike_minutes.py            # 写入
    python scripts/build_bike_minutes.py --dry-run  # 只看不改
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "server"))

MAP_PATH = os.path.join(ROOT, "data", "campus_map.json")
POLICY_PATH = os.path.join(ROOT, "data", "access_policy.json")

NOTE_KEY = "bike"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    pol = json.load(open(POLICY_PATH, encoding="utf-8"))
    speed = float(pol["_meta"]["speed_kmh"])
    overhead = float(pol["_meta"]["overhead_seconds"]) / 60.0

    m = json.load(open(MAP_PATH, encoding="utf-8"))
    wm = m.get("walk_minutes") or []
    import campus_network as cn
    net = cn.Network()

    rows, skipped = [], []
    for w in wm:
        a, b = w.get("from"), w.get("to")
        r = None
        try:
            r = net.route(a, b)
        except Exception:
            r = None
        if not r:
            skipped.append((a, b))
            # 解析不到就原样保留（不加 bike_minutes），不猜
            rows.append(dict(w))
            continue
        metres = r["meters"]
        bike = round(metres / 1000.0 / speed * 60.0 + overhead)
        # 至少要 1 分钟（再近也得停车）
        bike = max(1, int(bike))
        # 保持字段顺序：…minutes, bike_minutes, note, verified…
        # 🔴 必须**跳过已存在的 bike_minutes** —— 否则第二次运行时，
        #    遍历到旧键会把刚算好的新值又覆盖回旧值（生成器不幂等：
        #    第一次算 3，改锚点后应算 4，却仍写 3）。本脚本因此**必须可重复运行**。
        new = {}
        for k, v in w.items():
            if k == "bike_minutes":
                continue
            new[k] = v
            if k == "minutes":
                new["bike_minutes"] = bike
        if "minutes" not in w:           # 理论上不会发生（schema 固定）
            new["bike_minutes"] = bike
        rows.append(new)

    m["walk_minutes"] = rows
    m.setdefault("_meta", {})[NOTE_KEY] = (
        "`walk_minutes` 每行的 `bike_minutes` 是**估算**（est），不是实测、也不是高德数据："
        "按 `data/access_policy.json` 的口径 = 步行路网距离 ÷ 12 km/h ÷ 60 + 取放车 2 分钟。"
        "校内 footway/pedestrian/steps 按 OSM 默认禁骑，真正的骑行路线会与步行路线不同 —— "
        "所以这一列只能当量级参考，对外必须标注『估算』。生成脚本 `scripts/build_bike_minutes.py`。"
    )

    if args.dry_run:
        for w in m["walk_minutes"][:10]:
            print(f"  {w['from']} → {w['to']}: 步行 {w.get('minutes')} 分 / 骑行(估) {w.get('bike_minutes')} 分")
        print(f"  … 共 {len(rows)} 行，未解析 {len(skipped)} 行")
        print("  （--dry-run，未写回）")
        return 0

    with open(MAP_PATH, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, indent=1)

    n_ok = sum(1 for w in rows if "bike_minutes" in w)
    print(f"✅ 已写回 campus_map.json：{n_ok}/{len(rows)} 行补上 bike_minutes")
    if skipped:
        print(f"   ⚠️ 未解析（保持原样、不加估计值）：{skipped}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
