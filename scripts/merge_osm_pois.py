# -*- coding: utf-8 -*-
"""把 OSM 具名建筑并入 campus_map.json。

数据来源：data/osm/junchanglu.osm
许可：© OpenStreetMap contributors，ODbL 1.0 —— 导入项一律标 src="osm" 以便溯源署名。

策略（保守，不覆盖任何现有数据）：
  1. 人工确认的等价名（SPECIAL）→ 只补别名
  2. 靠坐标区分南北的重名（COND_MAP，如 OSM 的「浴室」两处）→ 只补别名
  3. 「X 号楼」→ 挂到图谱已有的「X」上（如「第三学生公寓 1 号楼」→「第三学生公寓」）
  4. 名字已存在（含别名、去括号、斜杠前缀归一化）→ 只补别名
  5. 带校区歧义的（OSM 的「第七宿舍」）→ 用坐标判断，挂到「北校区第七宿舍」等
  6. 其余 → 作为新 landmark 加入，verified=False、src="osm"；同名多栋加校区后缀
  7. 低价值设施 / 校外单位 → 不收

用法：
    python scripts/merge_osm_pois.py           # 预演（不改文件）
    python scripts/merge_osm_pois.py --apply   # 实际写入
"""
import json
import math
import os
import re
import sys
import xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OSM_FILE = os.path.join(ROOT, "data", "osm", "junchanglu.osm")
MAP_FILE = os.path.join(ROOT, "data", "campus_map.json")

CENTER = {"北校": (31.2950161, 121.5506739), "南校": (31.2906712, 121.5535545)}

SKIP = {"门卫", "水泵房", "锅炉房", "太阳能楼", "实训车间", "光仪所辅房", "基建规划处"}

OFF = {
    "上海市第一康复医院", "杨浦区心境障碍诊治中心", "上海申宏冷藏储运公司",
    "兆峰办公文化用品", "铁路杨浦车站派出所", "沧达大厦", "普蜂莲花", "梅林公寓",
}

# 人工确认的等价名 → 图谱已有 POI
SPECIAL = {
    "第六宿舍 (留学生公寓) (馥赉堂)": "留学生公寓",
    "清真餐厅": "清真食堂（334）",
    "暖屋爱心超市 (东堂)": "暖屋超市",
}

# 同名但分属两个校区 → 按 (归一化名, 校区) 映射到图谱已有 POI
COND_MAP = {
    ("浴室", "北校"): "第一浴室",
    ("浴室", "南校"): "公共浴室（南校区）",
    ("室内体育馆", "北校"): "体育馆/体育活动中心",
}


def hav(a, b):
    R = 6371000.0
    la1, lo1 = math.radians(a[0]), math.radians(a[1])
    la2, lo2 = math.radians(b[0]), math.radians(b[1])
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def norm(s):
    s = re.sub(r"[（(][^）)]*[）)]", "", s or "")
    s = s.split("/")[0]
    return s.strip()


def campus_of(lat, lon):
    return "北校" if hav((lat, lon), CENTER["北校"]) < hav((lat, lon), CENTER["南校"]) else "南校"


def guess_type(n):
    if any(k in n for k in ("宿舍", "公寓", "专家楼", "玄德居")):
        return "宿舍"
    if any(k in n for k in ("食堂", "餐厅")):
        return "食堂"
    if any(k in n for k in ("教学楼", "实验楼", "实验中心", "实训中心")):
        return "教学楼"
    if "学院" in n:
        return "学院"
    if any(k in n for k in ("体育馆", "体育部")):
        return "体育设施"
    if any(k in n for k in ("办公楼", "办公室", "行政服务中心", "管理处", "研究生部",
                            "招生办", "保卫处", "勤工俭学", "校长", "教工之家")):
        return "办公楼"
    if any(k in n for k in ("文化中心", "故居", "音乐", "礼堂")):
        return "文化设施"
    if any(k in n for k in ("浴室", "超市", "医务", "活动室")):
        return "生活服务"
    if "堂" in n:
        return "文化设施"
    return "其他"


def load_osm_buildings():
    """返回 [(name, coord)]。

    同名且相距 <80 米的视为同一栋楼的不同部分（OSM 里常把一栋楼拆成多个 way），
    合并为一个；同名但确实分处两地的（如南北两个医务室）保留。
    """
    root = ET.parse(OSM_FILE).getroot()
    nodes, buckets = {}, {}
    for el in root:
        if el.tag == "node":
            nodes[el.get("id")] = (float(el.get("lat")), float(el.get("lon")))
        elif el.tag == "way":
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            if "building" in tags and tags.get("name"):
                pts = [nodes[r] for r in (nd.get("ref") for nd in el.findall("nd")) if r in nodes]
                if pts:
                    c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
                    buckets.setdefault(tags["name"].strip(), set()).add(c)

    res = []
    for n, cs in buckets.items():
        kept = []
        for c in cs:
            if not any(hav(c, k) < 80 for k in kept):
                kept.append(c)
        res.extend((n, c) for c in kept)
    return sorted(res)


def main():
    apply = "--apply" in sys.argv
    d = json.load(open(MAP_FILE, encoding="utf-8"))
    allp = d["pois"] + d["landmarks"]

    by_name = {p["name"]: p for p in allp}
    by_alias, by_norm = {}, {}
    for p in allp:
        for a in p.get("alias", []):
            by_alias.setdefault(a, p)
        by_norm.setdefault(norm(p["name"]), p)

    existing_osm = {p["name"] for p in allp if p.get("src") == "osm"}
    blds = load_osm_buildings()

    cnt = {}
    for n, _ in blds:
        cnt[n] = cnt.get(n, 0) + 1

    added, aliased, skipped, offs = [], [], [], []
    seq = 0

    def alias_to(target, name):
        if name == target["name"]:
            return False
        al = target.setdefault("alias", [])
        if name in al:
            return False
        al.append(name)
        aliased.append((name, target["name"]))
        return True

    for name, c in blds:
        if name in existing_osm:
            continue
        nname = norm(name)
        cp = campus_of(*c)

        if name in SKIP or nname in SKIP:
            skipped.append(name)
            continue
        if name in OFF:
            offs.append(name)
            continue

        # 1) 人工确认等价名
        sp = SPECIAL.get(name)
        if sp and sp in by_name:
            alias_to(by_name[sp], name)
            continue

        # 2) 靠校区区分的重名
        cm = COND_MAP.get((nname, cp))
        if cm and cm in by_name:
            alias_to(by_name[cm], name)
            continue

        # 3) 「X 号楼」→ 挂到图谱的「X」
        m = re.match(r"^(.+?)\s*\d+\s*号楼$", nname)
        if m:
            base = m.group(1).strip()
            tp = by_name.get(base) or by_norm.get(base)
            if tp:
                alias_to(tp, name)
                continue

        # 4) 名字已存在（含别名/归一化）
        tp = by_name.get(name) or by_alias.get(name) or by_norm.get(nname)
        if tp:
            alias_to(tp, name)
            continue

        # 5) 带校区前缀的图谱 POI（北校区第七宿舍 等）
        pref = "北校区" if cp == "北校" else "南校区"
        tp = by_name.get(f"{pref}{nname}") or by_name.get(f"{pref}{name}")
        if tp:
            alias_to(tp, name)
            continue

        # 6) 新增
        seq += 1
        disp = name
        if cnt[name] > 1:
            disp = f"{name}（{'北校区' if cp == '北校' else '南校区'}）"
            if disp in by_name:
                disp = f"{name}（{'北校区' if cp == '北校' else '南校区'}·{seq}）"
        item = {
            "id": f"osm-{seq:03d}",
            "name": disp,
            "alias": list({name} - {disp}),
            "type": guess_type(name),
            "zone": "北校区" if cp == "北校" else "南校区（334）",
            "campus": cp,
            "verified": False,
            "src": "osm",
            "note": "OSM 收录建筑（自动导入，位置与信息待人工确认）",
        }
        if re.match(r"^南[一二三四五六七八九十]宿舍$", name):
            item["alias"].append(name.replace("宿舍", ""))
        item["alias"] = sorted(set(item["alias"]))
        d["landmarks"].append(item)
        by_name[disp] = item
        added.append(disp)

    print("=" * 70)
    print(f"OSM 具名建筑 {len(blds)} 处 ｜ 现有 POI {len(allp)} 个")
    print("=" * 70)
    print(f"\n【新增 POI】{len(added)} 个")
    for i, n in enumerate(added):
        print(f"   + {n}", end="\n" if i % 2 else " ｜")
    print(f"\n\n【并入别名】{len(aliased)} 个（不新建，挂到已有 POI）")
    for a, t in aliased:
        print(f"   {a}   →   「{t}」")
    print(f"\n【低价值跳过】{len(set(skipped))} 类：{'、'.join(sorted(set(skipped)))}")
    print(f"【校外不收】{len(set(offs))} 个：{'、'.join(sorted(set(offs)))}")
    print(f"\n图谱规模：{len(allp)} → {len(d['pois']) + len(d['landmarks'])}")

    if not apply:
        print("\n[预演模式] 未写入文件。加 --apply 实际执行。")
        return

    src_line = ("OpenStreetMap 建筑数据（data/osm/junchanglu.osm，© OpenStreetMap contributors，ODbL 1.0）"
                "—— 用于补充宿舍/学院/文化设施等具名建筑")
    if src_line not in d["_meta"]["sources"]:
        d["_meta"]["sources"].append(src_line)
    d["_meta"]["updated"] = "2026-09-11"

    with open(MAP_FILE, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    print("\n✅ 已写入 campus_map.json")


if __name__ == "__main__":
    main()
