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
    ("校医室（卫生科）", "2026-09-15 12:10", None),   # 无 hours → 如实未知
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
    _check_j("1100 起点如实返回不可定位（不编造）", r1100["walkable"] is False,
             str(r1100.get("reason"))[:34])

    _check_j("跨分组 route 返回 None（三教 → 1100教育超市）",
             campus.route("第三教学楼", "1100教育超市") is None)
    _check_j("跨分组 route 返回 None（申一教 → 申二教）",
             campus.route("申一教", "申二教") is None)

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
    print("=" * 72)
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
