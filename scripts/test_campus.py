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
import os, sys, json

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
