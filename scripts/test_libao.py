# -*- coding: utf-8 -*-
"""
梨宝 · 多轮多维度新生提问测试
================================
用法（需先启动后端 python server/app.py）：
    python scripts/test_libao.py
    python scripts/test_libao.py --only A      # 只跑某一组
输出：控制台 + docs/test-report-libao.md
"""
import os, sys, json, time, argparse, datetime
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# 本机回环不走代理：否则 requests 会拿 HTTP_PROXY 去访问 127.0.0.1 而超时
os.environ["NO_PROXY"] = "127.0.0.1,localhost"
os.environ["no_proxy"] = "127.0.0.1,localhost"

import requests

API = "http://127.0.0.1:8000"
CHAT = API + "/api/chat"

# 每组：user_id 相同=跨会话共享长期画像；session_id 相同=同一段对话
GROUPS = [
    {
        "id": "A",
        "name": "A 组 · 四六级：事实 → 追问题型 → 个性化备考（用户点名的链路）",
        "user": "u_a", "sid": "s_a",
        "turns": [
            {"q": "宝子，四六级什么时候开始报名啊？", "expect": ["grounded", "hybrid"], "note": "知识库有报名通知 → 应走 RAG"},
            {"q": "那四六级究竟有哪些题型啊？", "expect": ["hybrid", "llm"], "note": "题型不在知识库 → 应切 LLM 补常识"},
            {"q": "我该怎么准备？", "expect": ["hybrid", "llm"], "note": "方法类 + 需承接上文四六级"},
            {"q": "我英语基础不太好，来得及吗？", "expect": ["hybrid", "llm"], "note": "情绪 + 记忆（应记得在聊四六级、且基础弱）"},
        ],
    },
    {
        "id": "B",
        "name": "B 组 · 课表 + 校园空间：三教下课去哪吃（差异化核心场景）",
        "user": "u_b", "sid": "s_b",
        "turns": [
            {"q": "我上午有两节课，一节C语言，一节高等数学", "expect": ["hybrid", "llm", "grounded"], "note": "应抽出课程进长期画像"},
            {"q": "高数在三教上，C语言在一教", "expect": ["hybrid", "llm", "grounded"], "note": "空间信息入画像"},
            {"q": "高数下课了饿死了，三教附近有啥近的食堂或者便利店吗？", "expect": ["hybrid"], "note": "空间查询：三教已有官方路段数据（海远中路沿线=第一食堂），应给出精确推荐"},
            {"q": "那二食堂有啥推荐菜吗？", "expect": ["hybrid"], "note": "应给出真实招牌菜（肉糜蒸蛋/虎皮尖椒）"},
            {"q": "我下节课快开始了，哪个最快？", "expect": ["hybrid"], "note": "应记得前面在吃饭、且要赶时间 → 打包窗口"},
        ],
    },
    {
        "id": "F",
        "name": "F 组 · 空间维度扩展：自习/打印/快递/场馆（新图谱覆盖抽查）",
        "user": "u_f", "sid": "s_f",
        "turns": [
            {"q": "学校哪里可以自习？我早起背单词", "expect": ["hybrid", "llm"], "note": "湛恩纪念图书馆 7:00 开门，应比总馆早"},
            {"q": "一教下课去哪吃最快？", "expect": ["hybrid"], "note": "官方：二食堂离一教最近，3分钟+打包窗口"},
            {"q": "快递取了去哪拿？", "expect": ["hybrid", "llm"], "note": "菜鸟驿站近二公寓"},
            {"q": "我在南校区上课，那边有食堂吗？", "expect": ["hybrid", "llm"], "note": "思餐厅/第四/第六/清真食堂"},
            {"q": "从本部怎么去334校区？", "expect": ["hybrid", "llm"], "note": "海安路人行天桥连接两校区"},
        ],
    },
    {
        "id": "C",
        "name": "C 组 · 长期画像跨会话留存（换 session 不换 user）",
        "user": "u_c", "sid": "s_c1",
        "turns": [
            {"q": "我是光电学院大一新生", "expect": ["hybrid", "llm", "grounded"], "note": "抽画像：学院+年级"},
            {"q": "我高数有点听不懂，有点慌", "expect": ["hybrid", "llm"], "note": "抽画像：弱项"},
        ],
    },
    {
        "id": "C2",
        "name": "C2 组 · 同用户换一段新对话，验证长期记忆还在不在",
        "user": "u_c", "sid": "s_c2",
        "turns": [
            {"q": "帮我规划下这周怎么学吧", "expect": ["hybrid", "llm"], "note": "应记得：大一/光电/高数弱 → 个性化建议"},
        ],
    },
    {
        "id": "D",
        "name": "D 组 · 知识库覆盖度抽查（全面测试对上理的了解）",
        "user": "u_d", "sid": "s_d",
        "turns": [
            {"q": "奖学金怎么申请？", "expect": ["grounded", "hybrid"], "note": "学生处通知 + 学生手册"},
            {"q": "体测什么时候测？不及格怎么办？", "expect": ["grounded", "hybrid"], "note": "体育部"},
            {"q": "今年什么时候放寒假？", "expect": ["grounded", "hybrid"], "note": "校历"},
            {"q": "心理咨询怎么预约？", "expect": ["grounded", "hybrid"], "note": "学生处心理中心"},
            {"q": "重修怎么报名？", "expect": ["grounded", "hybrid"], "note": "教务处"},
        ],
    },
    {
        "id": "E",
        "name": "E 组 · 边界外与兜底（不该硬编）",
        "user": "u_e", "sid": "s_e",
        "turns": [
            {"q": "我失恋了，怎么办", "expect": ["llm", "hybrid"], "note": "完全边界外 → 应声明非官方、给情绪价值"},
            {"q": "上理哪个专业就业最好？", "expect": ["hybrid", "llm"], "note": "涉及判断 → 应谨慎、建议查官方就业报告"},
            {"q": "食堂阿姨手抖吗", "expect": ["hybrid", "llm"], "note": "趣味问题，接梗"},
        ],
    },
]


def chat(q, sid, uid, timeout=90):
    r = requests.post(CHAT, json={"q": q, "session_id": sid, "user_id": uid}, timeout=timeout)
    r.raise_for_status()
    return r.json()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="只跑指定组，如 A 或 A,B")
    args = ap.parse_args()
    only = [x.strip().upper() for x in args.only.split(",") if x.strip()]

    try:
        h = requests.get(API + "/api/health", timeout=8).json()
    except Exception as e:
        print("❌ 后端没起来。请先运行：python server/app.py\n  错误：", e)
        return 1
    print(f"后端 OK：llm={h.get('llm')} model={h.get('model')} 阈值={h.get('thresholds')}\n")

    results = []
    t0 = time.time()
    for g in GROUPS:
        if only and g["id"] not in only:
            continue
        print("=" * 72)
        print(f"{g['name']}")
        print("=" * 72)
        for i, t in enumerate(g["turns"], 1):
            try:
                res = chat(t["q"], g["sid"], g["user"])
            except Exception as e:
                print(f"  Q{i}: {t['q']}\n   ❌ 请求失败：{e}")
                continue
            route = res.get("route", "?")
            ok = route in t["expect"]
            rec = {
                "group": g["id"], "q": t["q"], "route": route,
                "expect": t["expect"], "ok": ok,
                "raw": res.get("top_raw_vec"), "intent": res.get("intent"),
                "space": res.get("used_space"), "mem": res.get("used_memory"),
                "mode": res.get("mode"), "note": t["note"],
                "answer": res.get("answer", ""),
                "titles": [s["title"] for s in res.get("sources", [])][:3],
            }
            results.append(rec)
            flag = "✅" if ok else "⚠️"
            print(f"\n  Q{i}: {t['q']}")
            print(f"   {flag} route={route} (期望{t['expect']}) | raw_vec={rec['raw']} "
                  f"| intent={rec['intent']} | 空间={rec['space']} 记忆={rec['mem']}")
            print(f"   命中: {rec['titles']}")
            print(f"   梨宝: {rec['answer'][:220].replace(chr(10), ' ')}")
            time.sleep(0.3)
        print()

    # ---- 汇总 ----
    total = len(results)
    passed = sum(1 for r in results if r["ok"])
    from collections import Counter
    dist = Counter(r["route"] for r in results)
    print("=" * 72)
    print(f"汇总：{passed}/{total} 轮路由符合预期（{passed/total*100 if total else 0:.0f}%）")
    print(f"路由分布：{dict(dist)}")
    print(f"耗时 {time.time()-t0:.1f}s")

    # ---- 报告 ----
    out = os.path.join(os.path.dirname(__file__), "..", "docs", "test-report-libao.md")
    lines = [
        "# 梨宝多轮测试报告", "",
        f"> 生成时间：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M')} ｜ "
        f"后端 llm={h.get('llm')} model={h.get('model')}", "",
        f"**路由符合预期：{passed}/{total}（{passed/total*100 if total else 0:.0f}%）** ｜ 分布：{dict(dist)}", "",
    ]
    cur = None
    for r in results:
        if r["group"] != cur:
            cur = r["group"]
            lines += ["", f"## {cur} 组", ""]
        flag = "✅" if r["ok"] else "⚠️"
        lines += [
            f"**Q：{r['q']}**  {flag}",
            "",
            f"- 路由：`{r['route']}`（期望 {r['expect']}）｜ raw_vec={r['raw']} ｜ "
            f"意图={r['intent']} ｜ 用空间={r['space']} ｜ 用记忆={r['mem']}",
            f"- 命中的文章：{r['titles']}",
            f"- 测试点：{r['note']}",
            "",
            "```",
            r["answer"][:600],
            "```",
            "",
        ]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"\n报告已写入：{os.path.abspath(out)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
