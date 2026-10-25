# -*- coding: utf-8 -*-
"""W8 · metrics 每日聚合（2026-10-25）
====================================================
读 data/metrics_events.jsonl（{date, event} 计数事件，见 server/metrics.py），
聚合为 data/metrics_daily.json：按日 new_* + cumulative_*，**幂等**（同输入同输出，
无生成时间戳这类破坏确定性的字段）。cron 每日 04:37 跑（服务器 crontab 追加行），
也可随时手动重跑；**不做线上查询端点**（零新增攻击面），报告由本脚本打印。

用法：
  python scripts/metrics_aggregate.py            # 聚合并打印最近 7 天
  python scripts/metrics_aggregate.py --days 30  # 打印最近 30 天
"""
import argparse
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVENTS_PATH = os.path.join(ROOT, "data", "metrics_events.jsonl")
OUT_PATH = os.path.join(ROOT, "data", "metrics_daily.json")

EVENTS = ("register", "chat", "plan")


def aggregate(events_path=EVENTS_PATH, out_path=OUT_PATH):
    """聚合为按日行；幂等：重跑输出逐字节一致。返回 (days, out_path)。"""
    per = {}  # date -> {event: n}
    if os.path.exists(events_path):
        with open(events_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue  # 半行/脏行跳过（计数容错，不炸聚合）
                d, e = rec.get("date"), rec.get("event")
                if isinstance(d, str) and e in EVENTS:
                    per.setdefault(d, {})
                    per[d][e] = per[d].get(e, 0) + 1

    cum = {e: 0 for e in EVENTS}
    days = []
    for d in sorted(per):
        row = {"date": d}
        for e in EVENTS:
            n = per[d].get(e, 0)
            cum[e] += n
            row[e] = n
        row["cumulative_users"] = cum["register"]
        row["cumulative_chats"] = cum["chat"]
        row["cumulative_plans"] = cum["plan"]
        days.append(row)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"days": days}, f, ensure_ascii=False, indent=1)
        f.write("\n")
    return days, out_path


def main():
    ap = argparse.ArgumentParser(description="W8 落地仪表盘每日聚合")
    ap.add_argument("--days", type=int, default=7, help="打印最近 N 天（默认 7）")
    args = ap.parse_args()

    days, out_path = aggregate()
    total = days[-1] if days else {"cumulative_users": 0, "cumulative_chats": 0, "cumulative_plans": 0}
    print(f"[metrics] 聚合 {len(days)} 天 → {os.path.relpath(out_path, ROOT)}")
    print(f"[metrics] 累计：注册 {total['cumulative_users']} · 问答 {total['cumulative_chats']} · 排程落云 {total['cumulative_plans']}")
    if days:
        print("\ndate        reg  chat  plan | cum_users cum_chats cum_plans")
        for r in days[-args.days:]:
            print(f"{r['date']}  {r['register']:3d}  {r['chat']:4d}  {r['plan']:4d} |"
                  f" {r['cumulative_users']:9d} {r['cumulative_chats']:9d} {r['cumulative_plans']:9d}")


if __name__ == "__main__":
    main()
