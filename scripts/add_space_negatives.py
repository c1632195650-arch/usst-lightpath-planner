# -*- coding: utf-8 -*-
"""W6 · 玄学问句空间意图调优（否定金标，只增不改——2026-10-25）
追加 15 条否定样例：含场馆/地名字样但属闲聊/玄学的问句，期望不触发空间路由。
"""
import json
import os

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "evals", "golden",
                    "space_negative.jsonl")

ITEMS = [
    {"q": "我最近水逆怎么办", "want_space": False, "note": "玄学——无空间实体"},
    {"q": "考试拜锦鲤有用吗", "want_space": False, "note": "玄学仪式"},
    {"q": "像图书馆一样安静的地方哪里有", "want_space": True,
     "note": "边界对照：比喻式但问的是真实地点——空间意图成立（防收紧过头）"},
    {"q": "我今天运势怎么样", "want_space": False, "note": "占卜"},
    {"q": "星座水象和火象合得来吗", "want_space": False, "note": "占星"},
    {"q": "梦见考试没过是什么预兆", "want_space": False, "note": "解梦"},
    {"q": "塔罗牌抽到死神代表什么", "want_space": False, "note": "塔罗"},
    {"q": "考研拜文昌爷有用吗", "want_space": False, "note": "玄学仪式"},
    {"q": "图书馆的照片挂床头风水好吗", "want_space": False, "note": "含「图书馆」但问风水"},
    {"q": "操场跑步能不能减肥啊算命的说不行", "want_space": False, "note": "含「操场」但玄学主导"},
    {"q": "食堂阿姨算命说我这周不走运", "want_space": False, "note": "含「食堂」但是叙事闲聊"},
    {"q": "转运水晶手串在哪个教学楼开光", "want_space": True,
     "note": "边界对照：玄学词+真实地点问路——问路意图成立"},
    {"q": "今天五行缺什么", "want_space": False, "note": "五行"},
    {"q": "锦鲤壁纸能带来好运吗", "want_space": False, "note": "玄学"},
    {"q": "运动会那天黄历宜出行吗", "want_space": False, "note": "含「运动」但问黄历"},
]

os.makedirs(os.path.dirname(PATH), exist_ok=True)
existing = 0
if os.path.exists(PATH):
    with open(PATH, encoding="utf-8") as f:
        existing = sum(1 for _ in f)
with open(PATH, "a", encoding="utf-8", newline="\n") as f:
    for it in ITEMS:
        f.write(json.dumps(it, ensure_ascii=False) + "\n")
print(f"appended {len(ITEMS)} (existing {existing}) → {os.path.relpath(PATH)}")
