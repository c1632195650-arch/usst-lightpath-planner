"""拉取上海理工大学各校区的 OpenStreetMap 原始数据，存到本地 data/osm/。

数据源：OSM 官方 map API  https://api.openstreetmap.org/api/0.6/map?bbox=W,S,E,N
许可：ODbL 1.0，数据 © OpenStreetMap contributors
     派生使用需署名 + 同许可分发（详见 data/osm/README.md）

用法：
    python scripts/fetch_osm.py            # 已存在则跳过
    python scripts/fetch_osm.py --force    # 强制重新拉取
"""
import os
import sys
import time
import xml.etree.ElementTree as ET

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "osm")
API = "https://api.openstreetmap.org/api/0.6/map"
PROXY = {"http": "http://127.0.0.1:7890", "https": "http://127.0.0.1:7890"}
UA = {"User-Agent": "usst-lightpath-planner/1.0 (student project; OSM research)"}

# bbox 格式：W,S,E,N（注意与 Overpass 的 S,W,N,E 相反）
CAMPUSES = {
    "junchanglu": ("军工路主校区（516 北校 + 334 南校，含天桥两侧）", "121.5445,31.2868,121.5562,31.3005"),
    "jichuxueyuan": ("基础学院（军工路 1100 号）", "121.5397,31.2992,121.5466,31.3045"),
    "fuxinglu": ("复兴路校区（徐汇）", "121.4537,31.2110,121.4582,31.2167"),
}

# 视作「可行走 / 可通行」的道路类型
HW_WALK = {
    "footway", "path", "steps", "pedestrian", "service",
    "residential", "living_street", "track", "corridor",
}


def download(key, name, bbox, force=False):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{key}.osm")

    if os.path.exists(path) and not force and os.path.getsize(path) > 5000:
        size = os.path.getsize(path)
        print(f"  [跳过] 已存在 {size/1024:.0f} KB —— {name}")
        return path, None

    last = ""
    for attempt in range(3):
        try:
            r = requests.get(API, params={"bbox": bbox}, proxies=PROXY, headers=UA, timeout=180)
            if r.status_code == 200 and r.content.startswith(b"<?xml"):
                with open(path, "wb") as f:
                    f.write(r.content)
                print(f"  [下载] {len(r.content)/1024:.0f} KB —— {name}")
                return path, r.content
            last = f"HTTP {r.status_code} / {r.text[:120]}"
        except Exception as e:
            last = f"{type(e).__name__} {str(e)[:120]}"
        time.sleep(4)
    print(f"  [失败] {name} —— {last}")
    return None, None


def stats(path):
    try:
        root = ET.parse(path).getroot()
    except Exception as e:
        return f"解析失败 {e}"
    nodes, ways, named_bld, hw = 0, 0, 0, 0
    for el in root:
        if el.tag == "node":
            nodes += 1
        elif el.tag == "way":
            ways += 1
            tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
            if "building" in tags and tags.get("name"):
                named_bld += 1
            if tags.get("highway") in HW_WALK:
                hw += 1
    return f"节点 {nodes} ｜ way {ways} ｜ 可行走道路 {hw} ｜ 具名建筑 {named_bld}"


def main():
    force = "--force" in sys.argv
    print(f"输出目录：{OUT}")
    print(f"{'='*66}")
    total = 0
    for key, (name, bbox) in CAMPUSES.items():
        print(f"\n[{key}] {name}")
        print(f"  bbox(W,S,E,N) = {bbox}")
        path, _ = download(key, name, bbox, force=force)
        if path and os.path.exists(path):
            total += os.path.getsize(path)
            print(f"  {stats(path)}")
    print(f"\n{'='*66}")
    print(f"合计 {total/1024/1024:.1f} MB，存放于 data/osm/")
    print("数据 © OpenStreetMap contributors，ODbL 1.0")


if __name__ == "__main__":
    main()
