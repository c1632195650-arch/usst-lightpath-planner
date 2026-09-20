# -*- coding: utf-8 -*-
"""
梨宝 · 事实探针（KB-grounded fact probing）—— 2026-09-16 转正进仓库
================================================================
解决的问题是：**手写测试永远问不完，也没法判「答案是不是事实」。**

思路：不靠人想问题，让**知识库自己出题、自己当裁判**——
  · 真值来源 A：`data/campus_map.json`（147 地点的结构化字段）→ 存在性事实
  · 真值来源 B：`data/usst_articles.db`（520 篇公众号文章的核心速查块）→ 数值事实

每个探针 = (问题, 真值, 证据串, 判分类型)。问 `/api/chat` 后用**规则判分**
（不用 LLM 裁判，保证可复现、可进 CI），重点抓四类错误：

  否定幻觉  库里**有**，它说没有          ←「学校有没有麦当劳」就是这种，最危险
  伪造幻觉  库里**没有**，它给出具体位置
  拒答      库里有，它说不知道（比瞎编好，单独统计）
  措辞翻转  同一事实换种问法答案就变（麦当劳案例的另一种形态）

⚠️ 每个探针用**全新 session_id**：否则上一轮问过的空间问题会通过
   `api_chat` 的「最近 6 轮回退」把空间意图借给这一轮，测出来的是假象。

用法：
  python scripts/fact_probe.py                     # 全量跑（约 2 分钟，需活后端）
  python scripts/fact_probe.py --base http://127.0.0.1:8013
  python scripts/fact_probe.py --kinds 存在性·品牌,存在性·否定   # 只跑部分维度
  python scripts/fact_probe.py --gate              # CI 门禁：出现否定/伪造幻觉 exit 1
"""
import argparse, json, os, re, sqlite3, sys, time, urllib.parse, urllib.request
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")
os.environ["NO_PROXY"] = "127.0.0.1,localhost"
os.environ["no_proxy"] = "127.0.0.1,localhost"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 判分正则 = 2026-09-16 修正版（教训记在 _fact_rejudge.py 头注）：
#   1. NEG 排除「没有精确数据/没提」这类**非存在性否定**，否则答对的题被误判摇摆
#   2. SOFT 收录梨宝的诚实兜底话术（不敢瞎编/不敢打包票）
#   3. `没开` 只在**不是「现在没开」**时算否定 —— L0 模板答会如实播报营业状态
#      （「…（现在没开：下一个时段「早餐」06:30 开始）」），那是**营业时间事实**，
#      不是「学校没有这个地方」。不加这个环视，模板答会被整批误判成「摇摆」。
NEG = re.compile(r"(没有(?!(?:精确|数据|细节|具体|明确|说|提|一|任|查))|没得|无此|查无|并没有|"
                 r"好像没有|应该没有|(?<!现在)(?<!还)没开|没设|没这|没有这家|没有这个|不存在)")
SOFT = re.compile(r"(不确定|不知道|没查到|没找到|没听说过|没听过|不清楚|翻遍|不敢瞎编|不敢打包票)")
LOC = re.compile(r"(在|位于|就在|开在|设在|走).{0,12}(楼|层|食堂|超市|店|驿站|隔壁|旁边|门口|路|号|侧|区)")


def judge(probe, ans):
    a = ans or ""
    truth = probe["truth"]
    ev = any(e in a for e in probe["evidence"]) if probe["evidence"] else False
    neg = bool(NEG.search(a))
    soft = bool(SOFT.search(a))

    if truth is True:                      # 库里有
        if ev and not neg:
            return "对", "命中证据串且无否定"
        if ev and neg:
            return "摇摆", "既提到又出现否定表述"
        if neg and not ev:
            return "否定幻觉", "库里有却说没有"
        if soft and not ev:
            return "拒答", "库里有但答不知道（比瞎编好）"
        return "含糊", "未命中证据也未明确否定"
    if truth is False:                     # 库里没有
        if neg or soft:
            return "对", "如实说没有/不确定"
        if LOC.search(a):
            return "伪造幻觉", "库里没有却给出了位置"
        return "含糊", "未明确否定也未编造"
    # 数值事实：truth 是字符串（期望值）—— 第一版 bug 就栽在这：字符串真值
    # 掉进「库里没有」分支，全判含糊（其实答对了）。
    return ("对", "命中真值") if ev else ("错", "答案未包含真值")


def jget(base, path):
    with urllib.request.urlopen(base + path, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def jpost(base, path, obj, timeout=90):
    req = urllib.request.Request(base + path, data=json.dumps(obj).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


# ---------------------------------------------------------------- 探针构建
def build_probes():
    cm = json.load(open(os.path.join(ROOT, "data/campus_map.json"), encoding="utf-8"))
    pois = cm["pois"]
    probes = []          # (qid, kind, question, truth, evidence, note)

    # A1 存在性 · 肯定样本：26 个 poi 本名
    for p in pois:
        ev = [p["name"]] + list(p.get("alias") or [])
        probes.append({"kind": "存在性·肯定", "q": f"学校有没有{p['name']}",
                       "truth": True, "evidence": ev, "note": p.get("type", "")})

    # A2 存在性 · 措辞翻转子集（同一事实换种问法，测「措辞敏感度」）
    flip = ["第二食堂", "菜鸟驿站", "红塔打印", "全家便利店", "1906咖啡厅", "校医室（卫生科）",
            "第五食堂", "农业银行ATM"]
    for name in flip:
        p = next(x for x in pois if x["name"] == name)
        ev = [p["name"]] + list(p.get("alias") or [])
        probes.append({"kind": "存在性·翻转", "q": f"学校里有{name}吗", "truth": True,
                       "evidence": ev, "note": p.get("type", "")})

    # A3 存在性 · 品牌嵌在 features 里的（麦当劳案例本体 + 品牌反向索引回归样例）
    for brand, holder in [("麦当劳", "第二食堂"), ("全家", "全家便利店"), ("1906", "1906咖啡厅"),
                          ("瑞幸", "思餐厅"), ("蜜雪冰城", "思餐厅"), ("一点点", "思餐厅"),
                          ("肯德基", "思餐厅"), ("库迪", "第五食堂"), ("七分甜", "第五食堂"),
                          ("继光香香鸡", "第一食堂"), ("苹果花园", "思餐厅")]:
        probes.append({"kind": "存在性·品牌", "q": f"学校有没有{brand}", "truth": True,
                       "evidence": [holder, holder.replace("（", "").replace("）", "")],
                       "note": f"嵌在「{holder}」的数据里，靠品牌反向索引召回"})

    # A4 存在性 · 否定样本：常被问、但图谱里确实没有
    # 2026-09-19 数据更新：瑞幸/肯德基/库迪/蜜雪冰城 已入驻（思餐厅/五食堂），转入 A3 正例；
    # absent 保留图谱与语料确证不存在的品牌。
    absent = ["星巴克", "喜茶", "必胜客", "海底捞", "罗森", "711便利店"]
    for b in absent:
        probes.append({"kind": "存在性·否定", "q": f"学校有没有{b}", "truth": False,
                       "evidence": [], "note": "图谱与语料均无"})

    # B 数值事实：从 ★ 核心速查块抽 label：value（规则过滤掉明显不是事实标签的）
    bad = re.compile(r"(执行|规定|如下|以上|以下|共计|其中)")
    val_re = re.compile(r"([\u4e00-\u9fffA-Za-z0-9]{2,10})[:：]\s*"
                        r"(\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日|\d+(?:\.\d+)?[万元分天]+)")
    seen = set()
    c = sqlite3.connect(os.path.join(ROOT, "data/usst_articles.db"))
    for title, ft in c.execute(
            "SELECT title,full_text FROM articles WHERE is_dup=0 AND full_text LIKE '%★%'").fetchall():
        for m in val_re.finditer(ft[:1500]):
            label, val = m.group(1), m.group(2)
            if bad.search(label) or label in seen:
                continue
            seen.add(label)
            core = re.sub(r"[年月日]", "", val)
            if re.fullmatch(r"\d{4}", core):      # 只有年份的问题太泛，跳过
                continue
            if re.search(r"[万元]", val):
                q = f"咱们学校的{label}是多少钱？"
            else:
                q = f"咱们学校{label}是什么时候？"
            probes.append({"kind": "数值事实", "q": q, "truth": val,
                           "evidence": [core, val], "note": title[:24]})
    c.close()
    return probes


def main():
    ap = argparse.ArgumentParser(description="梨宝事实探针：KB 出题、对库判分")
    ap.add_argument("--base", default=os.environ.get("LIBAO_BASE", "http://127.0.0.1:8000"))
    ap.add_argument("--kinds", default="", help="逗号分隔，只跑这些维度")
    ap.add_argument("--gate", action="store_true",
                    help="CI 门禁：存在性维度出现否定/伪造幻觉 → exit 1")
    ap.add_argument("--quiet", action="store_true", help="不逐条打印")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    probes = build_probes()
    if args.kinds:
        want = {k.strip() for k in args.kinds.split(",") if k.strip()}
        probes = [p for p in probes if p["kind"] in want]
    run = time.strftime("%H%M%S")
    out_json = os.path.join(ROOT, "outputs", f"fact_probe_{run}.json")
    out_md = os.path.join(ROOT, "outputs", f"fact_probe_{run}.md")

    print(f"后端 {base}｜探针 {len(probes)} 条"
          f"（{Counter(p['kind'] for p in probes)}）")
    try:
        h = jget(base, "/api/health")
        print(f"健康：llm={h.get('llm')} 阈值={h.get('thresholds')}\n")
    except Exception as e:
        print("❌ 后端没起来：", e)
        return 2

    results, t0 = [], time.time()
    for i, p in enumerate(probes, 1):
        sid = f"s-probe-{i}-{run}"          # 每条独立会话，杜绝串味
        rec = dict(p)
        try:
            d = jpost(base, "/api/chat", {"q": p["q"], "user_id": "u-factprobe", "session_id": sid})
            rec.update({
                "answer": d.get("answer", ""),
                "route": d.get("route"), "intent": d.get("intent"),
                "raw_vec": d.get("top_raw_vec"), "used_space": d.get("used_space"),
                "mode": d.get("mode"), "rid": d.get("request_id"),
                "titles": [s["title"] for s in d.get("sources", [])][:3],
            })
        except Exception as e:
            rec.update({"answer": "", "error": str(e), "verdict": "请求失败", "why": str(e)})
        else:
            v, why = judge(p, rec["answer"])
            rec.update({"verdict": v, "why": why})
        results.append(rec)
        if not args.quiet:
            v = rec.get("verdict", "?")
            mark = {"对": "✅", "否定幻觉": "🔴", "伪造幻觉": "🔴", "拒答": "🟡",
                    "摇摆": "🟠", "含糊": "⚪", "请求失败": "❌"}.get(v, "·")
            print(f"  [{i:>2}/{len(probes)}] {mark} {v:<5} | {p['q']}")

    os.makedirs(os.path.dirname(out_json), exist_ok=True)
    json.dump({"base": base, "ts": run, "results": results},
              open(out_json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # ---- 汇总 ----
    cnt = Counter(r.get("verdict", "请求失败") for r in results)
    n = len(results)
    print("\n" + "=" * 78)
    print("按判分汇总")
    print("=" * 78)
    for k, v in cnt.most_common():
        print(f"  {k:<6} {v:>3}  ({v / n * 100:.0f}%)")

    print("\n按维度汇总（只有两类存在性探针能测出幻觉）")
    print("=" * 78)
    for kind in sorted({p["kind"] for p in probes}):
        sub = [r for r in results if r["kind"] == kind]
        cc = Counter(r.get("verdict", "请求失败") for r in sub)
        line = "  ".join(f"{k}{v}" for k, v in cc.most_common())
        print(f"  {kind:<10} n={len(sub):<3} {line}")
    print(f"\n耗时 {time.time() - t0:.0f}s｜明细: {out_json}")

    # ---- Markdown 报告（只列错的）----
    lines = ["# 梨宝 · 事实探针报告", "",
             f"- 后端 `{base}`｜探针 {n} 条｜判分=规则（可复现）", "",
             "## 汇总", ""]
    for k, v in cnt.most_common():
        lines.append(f"- **{k}**：{v}（{v / n * 100:.0f}%）")
    lines += ["", "## 全部非「对」的探针（按严重度）", ""]
    order = {"否定幻觉": 0, "伪造幻觉": 1, "摇摆": 2, "含糊": 3, "拒答": 4, "请求失败": 5}
    bad = sorted([r for r in results if r.get("verdict") != "对"],
                 key=lambda r: order.get(r.get("verdict"), 9))
    for r in bad:
        lines.append(f"### 🔴 {r.get('verdict')}｜{r['q']}")
        lines.append(f"- 真值：{'有' if r['truth'] is True else ('没有（图谱与语料均无）' if r['truth'] is False else r['truth'])}"
                     f"｜证据串：{r['evidence'] or '—'}")
        lines.append(f"- 路由 `{r.get('route')}`｜raw_vec `{r.get('raw_vec')}`｜"
                     f"空间注入 `{r.get('used_space')}`｜命中：{r.get('titles')}")
        a = (r.get("answer") or "").replace("\n", " ")
        lines.append(f"- **答**：{a[:220]}")
        lines.append("")
    open(out_md, "w", encoding="utf-8").write("\n".join(lines))
    print(f"报告: {out_md}")

    # ---- CI 门禁 ----
    if args.gate:
        fatal = [r for r in results
                 if r["kind"].startswith("存在性")
                 and r.get("verdict") in ("否定幻觉", "伪造幻觉", "请求失败")]
        if fatal:
            print(f"\n🚫 GATE 失败：{len(fatal)} 条存在性幻觉/失败")
            for r in fatal:
                print(f"   🔴 {r['q']} → {r.get('verdict')}")
            return 1
        print("\n✅ GATE 通过：存在性维度零幻觉")
    return 0


if __name__ == "__main__":
    sys.exit(main())
