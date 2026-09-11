# -*- coding: utf-8 -*-
"""补全 campus_map.json 缺失建筑 + 南校区步行数据（2026-09-11 测试驱动）"""
import json, os, sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(HERE, "..", "data", "campus_map.json")
d = json.load(open(P, encoding="utf-8"))

existing = {x.get("name") for x in d["landmarks"]} | {x.get("name") for x in d["pois"]}

NEW = [
    # ---- 北校区缺失（编号表 + AED 表有据）----
    dict(name="先进制造大楼", alias=["先进制造"], type="教学楼",
         zone="北校区·西北角", campus="北校",
         near_landmark=["第五教学楼", "工程实训中心"], verified=True),
    dict(name="大礼堂", alias=["礼堂"], type="教学楼",
         zone="北校区·历史核心区（海志中路沿线）", campus="北校",
         near_landmark=["思晏堂", "运动场", "篮球场"], verified=True),
    dict(name="校史馆", alias=["校史馆（图文信息中心）"], type="教学楼",
         zone="北校区·中北部", campus="北校",
         near_landmark=["图文信息中心", "湛恩纪念图书馆"],
         note="与图文信息中心同址（编号 11 合并标注『校史馆、图文信息中心』）", verified=True),
    dict(name="水母楼", alias=["公共服务中心", "教务处", "财务处"], type="服务",
         zone="北校区·生活区南缘", campus="北校",
         near_landmark=["第一食堂", "第二食堂"],
         note="教务处/财务处/房管科/公共服务中心所在地；办证明、缴费常来此楼", verified=True),
    dict(name="学生卡卡务中心", alias=["卡务中心", "补办校园卡"], type="服务",
         zone="北校区·东部", campus="北校",
         near_landmark=["第一浴室", "北校区第八宿舍"],
         note="校园卡补办/充值在此（异地补卡约 20 元）", verified=True),
    dict(name="中德学院", alias=["汉堡国际工程学院", "中德国际学院"], type="教学楼",
         zone="北校区·历史核心区", campus="北校",
         near_landmark=["格致堂", "国合楼（南校区，部分课程）"], verified=True),
    dict(name="动力馆", alias=["能源与动力工程学院"], type="教学楼",
         zone="北校区·中北部", campus="北校", near_landmark=["机械楼"], verified=True),
    dict(name="沪江美术馆", alias=["美术馆"], type="教学楼",
         zone="北校区·历史核心区", campus="北校", near_landmark=["音乐堂"], verified=True),
    dict(name="音乐堂", alias=[], type="教学楼",
         zone="北校区·历史核心区（海学路沿线）", campus="北校",
         near_landmark=["运动场", "湛恩大道"], verified=True),
    # ---- 南校区缺失 ----
    dict(name="理学院楼", alias=["理学院"], type="教学楼",
         zone="南校区（334）·东（海学南路沿线）", campus="南校",
         near_landmark=["外语楼", "第六食堂", "第五学生公寓3号楼"], verified=True),
    dict(name="外语楼", alias=["外语学院"], type="教学楼",
         zone="南校区（334）·东（海学南路沿线）", campus="南校",
         near_landmark=["理学院楼", "第六食堂"], verified=True),
    dict(name="微创楼", alias=["微创中心"], type="教学楼",
         zone="南校区（334）", campus="南校", near_landmark=["南校区图书馆"], verified=True),
    dict(name="理科实验中心", alias=["理科实验楼"], type="教学楼",
         zone="南校区（334）", campus="南校", near_landmark=["逸兴楼"], verified=True),
    dict(name="中德学院实验中心", alias=["中德实验中心"], type="教学楼",
         zone="南校区（334）", campus="南校", near_landmark=["南校区室内篮球场"], verified=True),
    dict(name="朝花夕拾书店", alias=["南校区书店"], type="服务",
         zone="南校区（334）·六公寓旁", campus="南校",
         near_landmark=["第六学生公寓", "南校区教育超市"], verified=True),
]

n = 0
for item in NEW:
    if item["name"] in existing:
        continue
    d["landmarks"].append(item)
    n += 1

# ---- 南校区步行关系补全 ----
W = [
    ("第五学生公寓", "卓越楼", 2, "五公寓离卓越楼近在咫尺（宿舍指南原话）", False),
    ("第五学生公寓", "思餐厅", 5, "est：南校区北侧，步行数分钟", False),
    ("第五学生公寓", "南校区教育超市", 2, "宿舍指南：周边有教育超市", False),
    ("第六学生公寓", "第六食堂", 3, "est：南校区东北侧", False),
    ("第六学生公寓", "外语楼", 4, "est：海学南路沿线", False),
    ("第六学生公寓", "朝花夕拾书店", 1, "宿舍指南：六公寓旁", False),
    ("国合楼", "南校区第一宿舍", 3, "est：南校区西南角", False),
    ("南校区操场", "思餐厅", 4, "est：南校操场旁", False),
    ("逸兴楼（四教）", "思餐厅", 4, "est：南校区内", False),
    ("334号校门", "南校区第一宿舍", 3, "est：进门后向西南", False),
]
have = {(w.get("from"), w.get("to")) for w in d["walk_minutes"]}
wn = 0
for f, t, m, note, ver in W:
    if (f, t) in have or (t, f) in have:
        continue
    d["walk_minutes"].append({"from": f, "to": t, "minutes": m, "note": note, "verified": ver})
    wn += 1

json.dump(d, open(P, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"新增 POI {n} 条，新增步行关系 {wn} 条")
print(f"当前规模：pois {len(d['pois'])} + landmarks {len(d['landmarks'])} = {len(d['pois'])+len(d['landmarks'])} POI，walk_minutes {len(d['walk_minutes'])} 条")
