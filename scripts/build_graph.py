# -*- coding: utf-8 -*-
"""
上理校园步行图构建器（路线 1 · 路段建图）
============================================
问题：campus_map.json 里 99 个 POI 只有 42 条手工边，63 个点是孤岛，
      任意两点可达率仅 5.69% —— 梨宝只认得「被明确录入过」的那几对地点。

本脚本做一件此前从未做过的事：**把 roads 字段当图用**。

    roads 里 13 条官方路段，每条的 line 就是一个有序点列：
        海远中路: 公共服务中心 → 第一学生公寓 → 第一食堂 → 第三教学楼
    相邻的点天然相邻 → 13 条路段可生成 37 条相邻边。

更关键的是：**同名节点在不同路段间会自动合并**，这就是连通机制 ——
    「勤勉大道」同时出现在 海晏路/海聆路/海学北路 → 三条路经它连通。

设计要点：
  1. 节点 ID = 「校区·名称」。必须带校区，否则北校「第七宿舍」与
     南校「第七宿舍」会被误合并，把两个校区错误连通。
  2. 路段点名先经 find_poi 归一化（『图书馆』→『图书馆（图文信息中心）』），
     与 walk_minutes 的名称体系对齐，否则两套名字对不上。
  3. walk_minutes 的实测边优先，覆盖同名自动边。
  4. 权重：路段相邻段默认 2 分钟（est，实测边会覆盖）。

用法：
    python scripts/build_graph.py          # 打印诊断报告
    python scripts/build_graph.py --mermaid  # 额外输出 mermaid 图
"""
import os, re, sys, json
from collections import defaultdict, deque

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "server"))
import campus  # noqa: E402

SEG_MIN = 2.0          # 路段相邻两点的默认步行分钟（est）
CAMPUS_HINT = {"北校区": "北校", "南校区": "南校"}


def _clean(name):
    """去掉括号里的补充说明：『光电楼（光电信息与计算机工程学院）』→『光电楼』"""
    return re.sub(r"[（(][^）)]*[）)]", "", name or "").strip()


def _node(name, campus_hint=None):
    """把任意点名解析为节点 ID。先尝试挂到 POI，挂不上就作为纯路径节点。

    返回 (node_id, display_name, poi_or_None)
    """
    p = campus.find_poi(name)
    if p and p.get("campus"):
        return f"{p['campus']}·{p['name']}", p["name"], p
    cp = campus_hint or "?"
    return f"{cp}·{name}", name, None


def build():
    """构建步行图。返回 (adj, nodes, edge_info)

    adj: {node_id: {邻居node_id: minutes}}
    nodes: {node_id: {"name":..., "campus":..., "poi":..., "via":[...]}}
    edge_info: {(a,b): {...}}  a<b 排序后的键
    """
    m = campus.load_map()
    adj = defaultdict(dict)
    nodes = {}
    edge_info = {}

    def add_node(nid, disp, poi, via):
        if nid not in nodes:
            nodes[nid] = {"name": disp, "campus": nid.split("·", 1)[0],
                          "poi": poi, "via": []}
        if via and via not in nodes[nid]["via"]:
            nodes[nid]["via"].append(via)

    def add_edge(a, b, minutes, src, verified=False, overwrite=False):
        if a == b:
            return
        key = tuple(sorted([a, b]))
        old = edge_info.get(key)
        # 实测边优先于估算边；同为估算时保留先到者
        if old and old["verified"] and not verified:
            return
        if old and not overwrite and not verified and old["src"].startswith("实测"):
            return
        edge_info[key] = {"minutes": minutes, "src": src, "verified": verified}
        adj[a][b] = minutes
        adj[b][a] = minutes

    # ---------- 1. 路段建图（主骨架）----------
    road_edges = 0
    for r in m.get("roads", []):
        cp = CAMPUS_HINT.get(r["campus"], r["campus"])
        segs = [_clean(s) for s in r["line"].split("→") if s.strip()]
        ids = []
        for s in segs:
            nid, disp, poi = _node(s, cp)
            add_node(nid, disp, poi, f"路段·{r['road']}")
            ids.append(nid)
        for i in range(len(ids) - 1):
            add_edge(ids[i], ids[i + 1], SEG_MIN, f"路段·{r['road']}", verified=False)
            road_edges += 1

    # ---------- 2. 实测边叠加（覆盖自动边）----------
    meas_edges = 0
    for w in m.get("walk_minutes", []):
        a_id, a_disp, _ = _node(w.get("from", ""))
        b_id, b_disp, _ = _node(w.get("to", ""))
        if a_id == b_id:
            continue
        add_node(a_id, a_disp, campus.find_poi(a_disp), None)
        add_node(b_id, b_disp, campus.find_poi(b_disp), None)
        add_edge(a_id, b_id, float(w.get("minutes", SEG_MIN)),
                 "实测" if w.get("verified") else "手工估算",
                 verified=bool(w.get("verified")), overwrite=True)
        meas_edges += 1

    # ---------- 3. 跨区枢纽：南北校区经天桥连通 ----------
    # 若两侧已有实测跨区边（如 二公寓↔思餐厅）则已连通；此处补一条兜底
    north_side = "北校·第二学生公寓"
    south_side = "南校·思餐厅"
    if north_side in nodes and south_side in nodes:
        add_edge(north_side, south_side, 4.0, "实测·跨区天桥", verified=True)

    return adj, nodes, edge_info, road_edges, meas_edges


def stats(adj, nodes, edge_info, road_edges, meas_edges):
    """连通性诊断"""
    # 连通分量
    seen, comps = set(), []
    for n in nodes:
        if n in seen or n not in adj:
            continue
        q, comp = deque([n]), []
        seen.add(n)
        while q:
            x = q.popleft()
            comp.append(x)
            for y in adj[x]:
                if y not in seen:
                    seen.add(y)
                    q.append(y)
        comps.append(comp)
    comps.sort(key=len, reverse=True)

    isolated = [n for n in nodes if n not in adj]
    big = set(comps[0]) if comps else set()
    tot = len(nodes) * (len(nodes) - 1) // 2
    reachable = sum(1 for a in big for b in big if a < b)

    print("=" * 72)
    print("路段建图 · 连通性诊断")
    print("=" * 72)
    print(f"  节点总数      : {len(nodes)}")
    print(f"  边总数        : {len(edge_info)}  （路段自动 {road_edges} + 实测/手工 {meas_edges}）")
    print(f"  孤立节点      : {len(isolated)}")
    print(f"  连通分量      : {len(comps)}")
    for c in comps[:6]:
        print(f"      [{len(c):3}点] " + "、".join(sorted(x.split('·')[-1] for x in c)[:7])
              + ("…" if len(c) > 7 else ""))
    if len(comps) > 6:
        print(f"      … 另有 {len(comps)-6} 个碎片")
    print(f"  最大连通块占比: {len(big)}/{len(nodes)} = {len(big)/len(nodes)*100:.1f}%")
    print(f"  两点可达率    : {reachable}/{tot} = {reachable/tot*100:.2f}%")
    print()
    print("  —— 重建前基线：42 边 / 0.87% 覆盖 / 5.69% 可达 ——")
    print("=" * 72)
    if isolated:
        print("\n  仍孤立的节点（需额外挂载）：")
        for n in sorted(isolated)[:40]:
            print(f"      · {n}")
        if len(isolated) > 40:
            print(f"      … 另有 {len(isolated)-40} 个")
    return comps, isolated


def to_mermaid(edge_info, nodes):
    lines = ["graph LR"]
    for (a, b), info in sorted(edge_info.items()):
        an, bn = a.replace("·", "_"), b.replace("·", "_")
        label = f"{info['minutes']:g}"
        lines.append(f'    {an}["{a}"] ---|{label}| {bn}["{b}"]')
    return "\n".join(lines)


if __name__ == "__main__":
    adj, nodes, edge_info, re_, me_ = build()
    stats(adj, nodes, edge_info, re_, me_)
    if "--mermaid" in sys.argv:
        out = os.path.join(HERE, "..", "docs", "campus_graph.mmd")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            f.write(to_mermaid(edge_info, nodes))
        print(f"\n  mermaid 已输出：{os.path.abspath(out)}")
