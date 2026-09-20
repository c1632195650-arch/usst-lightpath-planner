# -*- coding: utf-8 -*-
"""数据库覆盖度体检：领域归类 x 全文率 x 时效性 x 高频问题命中。"""
import sqlite3, sys, re, json
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8")
DB = "data/usst_articles.db"

# 领域分类规则（关键词 -> 领域），按优先级排列
DOMAINS = [
    ("教务·选课与考试", ["选课", "退课", "补选", "考试", "期末考试", "期中", "缓考", "补考", "重修", "免修",
                  "考场", "成绩", "绩点", "学分", "查分", "四六级", "英语分级", "AB级", "普通话", "考级"]),
    ("学籍·注册与毕业", ["学籍", "注册", "入学", "报到", "毕业", "学位", "学历", "毕业证书", "结业", "转专业",
                  "休学", "复学", "退学", "转学", "延长", "学信网"]),
    ("培养方案·课程与教材", ["培养方案", "教学计划", "课程", "教材", "通识课", "选修课", "必修", "实习", "实验",
                     "毕业论文", "毕业设计", "课程设计", "教学日历", "大纲"]),
    ("奖助学金·荣誉", ["奖学金", "助学金", "励志", "国家奖学金", "上海市奖学金", "助困", "勤工助学", "助学贷款",
                 "困难补助", "学费", "减免", "三好", "优秀学生", "标兵", "评优", "先进"]),
    ("纪律·处分与申诉", ["处分", "违纪", "作弊", "申诉", "诚信", "考风", "管理规定", "违纪处理"]),
    ("体育·体测与健康", ["体测", "体质", "健康测试", "体育课", "运动会", "校运会", "篮球", "足球", "体育竞赛",
                  "长跑", "校园跑", "体育场馆", "游泳", "运动队"]),
    ("心理·咨询与危机", ["心理", "咨询", "心理健康", "抑郁", "情绪", "危机干预", "心理中心", "心理委员", "朋辈"]),
    ("生活服务·宿舍与后勤", ["宿舍", "公寓", "住宿", "床位", "空调", "水电", "维修", "食堂", "餐饮", "浴室",
                    "洗衣", "快递", "物业", "后勤", "校园卡", "一卡通", "充值", "失物", "校车", "班车"]),
    ("数字校园·信息化", ["信息化", "网络", "校园网", "wifi", "VPN", "WeLink", "邮箱", "账号", "统一身份认证",
                  "密码", "系统", "APP", "数据", "上理门户", "办事大厅"]),
    ("财务·缴费与报销", ["缴费", "收费", "报销", "发票", "财务", "银行卡", "奖助发放", "学费标准"]),
    ("就业·实习与生涯", ["就业", "招聘", "宣讲会", "双选会", "实习", "offer", "生涯", "职业规划", "简历",
                  "就业指导", "派遣", "三方协议", "报到证", "考研", "保研", "推免", "留学", "出国"]),
    ("科创·竞赛与双创", ["创新", "创业", "竞赛", "比赛", "挑战杯", "互联网+", "大创", "创新项目", "光电杯",
                  "数学建模", "电子设计", "专利", "论文发表"]),
    ("图书馆·自习与资源", ["图书馆", "借阅", "图书", "自习", "研修", "数据库", "电子资源", "查新", "学术资源"]),
    ("国际交流·港澳台", ["国际", "交流", "交换", "留学", "港澳台", "访学", "孔子学院", "出国境", "外籍"]),
    ("党团·思政与社团", ["党建", "党课", "团委", "团日", "团组织", "团员", "推优", "学生会", "社团", "志愿者",
                  "志愿服务", "思政", "主题教育", "青马"]),
    ("医疗·保险与安全", ["医保", "医疗", "保险", "体检", "疫苗", "校医院", "传染病", "安全", "消防", "防诈骗",
                  "治安", "保卫", "应急", "宿舍安全"]),
    ("校历·节假日与通知", ["校历", "放假", "寒暑假", "节假日", "开学", "通知", "调休", "补课"]),
]

# 高频新生问题 -> 期望覆盖的关键词（用于命中测试）
PROBE = {
    "选课怎么选/什么时候选": ["选课"],
    "四六级报名": ["四六级", "英语四", "英语六", "CET"],
    "奖学金评定规则": ["奖学金"],
    "体测不及格怎么办": ["体测", "体质健康"],
    "宿舍几点关门/断电": ["宿舍", "公寓"],
    "校园卡丢了怎么补": ["校园卡", "一卡通"],
    "心理咨询预约": ["心理"],
    "转专业条件": ["转专业"],
    "重修报名": ["重修"],
    "医保报销": ["医保", "医疗"],
    "图书馆借阅规则": ["借阅", "图书馆"],
    "保研推免政策": ["推免", "保研"],
    "勤工助学岗位": ["勤工助学"],
    "校园网怎么连": ["校园网", "网络"],
    "校医院在哪": ["校医院", "卫生科"],
    "快递点在哪": ["快递", "菜鸟"],
    "违纪处分申诉": ["申诉", "处分"],
    "国际交流项目": ["国际", "交换"],
}


def classify(text):
    text = text or ""
    hits = []
    for name, kws in DOMAINS:
        n = sum(1 for k in kws if k in text)
        if n:
            hits.append((n, name))
    hits.sort(reverse=True)
    return hits[0][1] if hits else "未归类"


def main():
    c = sqlite3.connect(DB)
    cur = c.cursor()
    rows = cur.execute(
        "SELECT id, account, title, pub_time, summary, full_text, source, keyword "
        "FROM articles WHERE is_dup=0"
    ).fetchall()
    print(f"主条目：{len(rows)}\n")

    stat = defaultdict(lambda: {"n": 0, "full": 0, "recent": 0, "old": 0, "noft": []})
    for rid, acc, title, pt, summ, ft, src, kw in rows:
        blob = f"{title} {summ} {(ft or '')[:3000]}"
        d = classify(blob)
        s = stat[d]
        s["n"] += 1
        has_ft = bool(ft and ft.strip())
        if has_ft:
            s["full"] += 1
        else:
            s["noft"].append((rid, acc, title))
        year = re.search(r"(20\d\d)", pt or "")
        if year and int(year.group(1)) >= 2025:
            s["recent"] += 1
        elif year:
            s["old"] += 1
        s.setdefault("src", defaultdict(int))[src or "公众号"] += 1
        s.setdefault("acc", defaultdict(int))[acc] += 1

    print(f"{'领域':<22}{'篇数':>5}{'全文':>6}{'全文率':>8}{'2025+:':>7}{'旧':>5}   来源")
    print("-" * 96)
    for d, s in sorted(stat.items(), key=lambda x: -x[1]["n"]):
        rate = s["full"] / s["n"] * 100
        flag = "❗" if s["n"] < 6 else ("⚠️" if s["n"] < 12 else "✅")
        srcs = "/".join(f"{k}{v}" for k, v in sorted(s["src"].items(), key=lambda x: -x[1]))
        print(f"{flag}{d:<20}{s['n']:>5}{s['full']:>6}{rate:>7.0f}%{s['recent']:>7}{s['old']:>5}   {srcs}")

    print("\n\n=== 高频新生问题命中测试（标题+摘要+正文前3k字）===")
    text_all = " ".join(f"{t} {s} {(f or '')[:3000]}" for _, _, t, _, s, f, _, _ in rows)
    titles = [r[2] for r in rows]
    miss = []
    for probe, kws in PROBE.items():
        hit_docs = [t for t, blob in zip(titles, [f"{t} {s} {(f or '')[:3000]}" for _, _, t, _, s, f, _, _ in rows])
                    if any(k in blob for k in kws)]
        n = len(hit_docs)
        mark = "✅" if n >= 3 else ("⚠️" if n >= 1 else "❌")
        print(f"  {mark} {probe:<22} 命中 {n} 篇")
        if n < 3:
            miss.append((probe, n, hit_docs[:3]))

    if miss:
        print("\n  --- 覆盖不足，详见报告 ---")

    # 无全文清单
    print("\n\n=== 无全文条目（按账号）===")
    noft = [r for r in rows if not (r[5] and r[5].strip())]
    byacc = defaultdict(list)
    for r in noft:
        byacc[r[1]].append(r[2])
    for acc, ts in sorted(byacc.items(), key=lambda x: -len(x[1])):
        print(f"  {acc}（{len(ts)}篇）")
        for t in ts[:4]:
            print(f"     - {t[:44]}")
        if len(ts) > 4:
            print(f"     ... 另 {len(ts)-4} 篇")

    out = {"domains": {d: {"n": s["n"], "full": s["full"], "recent": s["recent"], "old": s["old"]}
                       for d, s in stat.items()},
           "miss": [(p, n) for p, n, _ in miss]}
    json.dump(out, open("docs/_coverage_stat.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
