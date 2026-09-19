# -*- coding: utf-8 -*-
"""
上理校园空间图谱 · 分区正确性测试
====================================
对 campus_map.json 的「建筑 → 校区」判断做逐条断言。

期望值来源（可溯源，非推测）：
  [AED] 后勤管理处《自动除颤仪（AED）》配置表
        —— 官方明确写出「北校区/南校区 XXX」，共 19 处点位
  [宿舍] 公众号「上理小喇叭」宿舍指南 —— 「01 本部北校区 / 02 本部南校区」分组
  [编号] 公众号「上理指南」校园地图 —— 1-121 号 POI 编号表（北校 1-87 / 南校 88-121）
  [道路] 官网《军工路校区道路名称》17 条路段
  [核实] 数据库内官方通知（教学楼关闭通知等）

分区口径：
  北校区 = 军工路 516 号（主校区）   南校区 = 军工路 334 号
  两者合称「本部」，由海安路人行天桥连接。
"""
import os, sys, json, re

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "server"))
import campus  # noqa: E402

# ---------------------------------------------------------------- 期望表
# (查询词, 期望校区, 来源标签)
CASES = [
    # ===== A. 北校区（516）—— 官方 AED 表逐条列出 =====
    ("先进制造大楼", "北校", "AED"),
    ("第一教学楼", "北校", "AED"),
    ("第三教学楼", "北校", "AED"),
    ("第五教学楼", "北校", "AED"),
    ("综合楼", "北校", "AED"),
    ("图文信息中心", "北校", "AED"),
    ("第五食堂", "北校", "AED"),
    ("第一浴室", "北校", "AED"),
    ("第二学生公寓", "北校", "AED"),
    ("第四学生公寓", "北校", "AED"),
    ("校医室", "北校", "AED"),
    ("大操场", "北校", "AED"),
    # 宿舍指南「01 本部北校区」
    ("第一学生公寓", "北校", "宿舍"),
    ("第三学生公寓", "北校", "宿舍"),
    ("北校区第五宿舍", "北校", "宿舍"),
    ("北校区第八宿舍", "北校", "宿舍"),
    ("第十二宿舍", "北校", "宿舍"),
    # 编号表（北校 1-87）
    ("光电楼", "北校", "编号"),
    ("机械楼", "北校", "编号"),
    ("环建楼", "北校", "编号"),
    ("第一食堂", "北校", "编号"),
    ("第二食堂", "北校", "编号"),
    ("第九宿舍", "北校", "编号"),
    ("第十宿舍", "北校", "编号"),
    ("格致堂", "北校", "编号"),
    ("大礼堂", "北校", "编号"),
    ("校史馆", "北校", "编号"),
    ("暖屋超市", "北校", "编号"),
    ("菜鸟驿站", "北校", "编号"),
    ("红塔打印", "北校", "编号"),

    # ===== B. 南校区（334）—— 官方 AED 表 =====
    ("卓越楼", "南校", "AED"),
    ("逸兴楼", "南校", "AED"),
    ("思餐厅", "南校", "AED"),
    # 宿舍指南「02 本部南校区」
    ("第五学生公寓", "南校", "宿舍"),
    ("第六学生公寓", "南校", "宿舍"),
    ("南校区第一宿舍", "南校", "宿舍"),
    ("南校区第二宿舍", "南校", "宿舍"),
    ("南校区第三宿舍", "南校", "宿舍"),
    # 编号表（南校 88-121）
    ("国合楼", "南校", "编号"),
    ("管理学院大楼", "南校", "编号"),
    ("南校区图书馆", "南校", "编号"),
    ("理学院楼", "南校", "编号"),
    ("外语楼", "南校", "编号"),
    ("第六食堂", "南校", "编号"),
    ("南校区教育超市", "南校", "编号"),
    ("南校区红塔打印", "南校", "编号"),
    ("南校区第四宿舍", "南校", "洗浴"),
    ("南校区第五宿舍", "南校", "洗浴"),

    # ===== D. 北校区南缘：二公寓（「上理指南」编号表误列入南校区 88，实为 516）=====
    ("二公寓", "北校", "洗浴"),
    ("第二学生公寓", "北校", "洗浴"),
    # 商超：全家（商业连锁）≠ 教育超市（学校自营，卖文具）—— 两店不可混（CY 实地指认）
    ("全家", "北校", "商超"),
    ("教育超市", "南校", "商超"),

    # ===== E. 独立校区（不参与本部排程）=====
    ("申一教", "1100", "编号"),
    ("申二教", "1100", "编号"),
    ("1100图书馆", "1100", "编号"),
    ("民族餐厅（580号）", "580", "编号"),
]

# 同名宿舍：南北必须分开，不能互相污染
HOMONYM = [
    ("北校区第五宿舍", "北校"),
    ("南校区第五宿舍", "南校"),
    ("第五学生公寓", "南校"),
    ("第九宿舍", "北校"),
    ("南校区第九宿舍", "南校"),
    ("第十宿舍", "北校"),
    ("南校区第十宿舍", "南校"),
    ("不存在的建筑XYZ", None),   # 反例：确认不会乱匹配
]

# 跨区通行（2026-09-11 起「北校↔南校」改用 OSM 路网实算，分钟数改为区间断言）
CROSS = [
    ("第一教学楼", "国合楼", True, 8, 18),
    ("第三教学楼", "思餐厅", True, 10, 22),
    ("逸兴楼", "卓越楼", False, 0, 0),
    ("第一教学楼", "第二食堂", False, 0, 0),
    ("申一教", "第一教学楼", True, None, None),   # 1100↔本部：跨区但无通行分钟（不参与本部排程）
]

# ==================== 2026-09-15 新增（知识层 / 就近推荐 / 坐标不外泄）====================

# 口语同义词（tags 层）：官方名与别名都命中不了时，靠这层让「说人话」也能查到。
# 期望值 = 检索首位。tags 由**本项目自行整理**（未采用任何第三方站点词表）。
TAGS = [
    ("图文", "图书馆（图文信息中心）"),
    ("占座", "图书馆（图文信息中心）"),
    ("取快递", "菜鸟驿站"),
    ("寄快递", "菜鸟驿站"),
    ("看病", "校医室（卫生科）"),
    ("取钱", "农业银行ATM"),
    ("大活", "学生活动中心"),
    ("水母楼", "水母楼"),
    ("打印成绩单", "水母楼"),
    ("补办校园卡", "学生卡卡务中心"),
    ("心理咨询", "心理健康中心"),
    ("金工实习", "实训中心"),
    ("体测", "运动场"),
    ("洗澡", "第一浴室"),
    ("咖啡", "1906咖啡厅"),
    ("吃饭", "第一食堂"),
]

# 泛类别词（打印/食堂…）刻意**不塞进 tags**，由 type 承担 —— 首位必须落在对应类别里
TAG_KINDS = [
    ("打印", {"打印"}),
    ("吃饭", {"食堂", "餐厅", "烘焙/饮品"}),
]

# 营业时间：把字符串变成「此刻开不开」的可判断事实。
# 模糊表述（「常规饭点」「长时（以现场为准）」）一律返回 open=None —— 不猜。
OPENNESS = [
    ("第一食堂", "2026-09-15 12:10", True),      # 周二午餐时段
    ("第一食堂", "2026-09-19 12:10", False),     # 周六休息（closed 字段）
    ("第一食堂", "2026-09-15 23:30", False),     # 收档后（应给出下一个时段）
    ("图书馆（图文信息中心）", "2026-09-15 12:10", True),
    ("全家便利店", "2026-09-15 23:30", True),     # 24 小时店
    # 2026-09-16 起：卫生科补上官方门诊时间（此前无 hours，只能如实答「未知」）
    ("校医室（卫生科）", "2026-09-15 12:10", True),    # 周二：门诊（周一至周五）8:00-18:00
    ("校医室（卫生科）", "2026-09-19 12:10", False),   # 周六 12:10：只有 9:00-11:30 / 13:00-15:00
    ("校医室（卫生科）", "2026-09-19 10:00", True),    # 周六上午：落在双休日时段里
    # 标签里带星期的时段，2026-09-16 起才真正生效（此前 open_now 忽略标签里的星期 → 周六晚错答「开着」）
    ("1100图书馆", "2026-09-19 20:00", False),    # 周六 16:45 就关
    ("1100图书馆", "2026-09-16 20:00", True),     # 周三开到 21:45
    ("思餐厅", "2026-09-15 12:10", None),        # 「常规饭点」= 模糊表述，不猜
]

# 可步行分组：本部 = 北校(516) + 南校(334) + 580；1100 / 复兴路 为独立分组。
# 独立校区的地点**不得**出现在本部的就近推荐里。
_WALK_GROUPS = {"北校": "本部", "南校": "本部", "580": "本部", "连接": "本部"}

# 坐标字段名（任何对外接口的响应体都不许出现）
_COORD_KEYS = re.compile(r'"(lat|lon|lng|latitude|longitude|coord|coordinates)"\s*:', re.I)

# ---- 拼音检索（索引由 scripts/build_pinyin_index.py 离线生成，运行时零依赖）----
# 期望值 = 检索首位。分值分层：名字拼音 68 > 口语词拼音 62 > 类型拼音 48。
PINYIN = [
    ("tushuguan", "图书馆（图文信息中心）"),   # 全拼整段相等
    ("sanjiao", "第三教学楼"),                # 别名『三教』的全拼（**不是**靠子串命中主名）
    ("shuimulou", "水母楼"),
    ("diyishitang", "第一食堂"),
    ("cainiaoyizhan", "菜鸟驿站"),
    ("tsg", "图书馆（图文信息中心）"),          # 首字母缩写
    ("dahuo", "学生活动中心"),                # 口语同义词（tags）的拼音
    ("qukuaidi", "菜鸟驿站"),
    ("quqian", "农业银行ATM"),
]
# 前缀（拼音还没打完）—— 最常见的输入中间态
PINYIN_PREFIX = [
    ("tushu", "图书馆（图文信息中心）"),
    ("cainiao", "菜鸟驿站"),
]
# 类别词拼音 → 结果必须落在对应类别里
PINYIN_KINDS = [
    ("shitang", {"食堂", "餐厅"}),
    ("jiaoxuelou", {"教学楼"}),
    ("zixidian", {"自习点"}),
]
# 噪声守卫：1 个字符、或者根本不存在 → 必须**一条都不返回**。
# 「a」「y」曾顺着拉丁字母别名 Familymart 命中『全家』（单字符不该匹配任何东西）。
PINYIN_NOISE = ["a", "y", "d", "1", "zzzz", "qqq"]


def main():
    ok = fail = 0
    fails = []

    print("=" * 72)
    print("A/B/C 组 · 建筑 → 校区归属断言")
    print("=" * 72)
    for q, exp, src in CASES:
        got = campus.campus_of(q)
        mark = "✅" if got == exp else "❌"
        if got == exp:
            ok += 1
        else:
            fail += 1
            fails.append(f"{q}: 期望 {exp}，实际 {got}")
        print(f"  {mark} [{src:<2}] {q:<16} → {got}")

    print()
    print("=" * 72)
    print("D 组 · 同名宿舍不混淆")
    print("=" * 72)
    for q, exp in HOMONYM:
        p = campus.find_poi(q)
        got = p.get("campus") if p else None
        mark = "✅" if got == exp else "❌"
        if got == exp:
            ok += 1
        else:
            fail += 1
            fails.append(f"{q}: 期望 {exp}，实际 {got}（命中 {p.get('name') if p else '无'}）")
        hit = p.get("name") if p else "无"
        print(f"  {mark} {q:<18} → {got}  (命中: {hit})")

    print()
    print("=" * 72)
    print("E 组 · 跨校区判断（排程插缓冲块用）")
    print("=" * 72)
    for a, b, exp_cross, lo, hi in CROSS:
        r = campus.cross_campus(a, b)
        if lo is None:
            good = (r["is_cross"] == exp_cross) and (r["minutes"] is None)
        else:
            good = (r["is_cross"] == exp_cross) and (r["minutes"] is not None) and (lo <= r["minutes"] <= hi)
        mark = "✅" if good else "❌"
        if good:
            ok += 1
        else:
            fail += 1
            fails.append(f"{a}↔{b}: 期望 cross={exp_cross}/min={lo}~{hi}，实际 {r['is_cross']}/{r['minutes']}")
        print(f"  {mark} {a} ↔ {b}")
        print(f"      跨区={r['is_cross']} 分钟={r['minutes']} ｜ {r['note']}")

    print()
    print("=" * 72)
    print("F 组 · 端到端空间上下文（梨宝实际拿到的字符串）")
    print("=" * 72)
    for q in ["国合楼在哪个校区", "高数在三教下课饿了去哪吃", "五公寓附近有什么"]:
        ctx = campus.space_context(q)
        head = [l for l in ctx.split("\n") if l.strip()][:4]
        print(f"  ▸ {q}")
        for h in head:
            print(f"      {h}")
        print()

    print()
    print("=" * 72)
    print("G 组 · 路网寻路（OSM 派生·任意两点）")
    print("=" * 72)
    net = campus.network()
    if net:
        seen, comps = set(), 0
        for n in net.adj:
            if n in seen:
                continue
            comps += 1
            st = [n]
            seen.add(n)
            while st:
                x = st.pop()
                for y, _ in net.adj.get(x, ()):
                    if y not in seen:
                        seen.add(y)
                        st.append(y)
        good = comps == 1
        ok, fail = (ok + 1, fail) if good else (ok, fail + 1)
        if not good:
            fails.append(f"路网桥接后连通分量应为 1，实际 {comps}")
        print(f"  {'✅' if good else '❌'} 路网连通性：分量数 = {comps}")

        good = len(net.poi) >= 140
        ok, fail = (ok + 1, fail) if good else (ok, fail + 1)
        if not good:
            fails.append(f"POI 定位数应 ≥140，实际 {len(net.poi)}")
        print(f"  {'✅' if good else '❌'} POI 定位覆盖：{len(net.poi)}/{len(net.poi) + len(net.unlocated)}")

        ROUTE_CASES = [
            ("第三教学楼", "第五食堂", 200, 600),
            ("三教", "五食堂", 200, 600),
            ("南一宿舍", "清真餐厅", 50, 500),
            ("第四宿舍 (思伊堂)", "第五食堂", 200, 800),
            ("六公寓", "光电楼", 300, 1300),
        ]
        for a, b, lo, hi in ROUTE_CASES:
            r = campus.route(a, b)
            good = bool(r) and lo <= r["meters"] <= hi
            mark = "✅" if good else "❌"
            if good:
                ok += 1
            else:
                fail += 1
                fails.append(f"route({a},{b}): 期望 {lo}-{hi} 米，实际 {r['meters'] if r else None}")
            if r:
                print(f"  {mark} {a} → {b}: {r['meters']:.0f} 米 / {r['minutes']:.1f} 分钟"
                      f"  [{'可信' if r['reliable'] else '参考'}]")
            else:
                print(f"  {mark} {a} → {b}: 不可达")

        KPS = ["516号校门", "470号校门", "580号校门", "334号校门", "海安路人行天桥"]
        kp_ok = all(net.poi.get(k, (None, ""))[1] == "keypoint" for k in KPS)
        ok, fail = (ok + 1, fail) if kp_ok else (ok, fail + 1)
        if not kp_ok:
            fails.append("校门/天桥未使用 keypoint 坐标")
        print(f"  {'✅' if kp_ok else '❌'} 关键节点坐标（4 校门 + 天桥）来自人工核对")

        r = campus.route("第二学生公寓", "第五学生公寓")
        good = bool(r) and r["minutes"] >= 4
        ok, fail = (ok + 1, fail) if good else (ok, fail + 1)
        if not good:
            fails.append(f"跨区时间异常（疑似穿越校区）：{r['minutes'] if r else None}")
        print(f"  {'✅' if good else '❌'} 跨区不穿越校区：二公寓 → 五公寓 "
              + (f"{r['minutes']:.1f} 分钟" if r else "不可达"))

        # 多路径：最快不应慢于仅校内（两端吸附口径不一致时会出错）
        PAIRS = [("第一教学楼", "第三教学楼"), ("第三教学楼", "第五食堂"),
                 ("580号校门", "第一教学楼"), ("516号校门", "第三教学楼"),
                 ("第二学生公寓", "第五学生公寓")]
        bad = []
        for a, b in PAIRS:
            c = campus.compare_paths(a, b)
            if c and c["fastest"] and c["campus"] and \
               c["fastest"]["minutes"] > c["campus"]["minutes"] + 0.05:
                bad.append(f"{a}→{b}")
        good = not bad
        ok, fail = (ok + 1, fail) if good else (ok, fail + 1)
        if not good:
            fails.append("多路径自相矛盾（最快反而更慢）：" + "、".join(bad))
        print(f"  {'✅' if good else '❌'} 多路径不自相矛盾（最快 ≤ 仅校内）")

        c = campus.compare_paths("580号校门", "第一教学楼")
        good = bool(c) and c.get("outdoor_better") is True
        ok, fail = (ok + 1, fail) if good else (ok, fail + 1)
        if not good:
            fails.append("「580号校门→第一教学楼」应识别出走校外更快")
        extra = f"（省 {c['diff_minutes']:.1f} 分）" if (c and c.get("outdoor_better")) else ""
        print(f"  {'✅' if good else '❌'} 识别「走校外更快」：580号校门 → 第一教学楼{extra}")

    print()
    print("=" * 72)
    print("H 组 · 口语同义词检索（tags 层 · 说人话也能查到）")
    print("=" * 72)
    for q, exp in TAGS:
        res = campus.search_pois(q, limit=3)
        got = res[0]["name"] if res else None
        good = got == exp
        ok, fail = (ok + 1, fail) if good else (ok, fail + 1)
        if not good:
            fails.append(f"搜「{q}」首位应为 {exp}，实际 {got}")
        print(f"  {'✅' if good else '❌'} 搜「{q}」→ {got}")

    print()
    print("=" * 72)
    print("H2 组 · 泛类别词由 type 承担（不塞进 tags）")
    print("=" * 72)
    for q, kinds in TAG_KINDS:
        res = campus.search_pois(q, limit=5)
        good = bool(res) and res[0]["type"] in kinds
        ok, fail = (ok + 1, fail) if good else (ok, fail + 1)
        if not good:
            fails.append(f"搜「{q}」首位 type 应为 {kinds}，实际 {res[0]['type'] if res else None}")
        print(f"  {'✅' if good else '❌'} 搜「{q}」首位 type = {res[0]['type'] if res else '∅'}")

    print()
    print("=" * 72)
    print("I 组 · 营业时间可判断性（模糊表述一律不猜）")
    print("=" * 72)
    for name, at, exp in OPENNESS:
        p = campus.find_poi(name)
        st = campus.open_now(p, at) if p else {}
        got = st.get("open")
        good = (p is not None) and (got == exp)
        ok, fail = (ok + 1, fail) if good else (ok, fail + 1)
        if not good:
            fails.append(f"open_now({name}, {at}) 期望 open={exp}，实际 {got}")
        tag = {True: "开放", False: "不开放", None: "未知(不猜)"}.get(got, "?")
        print(f"  {'✅' if good else '❌'} {name} @ {at[11:]} → {tag} ｜ {st.get('reason', '')}")

    print()
    print("=" * 72)
    print("J 组 · 就近推荐（按步行分钟 · 校区隔离 · 不报假精度）")
    print("=" * 72)

    def _check_j(label, good, detail=""):
        nonlocal ok, fail
        ok, fail = (ok + 1, fail) if good else (ok, fail + 1)
        if not good:
            fails.append(f"{label}（{detail}）")
        print(f"  {'✅' if good else '❌'} {label}" + (f" ｜ {detail}" if detail else ""))

    near = campus.nearby_by_walk("第三教学楼", limit=8)
    ms = [x["minutes"] for x in near.get("results", [])]
    _check_j("按步行分钟升序", bool(ms) and ms == sorted(ms), str(ms))

    bad = [x["name"] for x in near.get("results", [])
           if _WALK_GROUPS.get(x.get("campus"), x.get("campus")) not in ("本部", None)]
    _check_j("不推荐独立校区（1100/复兴路）的地点", not bad, str(bad))

    _check_j("推荐结果不含经纬度字段",
             not _COORD_KEYS.search(json.dumps(near, ensure_ascii=False)))

    r1100 = campus.nearby_by_walk("申一教", limit=3)
    ok1100 = (r1100["walkable"] is True
              and bool(r1100.get("results"))
              and all(x.get("campus") == "1100" for x in r1100["results"]))
    _check_j("1100 起点就近推荐可用且全为 1100 地点（2026-09-16 起已定位）", ok1100,
             str([(x["name"], x.get("campus")) for x in r1100.get("results", [])]))

    _check_j("跨分组 route 返回 None（三教 → 1100教育超市）",
             campus.route("第三教学楼", "1100教育超市") is None)
    r12 = campus.route("申一教", "申二教")
    _check_j("1100 内部 route 可用（申一教 → 申二教，短距离）",
             bool(r12) and 0.3 <= r12["meters"] <= 400,
             f"{r12['meters'] if r12 else None} 米")

    r7 = campus.nearby_by_walk("七公寓", limit=6)
    _check_j("results 中不出现 null 分钟（不谎报 0.0）",
             bool(r7.get("results")) and all(x["minutes"] is not None for x in r7["results"]))
    _check_j("位置未细化的地点保留在 unrefined（不丢答案）",
             any(x["name"] == "民族餐厅（580号）" for x in r7.get("unrefined", [])))
    _check_j("unrefined 不占用 limit 名额", len(r7.get("results", [])) <= 6)

    rf = campus.nearby_by_walk("第三教学楼", limit=5, types=["食堂"])
    _check_j("type=食堂 过滤后结果全为食堂",
             bool(rf.get("results")) and all(x["type"] == "食堂" for x in rf["results"]),
             str([x["type"] for x in rf.get("results", [])]))

    print()
    print("=" * 72)
    print("K 组 · 对外投影不泄露坐标（决策 D4）")
    print("=" * 72)
    proj = json.dumps(campus.search_pois("吃饭", limit=5), ensure_ascii=False)
    _check_j("search_pois 对外投影无坐标字段", not _COORD_KEYS.search(proj))
    p1 = campus.find_poi("第一食堂") or {}
    _check_j("campus_map 本身不落坐标",
             not any(k in p1 for k in ("lat", "lon", "lng", "coord", "coordinates")))

    print()
    print("=" * 72)
    print("L 组 · 拼音检索（离线索引 · 运行时零依赖）")
    print("=" * 72)
    for q, exp in PINYIN:
        res = campus.search_pois(q, limit=3)
        got = res[0]["name"] if res else None
        _check_j(f"拼音「{q}」→ {got}", got == exp, "" if got == exp else f"期望 {exp}")

    for q, exp in PINYIN_PREFIX:
        res = campus.search_pois(q, limit=3)
        got = res[0]["name"] if res else None
        _check_j(f"拼音前缀「{q}」→ {got}", got == exp, "" if got == exp else f"期望 {exp}")

    for q, kinds in PINYIN_KINDS:
        res = campus.search_pois(q, limit=5)
        good = bool(res) and all(r["type"] in kinds for r in res)
        _check_j(f"类别拼音「{q}」全落在 {kinds}", good,
                 str([r["type"] for r in res]))

    bad = [q for q in PINYIN_NOISE if campus.search_pois(q, limit=3)]
    _check_j("单字符/无匹配拼音不返回任何结果（噪声守卫）", not bad, str(bad))

    _check_j("拼音检索结果同样不含经纬度字段",
             not _COORD_KEYS.search(json.dumps(campus.search_pois("tushuguan", limit=3), ensure_ascii=False)))

    print()
    print("M 组 · 品牌反向索引与存在性注入（2026-09-16 麦当劳修复）")
    print("=" * 72)

    # 意图判定：存在性问法不再依赖关键词表 —— 实体/品牌命中即算意图
    _check_j("「学校有没有麦当劳」触发空间意图（实体优先）",
             campus.has_space_intent("学校有没有麦当劳"))
    _check_j("「学校里有麦当劳吗？」触发空间意图（措辞翻转）",
             campus.has_space_intent("学校里有麦当劳吗？"))

    # 品牌反向索引：features/note 里的品牌词要能映射回 POI
    mcd = [p["name"] for p in campus.brand_pois("学校有没有麦当劳")]
    _check_j("「麦当劳」反查 → 第二食堂", "第二食堂" in mcd, str(mcd))
    fam = [p["name"] for p in campus.brand_pois("学校有没有全家")]
    _check_j("「全家」反查 → 全家便利店（品牌短名→POI全名）",
             fam and fam[0] == "全家便利店", str(fam))
    _check_j("「瑞幸/星巴克/肯德基」不在索引（真没有，负样本不误报）",
             not campus.brand_pois("学校有没有瑞幸")
             and not campus.brand_pois("学校有没有星巴克")
             and not campus.brand_pois("咱们学校有肯德基吗"))
    _check_j("否定语境不入索引（「非全家」不算全家）",
             not any(p["name"] == "南校区教育超市"
                     for p in campus.brand_pois("全家")))

    # 空间上下文：存在性事实块必须注入，且钉死「有 + 位置 + 证据」
    ctx = campus.space_context("学校有没有麦当劳")
    _check_j("space_context 注入存在性事实块", "存在性事实" in ctx)
    _check_j("存在性块含位置与营业时间证据",
             "第二食堂" in ctx and "6:30-22:00" in ctx, ctx[:60])
    _check_j("match_pois 纯净性保持（不带品牌层，排程/课表链路零变化）",
             not campus.match_pois("学校有没有麦当劳"))

    # search_pois：/api/poi 品牌前置 + 原排序补位 + 投影仍无坐标
    sr = campus.search_pois("麦当劳", limit=3)
    _check_j("search_pois「麦当劳」第 1 位是第二食堂",
             bool(sr) and sr[0]["name"] == "第二食堂", str([x["name"] for x in sr]))
    _check_j("search_pois 原检索行为不变（「吃饭」仍以食堂开头）",
             campus.search_pois("吃饭", limit=3)[0]["type"] == "食堂")
    _check_j("品牌检索投影无坐标字段",
             not _COORD_KEYS.search(json.dumps(sr, ensure_ascii=False)))

    print("=" * 72)
    print("N 组 · 1100 基础学院空间逻辑（2026-09-16 jichuxueyuan.osm 接入）")
    print("=" * 72)

    net_m = campus.network()
    # 1) 四个 1100 地点全部定位，且定位来源符合预期
    #    （申二教 = approx 近似锚点，未经实地核对 —— 要换成实地坐标请改
    #      data/osm/key_points.json 并把本断言一并更新）
    LOC_1100 = [("申一教", "osm"), ("1100图书馆", "osm"),
                ("1100教育超市", "osm"), ("申二教", "approx")]
    for name, exp_src in LOC_1100:
        src = net_m.poi.get(name, (None, ""))[1] if net_m else None
        _check_j(f"{name} 已定位（来源 {exp_src}）", src == exp_src, f"实际 {src}")

    # 2) 1100 内部路线合理（食堂楼与两教学楼都在校园核心区，步行几分钟内）
    for a, b, lo, hi in [("申一教", "1100图书馆", 50, 400),
                         ("1100教育超市", "1100图书馆", 20, 300),
                         ("申一教", "1100教育超市", 50, 400)]:
        r = campus.route(a, b)
        _check_j(f"1100 内部 route {a} → {b} ∈ {lo}~{hi} 米",
                 bool(r) and lo <= r["meters"] <= hi,
                 f"{r['meters'] if r else None} 米")

    # 3) 排程口径不变：本部 ↔ 1100 的 route() 仍为 None（不插转场分钟）
    _check_j("route 跨组仍为 None（第一教学楼 → 申一教）",
             campus.route("第一教学楼", "申一教") is None)

    # 4) 但路网确实连通：跨组步行参考 ≈ 沿军工路 1.2~2.6 km
    for a, b in [("第一教学楼", "申一教"), ("516号校门", "1100图书馆")]:
        r = campus.network().route_cross_group(a, b)
        _check_j(f"route_cross_group {a} → {b} ∈ 1200~2600 米",
                 bool(r) and 1200 <= r["meters"] <= 2600,
                 f"{r['meters'] if r else None} 米 / "
                 + (f"{r['minutes']:.0f} 分钟" if r else ""))

    # 5) cross_campus：is_cross=True / minutes=None（不进排程），note 带步行参考
    rc = campus.cross_campus("申一教", "第一教学楼")
    _check_j("cross_campus(申一教,一教)：跨区且不给排程分钟",
             rc["is_cross"] is True and rc["minutes"] is None,
             str(rc["note"])[:40])
    _check_j("cross_campus note 附带军工路步行参考",
             "军工路" in (rc.get("note") or ""),
             str(rc.get("note"))[:60])

    # 6) 防塌缩回归：五食堂贴着 1100 纬度分界线（31.2984 vs 分界 31.2986），
    #    分界取值一旦偏低就会被 1100 片区规则打回 → 塌缩到三教（曾实测 53 米假路线）
    src_wf = net_m.poi.get("第五食堂", (None, ""))[1] if net_m else None
    r35 = campus.route("第三教学楼", "第五食堂")
    _check_j("第五食堂定位来源仍为 osm（纬度分界未误伤）", src_wf == "osm", f"实际 {src_wf}")
    _check_j("三教 → 五食堂仍为正常路线（200~600 米）",
             bool(r35) and 200 <= r35["meters"] <= 600,
             f"{r35['meters'] if r35 else None} 米")

    # 7) 对外投影依然无坐标
    _check_j("1100 路线结果不含经纬度字段",
             not _COORD_KEYS.search(json.dumps(campus.route("申一教", "1100图书馆"), ensure_ascii=False)))

    print("=" * 72)
    print("O 组 · 重复条目合并 / 泛类别词 / OSM relation（2026-09-16 三轮评估落地）")
    print("=" * 72)

    m_all = campus.load_map()
    allp = m_all["pois"] + m_all["landmarks"]
    names = [p["name"] for p in allp]

    # 1) 合并掉两条重复、补 1 条缺项、再删 1 条 OSM 脏桩后 147 → 145
    #    （147 − 图书馆重复 − 卫生科重复 + 现代化教学中心 − (原第四食堂)）
    #    🔴 (原第四食堂) 是 OSM 自动导入的**括号残留名**，挂北校、verified:false。
    #       真第四食堂在 1100（三方证据已确认并已修）→ 留着它会让「北校有什么食堂」
    #       把学生引到一栋已不存在的食堂。删除见 scripts/audit_spatial_quality.py
    #       报出的 commission，并由 data/relative_bearing.json 一并重生成。
    _check_j("图谱条目数 = 145（147 − 2 重复 + 1 补录 − 1 脏桩）",
             len(allp) == 145, f"实际 {len(allp)}")
    _check_j("主名唯一（无同名重复条目）", len(names) == len(set(names)),
             f"{len(names)} → {len(set(names))}")

    # 2) 图书馆：『图文信息中心』与『湛恩纪念图书馆』是同一栋楼
    #    （校图书馆《历史沿革》：2007 年图书馆迁至图文信息中心；主馆即湛恩纪念图书馆）
    _check_j("find_poi(湛恩纪念图书馆) → 图书馆（图文信息中心）",
             (campus.find_poi("湛恩纪念图书馆") or {}).get("name") == "图书馆（图文信息中心）")
    _check_j("search_pois(湛恩纪念图书馆) 首位正确",
             bool(campus.search_pois("湛恩纪念图书馆", limit=3))
             and campus.search_pois("湛恩纪念图书馆", limit=3)[0]["name"] == "图书馆（图文信息中心）")
    # ↑ 下面两条是给 Ray 的 planner 兜底：templates.ts 的 place='湛恩纪念图书馆'
    #   与 golden 快照里的同名地点，合并后**必须仍然可解析、可寻路**。
    _check_j("network 别名解析：湛恩纪念图书馆 → 图书馆（图文信息中心）",
             campus.network().resolve("湛恩纪念图书馆") == "图书馆（图文信息中心）")
    _check_j("route(湛恩纪念图书馆 → 第五食堂) 仍可算（不打断 planner 模板）",
             bool(campus.route("湛恩纪念图书馆", "第五食堂")))
    _check_j("search_pois(tsg) 仍指图书馆（合并后拼音别名未乱）",
             bool(campus.search_pois("tsg", limit=1))
             and campus.search_pois("tsg", limit=1)[0]["name"] == "图书馆（图文信息中心）")

    # 3) 卫生科：北校只有一处（后勤管理处《校内就医》只列 516 / 1100 / 复兴路）
    _check_j("find_poi(医务室) → 校医室（卫生科）",
             (campus.find_poi("医务室") or {}).get("name") == "校医室（卫生科）")
    _check_j("find_poi(医务室（北校区）) 落到合并后的主条目",
             (campus.find_poi("医务室（北校区）") or {}).get("name") == "校医室（卫生科）")
    _check_j("南校那处不再占用『医务室』这个泛称",
             (campus.find_poi("医务室（334）") or {}).get("name") == "医务室（南校区）")
    _check_j("route(医务室 → 第三教学楼) 可算（重锚后仍属北校）",
             bool(campus.route("医务室", "第三教学楼")))
    _check_j("卫生科补上官方门诊时间（原为无 hours，属 P0 数据缺口）",
             bool((campus.find_poi("校医室（卫生科）") or {}).get("hours")),
             str((campus.find_poi("校医室（卫生科）") or {}).get("hours"))[:40])

    # 4) 定位来源不再是弱锚（R2 发现这两条曾与对方塌缩到同一点）
    net_o = campus.network()
    for n in ("图书馆（图文信息中心）", "校医室（卫生科）"):
        _check_j(f"{n} 定位来源为 osm（真实几何，非 zone/near_landmark 弱锚）",
                 net_o.poi.get(n, (None, ""))[1] == "osm",
                 f"实际 {net_o.poi.get(n, (None, ''))[1]}")

    # 5) OSM relation（multipolygon）：此前只读 node/way，整类建筑漏掉
    _check_j("OSM 建筑索引 ≥ 150（已含 relation 拼面的建筑）",
             len(net_o.bld) >= 150, f"实际 {len(net_o.bld)}")
    _check_j("relation 摘到的『湛恩纪念图书馆』进了建筑索引",
             bool(net_o.bld.get("湛恩纪念图书馆")))
    _check_j("非建筑 relation 未被误收（杨浦区边界 / 公交线 / 上理小区）",
             not any(k in net_o.bld for k in ("杨浦区", "上海公交6路", "上理小区", "复兴岛运河")))

    # 6) 泛类别词由 type 承担（守住 H2 组原则：类别词**不塞 tags**）
    for q, types in (("教室", {"教学楼", "学院楼"}), ("住宿", {"宿舍"}),
                     ("用餐", {"食堂", "餐厅", "烘焙/饮品"})):
        r = campus.search_pois(q, limit=1)
        _check_j(f"search_pois({q}) 首位落在对应 type 类里",
                 bool(r) and r[0]["type"] in types,
                 f"{r[0]['name']}/{r[0]['type']}" if r else "无结果")
    leaked = [p["name"] for p in allp if {"教室", "住宿", "用餐"} & set(p.get("tags") or [])]
    _check_j("泛类别词没有被塞进 tags（H2 组原则）", not leaked, "、".join(leaked))

    # 6b) 泛类别词的**拼音**独立成 pyk 档（54），必须压过「名字拼音前缀」（52）
    #     —— 「教室」「教师」同音：输入 jiaoshi 时『阅餐厅』(别名『教师餐厅』→
    #     jiaoshicanting) 曾靠前缀档把教学楼挤下去。规则：打全了的类别词 > 没打完的名字前缀。
    for q, types in (("jiaoshi", {"教学楼", "学院楼"}), ("gongyu", {"宿舍"}),
                     ("zhusu", {"宿舍"}), ("yongcan", {"食堂", "餐厅", "烘焙/饮品"})):
        r = campus.search_pois(q, limit=1)
        _check_j(f"search_pois({q}) 首位落在对应 type 类里（pyk 档＞名字前缀档）",
                 bool(r) and r[0]["type"] in types,
                 f"{r[0]['name']}/{r[0]['type']}" if r else "无结果")
    _check_j("search_pois(jiaoshi) 首位不是『阅餐厅』（同音假前缀已消除）",
             bool(campus.search_pois("jiaoshi", limit=1))
             and campus.search_pois("jiaoshi", limit=1)[0]["name"] != "阅餐厅")
    # pyk 只收全拼、不收首字母 —— `js` 这种两位缩写会大面积假命中。
    pyk_segs = [s for p in allp for s in (p.get("pyk") or "").split("|") if s]
    _check_j("pyk 只含全拼（无 2 字母缩写，防大面积假命中）",
             bool(pyk_segs) and all(len(s) >= 4 for s in pyk_segs),
             f"{len(pyk_segs)} 段，最短 {min((len(s) for s in pyk_segs), default=0)}")
    # pyk 由 _TYPE_WORDS 反向展开：表里每个 type 至少有一条落在数据上（防词表漂移）
    covered = {p["type"] for p in allp if p.get("pyk")}
    want_types = {t for types in campus._TYPE_WORDS.values() for t in types}
    _check_j("_TYPE_WORDS 里的每个 type 都有条目带 pyk（词表未漂移）",
             want_types <= covered, f"缺 {sorted(want_types - covered)}")

    # 7) 合并后的两条对外投影仍无坐标
    for n in ("图书馆（图文信息中心）", "校医室（卫生科）"):
        _check_j(f"{n} 检索投影无坐标字段",
                 not _COORD_KEYS.search(json.dumps(campus.search_pois(n, limit=1), ensure_ascii=False)))

    print("=" * 72)
    print("Q 组 · 缺项补录与旧名映射（2026-09-18，官方/第三方证据）")
    print("=" * 72)

    # 1) 田家炳楼 = 综合楼。证据链：校理学院官网《悼念田家炳先生》「学校将理学院教学楼
    #    命名为田家炳楼」；理学院 2009 校友会「在综合楼B110召开」；搜狐/澎湃/美篇均称
    #    「田家炳综合楼」；第三方点位距 OSM『综合楼 B 座』4.8 m。
    _check_j("find_poi(田家炳楼) → 综合楼",
             (campus.find_poi("田家炳楼") or {}).get("name") == "综合楼")
    _check_j("find_poi(田家炳综合楼) → 综合楼",
             (campus.find_poi("田家炳综合楼") or {}).get("name") == "综合楼")
    _check_j("search_pois(田家炳) 首位是综合楼",
             bool(campus.search_pois("田家炳", limit=1))
             and campus.search_pois("田家炳", limit=1)[0]["name"] == "综合楼")

    # 2) 城建学院 = 环境与建筑学院（环建楼）。证据：第三方点位距 OSM『环境与建筑学院』18 m；
    #    校方文件用简称『环建学院』。
    _check_j("find_poi(城建学院) → 环建楼",
             (campus.find_poi("城建学院") or {}).get("name") == "环建楼")

    # 3) 医疗器械与食品学院 2021 年更名健康科学与工程学院，学院在卓越楼（334 号校区）。
    #    证据：校《关于学院更名的公告》上理工委〔2021〕95号；校后勤寒假通知
    #    「军工路334号校区 卓越楼」；学院消防演习通知「军工路334号校区卓越楼 1-6、10-14 层」。
    for _q in ("医疗器械与食品学院", "健康科学与工程学院", "健康学院"):
        _check_j(f"find_poi({_q}) → 卓越楼",
                 (campus.find_poi(_q) or {}).get("name") == "卓越楼")

    # 4) 现代化教学中心：OSM 有具名建筑、图谱此前漏收 → 补录，并收下俗称『计算中心』
    _mdev = campus.find_poi("现代化教学中心")
    _check_j("图谱已补录『现代化教学中心』", bool(_mdev))
    _check_j("find_poi(计算中心) → 现代化教学中心",
             (campus.find_poi("计算中心") or {}).get("name") == "现代化教学中心")
    _check_j("现代化教学中心 定位来源为 osm（实锚，非弱锚）",
             net_o.poi.get("现代化教学中心", (None, ""))[1] == "osm",
             f"实际 {net_o.poi.get('现代化教学中心', (None, ''))[1]}")

    # 5) 别名唯一：同一别名不能挂在两个条目上（否则 find_poi 结果随遍历顺序漂移）
    _seen_alias, _dup_alias = {}, []
    for _p in allp:
        for _a in _p.get("alias", []):
            if _a in _seen_alias and _seen_alias[_a] != _p["name"]:
                _dup_alias.append((_a, _seen_alias[_a], _p["name"]))
            _seen_alias[_a] = _p["name"]
    _check_j("别名不重复挂靠（无跨条目的同名 alias）", not _dup_alias, str(_dup_alias[:3]))

    # 6) 新增别名的拼音也进了索引（否则拼音输入查不到）
    for _q, _want in (("tianjiabing", "综合楼"), ("chengjian", "环建楼"),
                      ("jisuanzhongxin", "现代化教学中心")):
        _r = campus.search_pois(_q, limit=1)
        _check_j(f"search_pois({_q}) 首位 = {_want}",
                 bool(_r) and _r[0]["name"] == _want,
                 f"{_r[0]['name']}" if _r else "无结果")

    print("=" * 72)
    print("P 组 · 路网拓扑修正：车行隧道 / 广场可穿越 / 桥接边归位（2026-09-18）")
    print("=" * 72)

    import campus_network as _cnmod
    net_p = campus.network()

    # 1) 🔴 车行隧道不可步行。
    #    周家嘴路隧道（tunnel=yes, layer=-2/-3）此前被当成普通 primary 城市道路纳入路网 ——
    #    行人根本进不了江底车行隧道。而它正是「7 处碎片桥接」之一：我们不但把不可通行的
    #    隧道接进了步行图，还用它连通了两块路网。规则只拦**城市道路**上的 tunnel
    #    （人行地道是 footway/path，必须保留可走）。
    _TUN = (31.2850, 31.2865, 121.5455, 121.5470)   # 隧道在 bbox 内的路段
    _in_tun = lambda net: [n for n in net.adj
                           if _TUN[0] <= n[0] <= _TUN[1] and _TUN[2] <= n[1] <= _TUN[3]]
    _check_j("剔除记录可追溯（skipped_tunnel 记到了隧道名）",
             any("周家嘴路隧道" in str(x) for x in net_p.skipped_tunnel),
             str(net_p.skipped_tunnel)[:60])
    # 反向验证：**关掉剔除规则**，同一 bbox 必须重新出现节点 ——
    # 否则上一条断言可能是「那个 bbox 本来就没东西」这种空断言。
    _sav_tun = _cnmod.TUNNEL_CAR
    try:
        _cnmod.TUNNEL_CAR = set()
        net_notun = _cnmod.Network()
        n_tun_off = len(_in_tun(net_notun))
    finally:
        _cnmod.TUNNEL_CAR = _sav_tun
    n_tun_on = len(_in_tun(net_p))
    _check_j("反向验证：放开隧道规则后该 bbox 重新出现路网节点",
             n_tun_off > n_tun_on, f"剔除后 {n_tun_on} 个 / 放开后 {n_tun_off} 个")

    # 2) 广场可穿越：OSM 的 `area=yes + highway=pedestrian` 是**面状**行人空间，
    #    此前按折线装载 —— 人只能沿周长绕，能斜穿却要绕边。
    _check_j("识别到面状步行空间（area=yes + highway=pedestrian）",
             net_p.area_polys >= 1, f"实际 {net_p.area_polys} 块")
    _check_j("面内直连边已生成", len(net_p.area_edges) > 0, f"{len(net_p.area_edges)} 条")
    _over = [e for e in net_p.area_edges if _cnmod.hav(*tuple(e)) > _cnmod.AREA_CHORD_MAX + 1]
    _check_j("面内直连边都不超过 AREA_CHORD_MAX（不会横穿整个大场）",
             not _over, f"{len(_over)} 条超长")
    # 反向验证：关掉 HW_AREA → 直连边归零
    _sav_area = _cnmod.HW_AREA
    try:
        _cnmod.HW_AREA = set()
        net_noarea = _cnmod.Network()
        n_noarea = len(net_noarea.area_edges)
    finally:
        _cnmod.HW_AREA = _sav_area
    _check_j("反向验证：关掉 HW_AREA 后面内直连边归零", n_noarea == 0, f"{n_noarea} 条")

    # 3) 桥接边：**全部在校外**。此前一直被当成「校内路网断成 7 截」的证据，
    #    实测澄清 —— 这 7 处的端点没有一个靠近任何 OSM 具名建筑（校内桥接必然贴楼）。
    #    校内路网本来就是一整块。桥接的性质是「给校外碎片留条路」。
    _near_bld = []
    for _b in net_p.bridged:
        for _p in (_b["a"], _b["b"]):
            if any(_cnmod.hav(_p, _c) < 40 for _cs in net_p.bld.values() for _c in _cs):
                _near_bld.append((_b["gap_m"], _p))
    _check_j("桥接端点无一靠近 OSM 具名建筑（桥接全在校外，非『校内断成多截』）",
             not _near_bld, f"{len(_near_bld)} 个端点贴楼")
    _check_j("桥接边已单独登记（bridge_edges 非空，供『仅校内』模式排除）",
             len(net_p.bridge_edges) == len(net_p.bridged),
             f"{len(net_p.bridge_edges)} 边 / {len(net_p.bridged)} 处")

    # 4) 「仅校内」模式不受桥接边影响 —— 反向验证：清空 bridge_edges，同一条路必须同值。
    #    （若某条校内路线其实**在用**桥接边，清空后结果就会变。）
    _r_b = campus.route("第三教学楼", "第五食堂", "campus")
    _sav_be = net_p.bridge_edges
    try:
        net_p.bridge_edges = set()
        _r_a = campus.route("第三教学楼", "第五食堂", "campus")
    finally:
        net_p.bridge_edges = _sav_be
    _check_j("『仅校内』模式的路线不受桥接边影响（反向验证：清空后同值）",
             bool(_r_b) and bool(_r_a) and abs(_r_b["meters"] - _r_a["meters"]) < 0.01,
             f'{_r_b["meters"]:.1f} → {_r_a["meters"]:.1f}' if _r_b and _r_a else "N/A")

    # 5) 邻接表不变量：无自环 / 无零长边 / **无重边**。
    #    重边来自「一条 way 同时是 footway 与 service」或「广场面内直连边压在真实周长边上」，
    #    两份权重还不一样（步道 1.0 / 城市道路 1.15 / 穿广场 1.10）。
    #    2026-09-18 体检实测 2750 条边里有 376 对重复 → 已由 Network._dedupe_adj() 归零。
    #    （等价性已验证：去重前后 606 组 × 2 模式的路线距离 md5 完全一致。）
    _self_loops = [n for n in net_p.adj for v, _ in net_p.adj[n] if v == n]
    _zero_len = [(n, v) for n in net_p.adj for v, w in net_p.adj[n] if w <= 1e-9]
    _seen_dir = {}
    _dup_dir = 0
    for n in net_p.adj:
        for v, _w in net_p.adj[n]:
            _seen_dir[(n, v)] = _seen_dir.get((n, v), 0) + 1
    _dup_dir = sum(1 for c in _seen_dir.values() if c > 1)
    _check_j("邻接表无自环", not _self_loops, f"{len(_self_loops)} 个")
    _check_j("邻接表无零长边", not _zero_len, f"{len(_zero_len)} 条")
    _check_j("邻接表无重边（同一有向对只存一次，_dedupe_adj 生效）",
             _dup_dir == 0, f"{_dup_dir} 对重复")

    # 6) 锚点塌缩上限：同坐标不同地点的分组里，「疑似缺陷」组**不得超过 8**。
    #    判据是**锚点来源**而非距离 —— 派生锚（approx/walk_minutes/zone/near_landmark/roads）
    #    出现在同坐标组里，说明它抄了邻居坐标，距离恒 0 是假的。
    #    （2026-09-18 实测 17 组同坐标 / 8 组疑似缺陷，清单见
    #      docs/anchor-audit-2026-09-18.md 第八节。）
    _coord_groups = {}
    for _n, (_pt, _s) in net_o.poi.items():
        _coord_groups.setdefault((round(_pt[0], 5), round(_pt[1], 5)), []).append((_n, _s))
    _suspect = [g for g in _coord_groups.values()
                if len(g) >= 2 and any(s not in ("osm", "keypoint") for _, s in g)]
    _check_j("锚点塌缩「疑似缺陷」组 ≤ 8（派生锚不得再抄袭邻居坐标）",
             len(_suspect) <= 8, f"实际 {len(_suspect)} 组")

    # 7) 合法同址必须有 osm 实锚背书，且**不得**把整组拖成派生锚
    for _pair in (("1100图书馆", "第四食堂"), ("暖屋超市", "暖屋超市生鲜店")):
        _ok = all(net_o.poi.get(x, (None, ""))[1] == "osm" for x in _pair)
        _check_j(f"合法同址 {'/'.join(_pair)} 两端均为 osm 实锚", _ok,
                 str([net_o.poi.get(x, (None, ''))[1] for x in _pair]))

    print("=" * 72)
    print("R 组 · 引用完整性：walk_minutes / 别名的可解析性（2026-09-18）")
    print("=" * 72)

    # 背景（这就是本组要防的**真实缺陷**）：`find_poi("麦当劳")` 命中成功，但
    # `net.resolve("麦当劳（二食堂左侧）")` 返回 None —— 同一条 3 分钟步行关系
    # 在**检索层**可见、在**寻路层**不可用。两层的名字来源不同（find_poi 走检索索引，
    # resolve 走 allp 的 alias_map），任何一侧漏补别名都会造成「查得到、走不了」。
    # 因此这里必须分别对**寻路层**做断言，不能只断言 find_poi。
    _wm = m_all.get("walk_minutes", [])
    _bad_res, _bad_route = [], []
    for _w in _wm:
        for _k in ("from", "to"):
            _v = _w.get(_k)
            if net_o.resolve(_v) is None:
                _bad_res.append(f"{_k}={_v}")
        _r = campus.route(_w.get("from"), _w.get("to"))
        if not _r:
            _bad_route.append(f"{_w.get('from')}→{_w.get('to')}")
    _check_j(f"walk_minutes 全部 {len(_wm)} 条的 from/to 都能被寻路层解析（net.resolve 非空）",
             not _bad_res, "、".join(_bad_res[:5]))
    _check_j(f"walk_minutes 全部 {len(_wm)} 条都实际可寻路（route 非 None）",
             not _bad_route, "、".join(_bad_route[:5]))

    # 别名必须在**寻路层**也能解析回主名（alias_map 与检索索引同源不同路）
    _alias_bad = []
    for _p in allp:
        for _a in _p.get("alias", []):
            if net_o.resolve(_a) != _p["name"]:
                _alias_bad.append(f"{_a}→{net_o.resolve(_a)}（应为 {_p['name']}）")
    _check_j("每个 alias 都能被寻路层解析回其主条目（无『查得到、走不了』）",
             not _alias_bad, "、".join(_alias_bad[:5]))

    # 主名自解析：主名必须解析成它自己（norm 折叠不得把 A 折成 B）
    _self_bad = [p["name"] for p in allp if net_o.resolve(p["name"]) != p["name"]]
    _check_j("每个主名都自解析（resolve(name) == name）", not _self_bad,
             "、".join(_self_bad[:5]))

    # 骑行假设表（L5）：**不做骑行寻路**，只在步行表上加一列估计值 —— 契约在
    # `data/access_policy.json`：bike_minutes = 步行路网距离 ÷ 12 km/h ÷ 60 + 取放车 2 分钟。
    # ⚠️ 不能用「骑行一定快于步行」当断言：短距离下 2 分钟取放车会吃掉全部收益，
    #    反而可能 ≥ 步行值（100 m 走路 2 分，骑车 0.5+2=2.5→3 分）。所以断言**口径公式**，
    #    不臆造单调性。反向验证：改 access_policy 的 speed_kmh → 本组立刻变红。
    _pol = json.load(open(os.path.join(HERE, "..", "data", "access_policy.json"), encoding="utf-8"))
    _speed = float(_pol["_meta"]["speed_kmh"])
    _ov_min = float(_pol["_meta"]["overhead_seconds"]) / 60.0
    _bike_bad, _n_bike = [], 0
    for _w in _wm:
        _b = _w.get("bike_minutes")
        _r = campus.route(_w.get("from"), _w.get("to"))
        if _b is None:
            _bike_bad.append(f"{_w.get('from')}→{_w.get('to')}: 缺 bike_minutes")
            continue
        _n_bike += 1
        if not isinstance(_b, int) or _b < 1:
            _bike_bad.append(f"{_w.get('from')}→{_w.get('to')}: 非正整数 {_b}")
            continue
        if _r:
            _exp = max(1, round(_r["meters"] / 1000.0 / _speed * 60.0 + _ov_min))
            if _b != _exp:
                _bike_bad.append(f"{_w.get('from')}→{_w.get('to')}: {_b} ≠ 口径 {_exp}")
    _check_j(f"每条步行关系都带 bike_minutes（{_n_bike}/{len(_wm)}），且严格符合 "
             f"access_policy.json 口径（{_speed:g} km/h + 取放车 {_ov_min*60:.0f}s）",
             not _bike_bad, "、".join(_bike_bad[:5]))

    print("=" * 72)
    print("S 组 · 实锚率下限 + 2026-09-18 校区修正回归")
    print("=" * 72)

    # 1) 实锚率下限：实锚 = OSM 真实几何（osm）+ 人工核对关键点（keypoint）。
    #    其余（near_landmark / zone / walk_minutes / roads / approx / campus）
    #    都是「由邻居推出来」的派生锚，误差会累积，也是两条 POI 塌缩到同一点的根因。
    #    下限设 79% —— 2026-09-18 弱锚提锚后的实测值；掉了就该有人解释为什么。
    _n_strong = sum(1 for _pt, _s in net_o.poi.values() if _s in ("osm", "keypoint"))
    _ratio = _n_strong / max(len(net_o.poi), 1)
    _check_j("实锚率 ≥ 79%（弱锚提锚成果不被回退）",
             _ratio >= 0.79, f"实际 {_n_strong}/{len(net_o.poi)} = {_ratio*100:.0f}%")

    # 2) 第四食堂 在 **1100 基础学院**（远庆路，图书馆楼下），不是南校（334）。
    #    证据：校《上理美食》官方导览把「第四食堂」列在「军工路1100号校区」段并写
    #    「位于图书馆楼下」；后勤处《2026 元旦后勤服务安排》食堂表把「第四食堂大众餐／
    #    第四食堂风味档口／特色餐厅」整段列在 1100 号校区；校《一卡通服务网点》南校区
    #    只列第六、第七食堂，1100 号校区列「第四食堂」。
    #    （改前误标南校 —— 本图谱自己的「1100图书馆」zone 写的就是「远庆路四食堂二楼」，
    #      属自相矛盾。）
    _ds4 = campus.find_poi("第四食堂") or {}
    _check_j("第四食堂 校区 = 1100（原误标南校）", _ds4.get("campus") == "1100",
             str(_ds4.get("campus")))
    _check_j("第四食堂 已升为实锚（osm）",
             net_o.poi.get("第四食堂", (None, ""))[1] == "osm",
             f"实际 {net_o.poi.get('第四食堂', (None, ''))[1]}")
    _check_j("find_poi(四食堂) 仍 → 第四食堂（别名未丢）",
             (campus.find_poi("四食堂") or {}).get("name") == "第四食堂")
    # 与 1100 图书馆（同楼上下层）的步行距离必须很短
    _r4 = campus.route("第四食堂", "1100图书馆")
    _check_j("route(第四食堂 → 1100图书馆) ≤ 80 m（同楼：1 楼食堂 / 2 楼图书馆）",
             bool(_r4) and _r4["meters"] <= 80,
             f"{_r4['meters']:.0f} m" if _r4 else "无路线")
    # 反向验证：不该再出现在本部的「就近吃」里
    _nr = [str(x) for x in (campus.nearby("思餐厅", max_min=15) or [])]
    _check_j("第四食堂 不再出现在南校（本部）就近推荐里",
             not any("第四食堂" in x for x in _nr), "、".join(_nr[:3]))

    # 3) 中德国际学院 在 **334 南校区**（不是北校·历史核心区的格致堂）。
    #    证据：中德国际学院官网《联系我们》地址「中德国际学院（从军工路334号门进入）」
    #    —— 516 号只是 229 信箱的通信地址；同院《德语强化班招生简章》地址写
    #    「军工路334号 上海理工大学南校区」；OSM 具名建筑「中德学院」亦落在 334。
    _zd = campus.find_poi("中德学院") or {}
    _check_j("中德学院 校区 = 南校（原误标北校）", _zd.get("campus") == "南校",
             str(_zd.get("campus")))
    _check_j("中德学院 已升为实锚（osm）",
             net_o.poi.get("中德学院", (None, ""))[1] == "osm",
             f"实际 {net_o.poi.get('中德学院', (None, ''))[1]}")
    for _q in ("中德国际学院", "汉堡国际工程学院"):
        _check_j(f"find_poi({_q}) → 中德学院",
                 (campus.find_poi(_q) or {}).get("name") == "中德学院")

    # 4) 单字符查询不得顺着**含数字的标签**假命中（本次由标签『1100吃饭』暴露）
    for _q in ("1", "0", "1 1"):
        _check_j(f"search_pois({_q!r}) 不返回任何结果（单字符标签守卫）",
                 not campus.search_pois(_q, limit=5),
                 str([x["name"] for x in campus.search_pois(_q, limit=5)]))
    _check_j("search_pois('1100') 仍能命中 1100 片区（守卫只挡单字符）",
             bool(campus.search_pois("1100", limit=3)),
             str([x["name"] for x in campus.search_pois("1100", limit=3)]))

    total = ok + fail
    print("=" * 72)
    print(f"汇总：{ok}/{total} 通过（{ok/total*100:.1f}%）")
    if fails:
        print("失败明细：")
        for f in fails:
            print("  ❌", f)
    else:
        print("全部通过 ✅")
    print("=" * 72)
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
