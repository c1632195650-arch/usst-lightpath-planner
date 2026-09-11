# -*- coding: utf-8 -*-
"""
campus_map.json 分区修正与补全
================================
依据（均为可溯源来源）：
  1. 官网《军工路校区道路名称》17 条路段（iso.usst.edu.cn）
  2. 后勤管理处《自动除颤仪（AED）》配置表 —— 官方明确标注「北校区/南校区」
  3. 公众号「上理指南」校园地图推文 —— 1-121 号 POI 编号表，按北校区(1-87)/南校区(88-121)分组
  4. 公众号「上理小喇叭」宿舍指南 —— 按「01 本部北校区 / 02 本部南校区」分组

核心结论（本次修正的依据）：
  **北校区 = 军工路 516 号（主校区）**，**南校区 = 军工路 334 号**。
  "本部"是两者的合称。学生口中「本部北校区/本部南校区」即此义。

修正项（原数据有误）：
  - 第五学生公寓：北校区 → **南校区**（宿舍指南「02 本部南校区·五公寓」；编号表 91/92/94/95）
  - 第六学生公寓：北校区 → **南校区**（宿舍指南「02 本部南校区·六公寓」；编号表 96/97/98）
  - zone「北校区·南侧（学海路）」描述含上两处 → 改写
  - 第九/第十宿舍：补「北校区」显式限定（南校区另有同名宿舍）

新增：
  - 所有 POI 增加 `campus` 字段（北校/南校/1100/580/复兴路）—— 排程引擎判断跨区用
  - 补齐南北同名宿舍、南校区宿舍群、缺失教学楼
"""
import json, os, sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(HERE, "..", "data", "campus_map.json")

d = json.load(open(P, encoding="utf-8"))
log = []


def infer_campus(zone: str) -> str:
    z = zone or ""
    if "复兴" in z:
        return "复兴路"
    if "1100" in z:
        return "1100"
    if "580" in z:
        return "580"
    if "南校区" in z:
        return "南校"
    if "北校区" in z:
        return "北校"
    return "北校"  # 默认本部北校区（516）


# ---------- 1. 修正错误 ----------
for p in d["pois"] + d["landmarks"]:
    nm = p.get("name", "")
    if nm == "第五学生公寓":
        p["zone"] = "南校区（334）·北侧（近卓越楼）"
        p["near_landmark"] = ["卓越楼", "思餐厅", "南校区教育超市", "南校区操场"]
        p["note"] = "五公寓2号楼男生、4号楼女生；上床下桌+大阳台+独卫+电梯。原数据误标为北校区，2026-09-11 依宿舍指南与编号表修正。"
        log.append("修正 第五学生公寓 → 南校区")
    elif nm == "第六学生公寓":
        p["zone"] = "南校区（334）·东北（近外语楼）"
        p["near_landmark"] = ["外语学院", "理学院楼", "第六食堂", "教育超市"]
        p["note"] = "六公寓1号楼男生（11层）、2号楼女生（16层），有电梯。原数据误标为北校区，2026-09-11 修正。"
        log.append("修正 第六学生公寓 → 南校区")
    elif nm in ("第九宿舍", "第十宿舍"):
        p["zone"] = "北校区·生活区（第一食堂楼上）"
        p["note"] = "北校区九/十宿舍（九宿舍在一食堂3楼、十宿舍在其近旁）。注意：南校区另有同名『南校区第九/第十宿舍』，勿混。"
        log.append(f"明确 {nm} 属北校区（与南校区同名宿舍区分）")

# zone 描述修正
zs = d["zones"]
if "北校区·南侧（学海路）" in zs:
    old = zs.pop("北校区·南侧（学海路）")
    zs["北校区·南侧（近海安路天桥）"] = (
        "第二学生公寓（二公寓1-3号楼：1、3号楼男生，2号楼女生）、留学生公寓1-2号楼、第十二宿舍；"
        "楼下有教育超市与『上理宝盒』快递柜，翻天桥（新/老天桥）即达南校区思餐厅"
    )
    log.append(f"重写 zone『北校区·南侧（学海路）』（原含五/六公寓，属南校区）：{old[:40]}…")

# ---------- 2. 全部 POI 补 campus 字段 ----------
for p in d["pois"] + d["landmarks"]:
    p["campus"] = infer_campus(p.get("zone", ""))
log.append("为所有 POI 增加 campus 字段（北校/南校/1100/580/复兴路）")

# ---------- 3. 补全 POI（南北同名宿舍 + 南校区宿舍群 + 教学楼） ----------
existing = {x.get("name") for x in d["landmarks"]} | {x.get("name") for x in d["pois"]}
NEW = [
    # —— 南校区宿舍（同名需校区前缀区分）——
    dict(name="南校区第一宿舍", alias=["南1宿舍", "南校区1宿舍"], type="宿舍",
         zone="南校区（334）·西南", campus="南校",
         near_landmark=["国合楼", "思餐厅", "南校区操场"],
         note="男生宿舍，上下床四人间；位于南校区最僻静角落，距南校操场几步路", verified=True),
    dict(name="南校区第二宿舍", alias=["南2宿舍", "南校区2宿舍"], type="宿舍",
         zone="南校区（334）·西", campus="南校",
         near_landmark=["南校区操场", "思餐厅"],
         note="女生宿舍，红墙复古建筑；周边树木成荫", verified=True),
    dict(name="南校区第三宿舍", alias=["南3宿舍", "南校区3宿舍"], type="宿舍",
         zone="南校区（334）·西北", campus="南校",
         near_landmark=["南校区操场", "思餐厅", "南校区室内篮球场"],
         note="女生宿舍，上床下桌四人间；靠近南校区大操场", verified=True),
    dict(name="南校区第七宿舍", alias=["南7宿舍"], type="宿舍",
         zone="南校区（334）·南（尚理路沿线）", campus="南校",
         near_landmark=["清真食堂", "第六食堂", "南校区第十宿舍"], verified=True),
    dict(name="南校区第八宿舍", alias=["南8宿舍"], type="宿舍",
         zone="南校区（334）·南", campus="南校", near_landmark=["南校区操场"], verified=True),
    dict(name="南校区第九宿舍", alias=["南9宿舍"], type="宿舍",
         zone="南校区（334）·南", campus="南校", near_landmark=["南校区操场"], verified=True),
    dict(name="南校区第十宿舍", alias=["南10宿舍"], type="宿舍",
         zone="南校区（334）·南（尚理路沿线）", campus="南校",
         near_landmark=["清真食堂", "南校区第七宿舍"], verified=True),
    # —— 北校区宿舍（补齐编号表中出现但未建模的）——
    dict(name="北校区第三宿舍", alias=["北3宿舍", "3宿舍"], type="宿舍",
         zone="北校区·生活区", campus="北校", near_landmark=["暖屋超市", "小花园"], verified=True),
    dict(name="北校区第四宿舍", alias=["北4宿舍", "4宿舍"], type="宿舍",
         zone="北校区·生活区", campus="北校", near_landmark=["暖屋超市", "第一食堂"], verified=True),
    dict(name="北校区第五宿舍", alias=["北5宿舍", "5宿舍"], type="宿舍",
         zone="北校区·运动区东侧", campus="北校",
         near_landmark=["灯光篮球场", "第一教学楼", "第二食堂"],
         note="女生宿舍，上下床4-6人；距第一教学楼不到百米，大一常在此上课", verified=True),
    dict(name="北校区第七宿舍", alias=["北7宿舍", "7宿舍"], type="宿舍",
         zone="北校区·历史核心区（尚思路沿线）", campus="北校",
         near_landmark=["思晏堂", "第七宿舍"], verified=True),
    dict(name="北校区第八宿舍", alias=["北8宿舍", "8宿舍"], type="宿舍",
         zone="北校区·东部（花园平台旁）", campus="北校",
         near_landmark=["第一浴室", "第一食堂", "花园平台"],
         note="女生宿舍，上床下桌四人间；旁有花园平台小木椅，适合晨读", verified=True),
    dict(name="第十二宿舍", alias=["12宿舍", "十二宿舍"], type="宿舍",
         zone="北校区·最东", campus="北校",
         near_landmark=["第一浴室", "北校操场", "灯光篮球场"],
         note="男生宿舍，八床（一般住6人）；楼下即第一浴室，距洗衣店近", verified=True),
    dict(name="启明楼宿舍", alias=["启明楼"], type="宿舍",
         zone="北校区·中北部", campus="北校",
         near_landmark=["第三教学楼", "图文信息中心"],
         note="空调租赁走本楼宿管（军工路516校区特殊名单之一）", verified=True),
    dict(name="留学生公寓", alias=["留学生公寓1号楼", "留学生公寓2号楼"], type="宿舍",
         zone="北校区", campus="北校", near_landmark=["第一浴室"], verified=True),
    dict(name="藏书阁宿舍", alias=["藏书阁"], type="宿舍",
         zone="北校区·历史核心区", campus="北校", near_landmark=["老图书馆"], verified=True),
    # —— 南校区其他 ——
    dict(name="南校区操场", alias=["南校操场", "南校区大操场"], type="运动",
         zone="南校区（334）", campus="南校",
         near_landmark=["南校区第一宿舍", "南校区第二宿舍", "思餐厅"], verified=True),
    dict(name="南校区室内篮球场", alias=["334篮球场"], type="运动",
         zone="南校区（334）", campus="南校", near_landmark=["逸兴楼（第四教学楼）"], verified=True),
    dict(name="教工食堂", alias=["南校区教工食堂"], type="食堂",
         zone="南校区（334）", campus="南校", near_landmark=["思餐厅", "卓越楼"], verified=True),
    dict(name="国合楼", alias=["国际合作大楼", "因合楼"], type="教学楼",
         zone="南校区（334）·进门左手边", campus="南校",
         near_landmark=["334号校门", "南校区第一宿舍"],
         note="国际合作大楼；中德国际学院等在此办公上课（如国合楼 419 办公室）", verified=True),
]

# 三教已存在 → 只补充别名与来源说明（不重复添加）
for p in d["landmarks"]:
    if p.get("name") == "第三教学楼":
        for a in ("3教", "新三教"):
            if a not in p.get("alias", []):
                p.setdefault("alias", []).append(a)
        p["note"] = (
            "AED 表官方标注『北校区第三教学楼一楼入口处』；教学楼关闭通知中与一教/五教/综合楼并列。"
            "编号表未单列（编号 16/17/60-63/82 缺失），故位置依官方路段+自习攻略推定"
        )
        log.append("补充 第三教学楼 别名（新三教）与来源说明")
added = 0
for item in NEW:
    if item["name"] in existing:
        continue
    d["landmarks"].append(item)
    added += 1
log.append(f"新增 {added} 条 POI（南校宿舍群 / 南北同名宿舍 / 国合楼 / 南校操场等）")

# ---------- 4. 更新 _meta 与 needs_check ----------
d["_meta"]["updated"] = "2026-09-11"
d["_meta"]["campus"] = (
    "军工路校区（本部=516 北校区 + 334 南校区）｜1100 基础学院｜580 号｜复兴路校区"
)
if "后勤管理处《自动除颤仪（AED）》配置表（官方标注北校区/南校区 19 处点位）" not in d["_meta"]["sources"]:
    d["_meta"]["sources"] += [
        "后勤管理处《自动除颤仪（AED）》配置表（官方标注北校区/南校区 19 处点位）",
        "公众号「上理指南」校园地图推文 1-121 号 POI 编号表（北校区 1-87 / 南校区 88-121）",
        "公众号「上理小喇叭」宿舍指南（01 本部北校区 / 02 本部南校区 分组）",
    ]
d["_meta"]["notes"] = (
    "【分区口径】北校区=军工路 516 号（主校区）；南校区=军工路 334 号；"
    "两者合称『本部』，由海安路人行天桥连接（步行 10-15 分钟）。"
    "1100 基础学院 / 580 号 / 复兴路校区为独立校区，不参与本部课程排程。"
    "verified=true 表示官方来源或≥2 个独立来源交叉确认；"
    "步行分钟数带 est 为按道路相邻关系估算，需在校生体感校正。不存测绘坐标，只用相对位置。"
)
d["needs_check"] = [
    "带 est 的步行分钟数为估算值，请在校生体感校正（尤其：一教↔三教、三教↔生活区食堂）",
    "第二教学楼：官方编号表与 AED 表均未单列，若实际存在请补充其校区与位置",
    "『二公寓3号楼』归属存疑：编号表列在南校区(88)，但宿舍指南把二公寓整体归北校区 —— 待在校生确认",
    "南校区第四/第六/清真食堂的详细营业时间与招牌菜（官网食堂导览未覆盖 334）",
    "南校区各宿舍楼的精确楼栋编号与床位类型（现据宿舍指南聚合描述）",
]

json.dump(d, open(P, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("完成，修改日志：")
for x in log:
    print("  -", x)
print()
print(f"POI 总数：pois {len(d['pois'])} + landmarks {len(d['landmarks'])} = {len(d['pois'])+len(d['landmarks'])}")
