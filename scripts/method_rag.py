# -*- coding: utf-8 -*-
"""
方法论库 · 独立检索层（Method KB retrieval）
=============================================
与 `scripts/rag.py`（上理知识库）**完全分离**，原因写在 `docs/method-kb-plan.md`：
  1. 时效性语义相反 —— 上理库"越新越好"，方法库"经典不衰减"；
  2. 路由阈值不能共用 —— 否则学习类问题会污染上理库的"知识库边界"判定；
  3. chunk 粒度不同 —— 方法要保结构（原理/步骤/参数），不能像通知那样细切；
  4. 可信度分级是另一套 —— evidence_tier（A元分析…D专家经验）。

对外接口：
  search(query, k=5)      -> list[dict]   混合检索（FTS5 BM25 0.4 + 向量 0.6）
  build_index()           -> None         重建 seg_text / entries_fts / chunks
  thresholds()            -> (high, low)  独立门限

命令行：
  python scripts/method_rag.py build
  python scripts/method_rag.py search "理科怎么学" 5
"""
import os, re, sys, io, json, sqlite3, struct
import numpy as np

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "..", "data", "method_kb.db")

# 向量模型缓存固定（与 rag.py 共用同一份缓存，避免重复下载 95MB）
os.environ.setdefault("FASTEMBED_CACHE_PATH",
                      os.path.join(os.path.expanduser("~"), ".workbuddy", "cache", "fastembed"))

# ---------- 独立门限 ----------
# ⚠️ 与上理库的 0.68/0.56 **不是一套**。
#
# 【标定史】
# v1（2026-09-20，42 条时）：HIGH 0.60 / LOW 0.50 —— 实测库内命中区间 0.599-0.746，
#    库外 0.363-0.436，空档取 0.50。
# v2（2026-10-06，161 条时）：**数据量翻了近4 倍，原标定失效**。重测50 条金标：
#    库内 top1 raw **最低 0.5807**（参加竞赛要提前练什么）／**库外最高 0.5018**（奖学金怎么申请）。
#    → 新空档 [0.5018, 0.5807]，LOW 取中点 **0.54**（略偏保守侧，宁可多拒也不错召）。
#    HIGH 从 0.60 提到 **0.62**：0.60 之下已出现库内命中，HIGH 失去区分意义。
#
# ⚠️ 后续若再扩库，**必须重跑这个标定**（库外最高与库内最低会随数据量上移），
#    否则 rejection_acc 会静默退化 —— 这正是v2 扩库时m-out-04 掉到 0.5018 的原因。
METHOD_RAW_HIGH = float(os.environ.get("METHOD_RAW_HIGH", "0.62"))
METHOD_RAW_LOW = float(os.environ.get("METHOD_RAW_LOW", "0.54"))


def thresholds():
    return METHOD_RAW_HIGH, METHOD_RAW_LOW


# ---------- 伪科学黑名单守门 ----------
# 方法库的立场（docs/method-kb-plan.md）：伪科学迷思**不入库**，但也不允许检索层
# 「顺手」召回近邻条目给它们背书 —— 2026-09-20 金标基线实测：5 条迷思查询的
# top1 raw_vec落在 0.52–0.60（恰在 0.50 门限之上的灰区），会漏进对话注入层。
# 故在检索入口加确定性词卫兵：命中即拒答（返回空），由对话层走「不背书 + 纠正」口径。
#
# 🔴 v2（2026-10-06）扩充 18 → 29 词，覆盖五类新领域与 v2 拒收清单：
#   · 习惯类：21 天养成、速成习惯、「习惯需要21天」等**新发现的迷思**
#   · 自控类：意志力训练/肌肉化、血糖耗竭说
#   · 目标类：速记法、超级记忆术
#   · 情绪类：创造力训练法（包装成科学的企业培训话术）
#   · 决策类：决策胃（两餐之间做决策）—— 有争议的流行说法，也按迷思处理
# ⚠️ **本清单是唯一允许「扩张」的方向**（红线：伪科学一律不入库，新发现的迷思补进黑名单）。
PSEUDO_PATTERNS = [
    # ---- v1 存量（2026-09-20，18 词）----
    "右脑", "左脑", "全脑开发", "量子波动", "学习风格", "视觉型", "听觉型",
    "触觉型", "莫扎特", "大脑利用率", "大脑潜能", "百分百大脑", "学习金字塔",
    "金字塔理论", "七天速成", "速成班", "速成课", "过目不忘",
    # ---- v2 新增（2026-10-06）----
    "21天养成", "21 天养成", "习惯只要21天", "习惯只要 21 天",
    "速成习惯", "习惯速成", "超级记忆术", "速记法",
    "意志力训练", "意志力肌肉", "血糖耗竭", "耗竭意志",
    "创造力训练法", "决策胃", "两餐之间做决策", "补充葡萄糖提高意志力",
    # 🔴 词形变体（2026-10-06 台架抓出）：黑名单是**字面匹配**，
    #   所以口语里的不同说法必须各自成词，否则守门形同虚设。
    #   实证：m-adv-13「补充葡萄糖能不能提高意志力」与m-adv-15「两餐之间最适合做重要决策」
    #   因词形不匹配而**未被拦下** —— 新判据 pseudo_block_acc 立刻报红。
    "补充葡萄糖", "提高意志力", "两餐之间", "最适合做重要决策",
]


def is_pseudoscience(query):
    """伪科学迷思判定（确定性词面匹配，宁枉勿纵——误伤率由金标集盯着）。"""
    if not query:
        return False
    return any(p in query for p in PSEUDO_PATTERNS)


# ---------- 库外守门：方法库的职责边界（确定性词面，2026-10-06 v2） ----------
# 🔴 为什么需要它（实测数据，不是预想）：
#   向量阈值无法区分「高相似度的伪库外」。2026-10-06 实测：
#     · 明显无关：明天天气 0.414 / 食堂有什么 0.337 / 吃什么补铁 0.421 → 低于 LOW，天然拒答
#     · 高相似伪库外：考研数学大纲考哪几章 0.577 / 帮我写Python 代码 0.585 / 四级多少分及格 0.541
#       —— 这些查询里**确实含有方法论概念**（大纲=计划、代码=任务、四级=考试），
#       向量分数甚至高过很多真库内问题（库内最低 0.5807），阈值**必然失效**。
#   但方法库**不该**回答它们：前者要学科内容，后者是编程任务，后者是事实查询。
#   库与库的分工是产品契约（方法=怎么做；上理库=是什么；空间库=在哪；健康库=生理）：
#   属于其他库职责的问题，本库一律不答 —— 这就是「宁缺毋滥」。
#
# ⚠️ 词表纪律：**只加"确定属于其他库/不属于方法"的词**，
#   不得加入任何方法论术语（否则会误伤真库内查询）。误伤由金标盯着。
OUT_OF_SCOPE = [
    # ---- 学科具体内容（属上理库/课程内容）----
    "大纲", "考哪几章", "哪几章", "考纲", " syllabus", "教材第几章",
    # ---- 编程/技术实现（属编程任务，不属方法论）----
    "写一段代码", "写代码", "帮我写", "这段代码", "函数怎么写", "报错怎么",
    # ---- 事实型查询（属上理库/服务端数据）----
    "多少分及格", "多少分算", "及格线", "绩点是",
    # ---- 行政流程（属服务端数据/行政系统）----
    "怎么申请", "在哪申请", "申请流程", "需要哪些材料",
    # ---- 生活服务（属空间库/服务查询）----
    "天气怎么样", "带伞", "食堂有什么", "哪个窗口", "奶茶店", "快递在哪",
    # ---- 消费决策（不属本库）----
    "买哪一款", "买什么", "哪个牌子",
]
# 🔴 注意：「怎么申请」这类词若被金标里的方法论提问命中会误伤，
#   故这里加了下面的反向豁免 —— 含方法论信号词时不触发库外守门。
SCOPE_EXEMPT = [
    "方法", "怎么学", "怎么练", "怎么改", "怎么提高", "如何学", "如何练",
    "习惯", "拖延", "意志", "专注", "记忆", "复习", "计划", "目标",
    "坚持", "动力", "焦虑", "时间", "效率",
]


def is_out_of_scope(query):
    """方法库职责边界判定：属于其他库/非方法论的问题，本库拒答。

    与 is_pseudoscience 独立：前者是「说法不对」，本者是「问题不该我答」。
    两者都命中时返回拒答，但纠正口径不同（前者给纠正，后者直接不答）。
    """
    if not query:
        return False
    # 反向豁免：句子里出现方法论信号词时，视为库内问题
    if any(k in query for k in SCOPE_EXEMPT):
        return False
    return any(p in query for p in OUT_OF_SCOPE)


# ---------- 伪科学纠正口径（对话层，2026-09-20 P3①） ----------
# 检索层拒答只解决「不给背书」，对话层若沉默，用户带着迷思离开。
# 故对命中迷思的提问返回**确定性纠正文案**（本文件常量，不检索、不让 LLM 自由发挥），
# 由 server/app.py 注入 LLM 提示词（【纠正口径】块）并在响应体打 study_pseudo 标记。
# 引用事实均来自 docs/method-kb-plan.md 的 REJECTED 清单依据，禁止在此之外编造文献。
_PSEUDO_FACTS = {
    "右脑": "「右脑开发/左右脑分工学习」没有科学依据：左右脑通过胼胝体实时协同，不存在「右脑型学习者」。",
    "左脑": "「左脑理性、右脑感性」是把裂脑研究过度简化：健康大脑两侧全程协同，不存在单独开发的半脑。",
    "全脑开发": "「全脑开发」类课程无实证支持，早被学界定性为营销概念。",
    "量子波动": "「量子波动速读」违反基础物理与认知科学，纯属骗局。",
    "学习风格": "「学习风格匹配」（视觉型/听觉型分型施教）经系统综述证伪：匹配教学不提升成绩，学习者自评风格与实际学习效果相关性极弱。",
    "视觉型": "「视觉型/听觉型学习者分型施教」经系统综述证伪：按自评风格匹配教学不提升成绩。",
    "听觉型": "「视觉型/听觉型学习者分型施教」经系统综述证伪：按自评风格匹配教学不提升成绩。",
    "触觉型": "「动觉型/触觉型学习者分型施教」经系统综述证伪：按自评风格匹配教学不提升成绩。",
    "莫扎特": "「莫扎特效应」被后续元分析推翻：古典乐对智力的提升微弱且短暂，与音乐无关，本质是短暂的唤醒与情绪效应。",
    "大脑利用率": "「人只用了 10% 大脑」是流传最广的神经科学谣言：脑成像显示全脑均有持续活动，没有闲置的 90%。",
    "大脑潜能": "「唤醒沉睡的大脑潜能」类说法是营销话术，脑成像显示全脑均有持续活动。",
    "百分百大脑": "「开发百分百大脑」是营销话术：脑成像显示全脑均有持续活动，不存在待解锁的隐藏算力。",
    "学习金字塔": "「学习金字塔留存率（听讲5%/教别人90%…）」的数字没有任何实证来源，原文出处缺失，是教育技术领域著名的以讹传讹；但「教别人/主动输出效果好」这一**方向**本身有检索练习与生成效应支持。",
    "金字塔理论": "「学习金字塔留存率」的数字没有任何实证来源，是教育技术领域著名的以讹传讹。",
    "七天速成": "技能习得没有「七天速成」：认知技能需要分散练习与足够累积时长，速成承诺与刻意练习研究相悖。",
    "速成班": "技能习得没有速成捷径：需要分散练习与足够累积时长，速成承诺与刻意练习研究相悖。",
    "速成课": "技能习得没有速成捷径：需要分散练习与足够累积时长，速成承诺与刻意练习研究相悖。",
    "过目不忘": "「过目不忘」不是可训练出的能力：记忆靠编码深度与重复检索巩固，不存在一次性刻入的捷径。",
    # ---- v2 新增：纠正口径同样必须给（否则拒答了却无话可说）----
    "21天养成": "「21 天养成习惯」不是实验结论：它源自 1960 年《Psycho-Cybernetics》里「新外观适应约 21 天」的观察，被简化成了习惯养成结论。实测研究中位数约 59-66 天，个体范围可从数周到一年以上。",
    "习惯只要21天": "「习惯只要 21 天」没有实证支持。习惯形成时间的个体差异极大，21 天通常还远未自动化。",
    "习惯只要 21 天": "「习惯只要 21 天」没有实证支持。习惯形成时间的个体差异极大，21 天通常还远未自动化。",
    "速成习惯": "习惯没有速成路径：自动化靠情境一致的重复累积，绕过重复就绕过了机制本身。",
    "习惯速成": "习惯没有速成路径：自动化靠情境一致的重复累积，绕过重复就绕过了机制本身。",
    "超级记忆术": "「超级记忆术」类速记技巧无可靠证据；记忆效果取决于编码深度与间隔检索，不是记法花活。",
    "速记法": "「速记法」类技巧无可靠证据；记忆效果取决于编码深度与间隔检索，不是记法花活。",
    "意志力训练": "把意志力当成可训练的肌肉缺乏稳固支持：该模型未通过 23/36 实验室的预注册复制，且训练迁移有限。更可靠的做法是改环境与线索，而不是练意志力。",
    "意志力肌肉": "把意志力当成可训练的肌肉缺乏稳固支持：该模型未通过 23/36 实验室的预注册复制，且训练迁移有限。更可靠的做法是改环境与线索，而不是练意志力。",
    "血糖耗竭": "「自控消耗血糖」的解释已被推翻：只漱口碳水溶液（不吞咽）即可恢复自控表现，而血糖并未变化——起作用的是甜味奖赏的动机效应。",
    "耗竭意志": "「意志力被耗尽」是未获预注册复制支持的模型（36 实验室 N=3531，确认性 d=0.06不显著）。别把执行失败归因于意志力见底。",
    "创造力训练法": "把某个课程包装成「创造力训练法」不改变其缺乏实证的事实；创造力相关训练的效果在研究中很小且不稳定。",
    "决策胃": "「两餐之间（决策胃）最适合做决策」源自一篇有严重方法学争议的论文，后续未能重复，不应作为决策安排的依据。",
    "两餐之间做决策": "「两餐之间最适合做决策」源自一篇有严重方法学争议的论文，后续未能重复，不应作为决策安排的依据。",
    "补充葡萄糖提高意志力": "补充葡萄糖提高自控的说法已被推翻：相关效应可由只漱口（不吞咽）碳水溶液复现，血糖未变，故不是代谢机制。",
    "补充葡萄糖": "「补充葡萄糖提高自控」的说法已被推翻：相关效应可由只漱口（不吞咽）碳水溶液复现，血糖未变，起作用的是甜味奖赏的动机效应而非代谢机制。",
    "提高意志力": "靠吃糖「提高意志力」不成立：只漱口碳水溶液（不吞咽）即可恢复自控表现而血糖未变，是甜味奖赏的动机效应。想提升执行力更可靠的是改环境与线索。",
    "两餐之间": "「两餐之间最适合做重要决策」（决策胃）源自一篇有严重方法学争议的论文，后续未能重复，不应作为决策安排的依据。",
    "最适合做重要决策": "「两餐之间最适合做重要决策」（决策胃）源自一篇有严重方法学争议的论文，后续未能重复，不应作为决策安排的依据。",
}
_PSEUDO_ALT = ("经实证支持的正路是：间隔重复（1/3/7/15/30 天复习节奏）、检索练习（合上书自测）、"
               "交错练习（混着练而非分块刷）、足够睡眠（记忆巩固发生在睡眠中）。")


def _pseudo_facts(query):
    """命中的迷思事实列表（去重保序）。伪科学纠错共用的取材函数。"""
    if not query:
        return []
    facts, seen = [], set()
    for p in PSEUDO_PATTERNS:
        if p in query:
            f = _PSEUDO_FACTS.get(p)
            if f and f not in seen:
                seen.add(f)
                facts.append(f)
    return facts


def pseudo_correction(query):
    """对伪科学查询返回【纠正口径】提示块；未命中返回空串。纯函数、确定性。

    文案只陈述可核查的否定事实 + 给出实证替代路径，不编造具体文献条目
    （「系统综述/元分析」为定性表述，与 REJECTED 清单的核实记录一致）。
    """
    facts = _pseudo_facts(query)
    if not facts:
        return ""
    lines = ["【纠正口径】用户的问题涉及以下缺乏科学依据的说法，回答时必须先温和纠正，再讲正路："]
    lines += [f"- {f}" for f in facts]
    lines.append("纠正后转向实证方法（只许引用下述方向，不得编造具体论文）：" + _PSEUDO_ALT)
    lines.append("语气要求：不嘲笑用户，先接住再纠正；这些说法流行很广，不知道很正常。")
    return "\n".join(lines)


def pseudo_correction_plain(query):
    """纠正口径的用户直读版 —— extractive 降级路径（无 LLM）时直接拼进回答。"""
    facts = _pseudo_facts(query)
    if not facts:
        return ""
    lines = ["先纠正几个流传很广、但没有科学依据的说法："]
    lines += [f"- {f}" for f in facts]
    lines.append("经实证支持的正路是：" + _PSEUDO_ALT)
    return "\n".join(lines)


# ---------- 口语化查询扩展（确定性映射，非模型改写） ----------
# 2026-09-20 金标实测：m-edge-06「完全提不起学习的劲」召不回动机类条目——
# 条目正文是术语（自我决定/内驱力/拖延调控），口语与术语向量距离太远。
# 解法：命中口语模式时在查询尾部**追加领域术语**（只影响检索，不改写原句）。
# 伪科学判定在扩展**之前**做（对原始 query），扩展词不会绕过黑名单。
#
# 🔴 v2（2026-10-06）新增的纪律 —— **每组扩展都必须自证不劫持既有金标**：
#   扩库后 m-edge-06 被 `micro-habit-start`（0.6233）抢走了 top1，压过
#   self-determination-theory。原因是「提不起劲」同时命中了「任务启动」类词，
#   而微习惯条目的正文恰好全是启动动作。→ 教训：**扩展词必须限定语境**，
#   不能把「启动方法」类术语塞进「动机缺失」类查询。
COLLOQUIAL_EXPAND = [
    # ---- 学习动机域（v1，保留原样：已验证不劫持 m-normal-14）----
    # ⚠️ v2 修正：原映射含「任务启动」。扩库后该词让 `micro-habit-start`
    #    在 m-edge-06 上以 0.6233 抢到 top1，压过 self-determination-theory。
    #    「提不起劲」问的是**动机**，不是启动方法 → 去掉「任务启动」，
    #    换成更贴近动机的术语，并把优先级词放在前面。
    (re.compile(r"提不起(学习的?)?劲|没(有)?(学习)?动力|不想学|学不进去|学不动|摆烂|躺平|颓了"),
     "学习动机 内驱力 自我决定论 自我决定 任务厌恶"),
    (re.compile(r"记不住|背了就忘|忘得快|记不牢"),
     "记忆巩固 间隔重复 检索练习"),
    (re.compile(r"坐不住|静不下心|分心|走神|专注不下来"),
     "专注 深度工作 认知负荷"),
    (re.compile(r"拖延|赶不完|不到截止不动"),
     "拖延调控 实施意图 任务分解"),
    (re.compile(r"临时抱佛脚|考前(慌|冲刺|突击)"),
     "备考规划 模考 间隔复习"),

    # ---- 习惯养成域（v2 新增，2 组）----
    # 语境闸门：只问「坚持不下来/中断/没养成」时触发；
    # 若句子在问「为什么学了记不住」，含 记不住/背了 语境则**不触发**（防劫持记忆类查询）。
    # 「总失败/老失败/就是做不到」是「想养成 X 习惯总失败」这类问法的核心表述，
    # 必须与「坚持不下来」同组——否则该句只会命中下面的「养成…习惯」组而拿不到中断处理语义。
    (re.compile(r"坚持不下来|总是坚持|半途而废|三分钟热度|戒不掉|总失败|老失败|就是做不到|坚持不了"),
     "习惯中断处理 中断协议 重新开始 线索稳定性"),
    (re.compile(r"养成.{0,4}习惯|养成.{0,4}作息|早起|早睡|规律作息"),
     "习惯形成 情境稳定 习惯叠加 锚点设计"),

    # ---- 目标/执行/情绪域（v2 追加，依据 126 条金标实测的 miss 清单）----
    # 每组都对应一条实测 miss，且追加的术语是该miss 的**正解条目所用词**。
    (re.compile(r"越催我|别人越.{0,3}越|催我|被要求做"),
     "心理抗拒 自主感 外部压力 反作用"),
    (re.compile(r"完成了就不|做完就不|达成后.{0,3}不想|成功之后"),
     "目标梯度后重置 达标后动力重置 下一个目标"),
    (re.compile(r"错过截止|赶不上|总是迟到|拖到最后"),
     "实施意图 时间规划 规划谬误 提前量"),
    (re.compile(r"脑子转不动|转不动|脑子不转|脑子糊|脑子不够用"),
     "工作记忆 认知负荷 专注 深度工作"),
]

# 🔴 上下文排除词：命中这些词时，上面对应的扩展被抑制。
#    ⚠️ key 必须与 COLLOQUIAL_EXPAND 里的 **完整扩展词串逐字一致**——
#    第一版这里写成了前缀 "记忆巩固"，而循环里用的是整个 kw 串，
#    导致闸门静默失效（字典查找 miss），m-normal-14 被劫持到间隔重复条目。
#    这类「键写错就不报错」的比对，必须有金标盯着才暴露。
INHIBIT_CONTEXT = {
    "记忆巩固 间隔重复 检索练习": re.compile(r"抽象|概念|原理|理解"),
    "习惯中断处理 中断协议 重新开始 线索稳定性": re.compile(r"记不住|背了就忘|忘得快|记不牢|抽象|概念|原理|理解"),
    "习惯形成 情境稳定 习惯叠加 锚点设计": re.compile(r"记不住|背了就忘|忘得快|记不牢"),
    "心理抗拒 自主感 外部压力 反作用": re.compile(r"记不住|背了就忘|抽象|概念|原理"),
    "目标梯度后重置 达标后动力重置 下一个目标": re.compile(r"记不住|背了就忘|抽象|概念"),
    "实施意图 时间规划 规划谬误 提前量": re.compile(r"记不住|背了就忘|抽象|概念|原理|理解"),
    "工作记忆 认知负荷 专注 深度工作": re.compile(r"习惯|坚持|养成"),
}


def _inhibit_gate_check():
    """自检：INHIBIT_CONTEXT 的每个 key 必须真实存在于 COLLOQUIAL_EXPAND 的扩展词串中。
    返回失配的 key 列表（空 = 全部匹配）。供探针与单测调用，防止上面那类静默失效复发。
    """
    kws = {kw for _, kw in COLLOQUIAL_EXPAND}
    return [k for k in INHIBIT_CONTEXT if k not in kws]


def expand_query(q):
    """口语模式命中时返回追加术语后的查询串；未命中原样返回。确定性、无外部调用。

    🔴 每组扩展都有**语境收窄**机制（`INHIBIT_CONTEXT`）：
      问题是关于「记忆机制本身」时（记不住/背了就忘/抽象概念），
      不追加习惯与启动类术语 —— 否则会把答案劫持到习惯条目。
      2026-09-20 金标 m-normal-14 与 2026-10-06 扩库后的 m-edge-06 两次实测都验证了这个必要性。
    """
    extra = []
    for pat, kw in COLLOQUIAL_EXPAND:
        if pat.search(q or ""):
            inhibit = INHIBIT_CONTEXT.get(kw)
            if inhibit and inhibit.search(q or ""):
                continue
            extra.append(kw)
    if not extra:
        return q
    return q + "。" + "。".join(extra)


# ---------- 中文分词（与 rag.py 一致的领域词表，另加学习科学术语） ----------
import jieba
jieba.setLogLevel(60)
_METHOD_WORDS = [
    "间隔重复", "检索练习", "交错练习", "刻意练习", "合意困难", "生成效应", "精细追问",
    "认知负荷", "工作记忆", "心流", "实施意图", "习惯回路", "元认知", "自我决定论",
    "成长型思维", "耶克斯多德森", "昼夜节律", "超日节律", "睡眠巩固",
    "番茄钟", "时间块", "深度工作", "康奈尔", "费曼", "错题本", "模考", "真题",
    "数学建模", "敏感性分析", "文献检索", "实验设计", "对照组", "控制变量",
]
for w in _METHOD_WORDS:
    jieba.add_word(w)


def seg(text):
    if not text:
        return ""
    return " ".join(jieba.cut(text))


_TOK_KEEP = re.compile(r"[0-9A-Za-z\u4e00-\u9fff]")


def fts_query(query):
    """jieba 分词 → FTS5 安全查询串（与 rag.py 同规则：单 token 加引号，丢纯标点）"""
    parts = []
    for t in jieba.cut(query or ""):
        t = t.strip()
        if not t or not _TOK_KEEP.search(t):
            continue
        parts.append('"' + t.replace('"', '""') + '"')
    return " ".join(parts)


# ---------- 向量 ----------
EMBED_MODEL = "BAAI/bge-small-zh-v1.5"
QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章："
_model = None


def get_model():
    """嵌入模型实例 —— 优先**复用上理库 rag.py 已加载的同一实例**。

    两者模型相同（bge-small-zh-v1.5）。若不复用，后端会同时持有两份 95MB 模型，
    首次查询还要各加载一次。共享实例属于工程优化；**库与阈值依然完全独立**，
    这里共享的只是「把文本变向量」这台机器。
    """
    global _model
    if _model is None:
        try:
            import rag as _usst_rag
            _model = _usst_rag.get_model()
        except Exception:
            from fastembed import TextEmbedding
            _model = TextEmbedding(model_name=EMBED_MODEL)
    return _model


def embed_docs(docs, batch_size=32):
    m = get_model()
    return [v.tolist() for v in m.embed(list(docs), batch_size=batch_size)]


def embed_query(q):
    m = get_model()
    if hasattr(m, "query_embed"):
        return list(m.query_embed(q))[0].tolist()
    return list(m.embed([QUERY_PREFIX + q]))[0].tolist()


# ---------- 分块（保结构：一条条目的 summary+principle+steps 作为整体，必要时才切） ----------
def chunk_entry(row, max_len=420):
    """把一条条目拼成 1..n 个块。条目本身就是"一个完整方法"，故优先整条入一块。"""
    steps = row.get("steps") or []
    if isinstance(steps, str):
        try:
            steps = json.loads(steps)
        except Exception:
            steps = [steps]
    head = f"{row['title']}。{row.get('summary') or ''}"
    scope = row.get("scope") or ""
    abl = row.get("abilities") or ""
    body = (row.get("principle") or "")
    step_txt = "怎么做：" + "；".join(str(s) for s in steps)
    metas = []
    if scope:
        metas.append("适用：" + scope)
    if abl:
        metas.append("涉及元能力：" + abl)
    full = "。".join(x for x in [head, body, step_txt, "；".join(metas)] if x.strip())
    if len(full) <= max_len:
        return [full]
    # 超长才按标点切，且每块前置标题保证可检索
    chs = [c for c in re.split(r"(?<=[。！？；])", full) if c.strip()]
    out, cur = [], ""
    for c in chs:
        if len(cur) + len(c) <= max_len:
            cur += c
        else:
            if cur:
                out.append(cur)
            cur = c
    if cur:
        out.append(cur)
    return out or [full[:max_len]]


# ---------- 建索引 ----------
def build_index():
    conn = sqlite3.connect(DB_PATH)
    # 索引文本 = 标题 + 摘要 + 原理 +「涉及元能力：…」。
    # 把元能力名并入正文，是为了让「抽象建模怎么练」这类按元能力的提问也能召回（否则
    # 条目正文里根本不会出现这些词）。属于**有据可依**的增强，不改变条目语义。
    rows = conn.execute(
        "SELECT e.id, e.slug, e.title, e.summary, e.principle, e.steps, e.discipline_scope, "
        "COALESCE(GROUP_CONCAT(ma.name, ' '), '') AS abl "
        "FROM entries e "
        "LEFT JOIN entry_ability ea ON ea.entry_id = e.id "
        "LEFT JOIN meta_abilities ma ON ma.id = ea.ability_id "
        "WHERE e.status != 'deprecated' GROUP BY e.id"
    ).fetchall()
    if not rows:
        conn.close()
        print("[method] entries 为空，先跑 build_method_kb.py seed")
        return

    # 1) 分词列
    seg_map = {}
    for eid, slug, title, summary, principle, steps, scope, abl in rows:
        text = "。".join(x for x in [
            title, scope or "", summary or "", principle or "",
            ("涉及元能力：" + abl) if abl else ""] if x)
        s = seg(text)
        seg_map[eid] = s
        conn.execute("UPDATE entries SET seg_text=? WHERE id=?", (s, eid))
    conn.commit()

    # 2) FTS5（独立表；含 title / summary / seg_text）
    conn.execute("DROP TABLE IF EXISTS entries_fts")
    conn.execute(
        "CREATE VIRTUAL TABLE entries_fts USING fts5(title, summary, seg_text, tokenize='unicode61')"
    )
    for eid, slug, title, summary, principle, steps, scope, abl in rows:
        conn.execute(
            "INSERT INTO entries_fts(rowid, title, summary, seg_text) VALUES(?,?,?,?)",
            (eid, title, summary or "", seg_map[eid]),
        )
    conn.commit()
    n_fts = conn.execute("SELECT count(*) FROM entries_fts").fetchone()[0]

    # 3) 分块 + 向量
    conn.execute("DROP TABLE IF EXISTS chunks")
    conn.execute("""CREATE TABLE chunks(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        vec BLOB NOT NULL)""")
    docs = []
    for eid, slug, title, summary, principle, steps, scope, abl in rows:
        rec = {"title": title, "summary": summary, "principle": principle,
               "steps": steps, "scope": scope, "abilities": abl}
        for c in chunk_entry(rec):
            docs.append((eid, c))
    embs = embed_docs([d[1] for d in docs], batch_size=32)
    for (eid, c), v in zip(docs, embs):
        conn.execute("INSERT INTO chunks(entry_id, chunk_text, vec) VALUES(?,?,?)",
                     (eid, c, struct.pack(f"{len(v)}f", *v)))
    conn.commit()
    conn.close()
    print(f"[method] FTS5 {n_fts} 条｜向量块 {len(embs)} 个（{len(embs[0])} 维）✅")


def _row_to_dict(r):
    (eid, slug, type_, domain, scope, title, summary, principle, steps,
     params, app_when, contra, tier, citation, status) = r
    def _j(x, d):
        try:
            return json.loads(x) if x else d
        except Exception:
            return d
    return {
        "id": eid, "slug": slug, "type": type_, "domain": domain,
        "discipline_scope": scope, "title": title, "summary": summary,
        "principle": principle, "steps": _j(steps, []),
        "parameters": _j(params, {}), "applicable_when": _j(app_when, {}),
        "contraindications": contra or "", "evidence_tier": tier,
        "citation": _j(citation, {}), "status": status,
    }


def _abilities_of(conn, entry_id):
    return [{"id": a, "name": n, "role": role} for a, n, role in conn.execute(
        "SELECT ea.ability_id, ma.name, ea.role FROM entry_ability ea "
        "JOIN meta_abilities ma ON ma.id = ea.ability_id WHERE ea.entry_id=?", (entry_id,)
    ).fetchall()]


def search(query, k=5, top_fts=20, top_vec=20):
    """混合检索。**无时效衰减**（区别于上理库）；deprecated 不进索引。

    伪科学迷思查询（is_pseudoscience）直接拒答：检索层不给任何条目，
    守「不给伪科学背书」的产品红线。
    """
    if is_pseudoscience(query) or is_out_of_scope(query):
        return []
    # 口语化扩展只作用于检索（FTS + 向量）；门限判定与伪科学守门仍用原始语义
    query_eff = expand_query(query)
    conn = sqlite3.connect(DB_PATH)

    # 1) FTS5 关键词
    fts_hits = {}
    try:
        q = fts_query(query_eff)
        if q:
            for r in conn.execute(
                "SELECT rowid, bm25(entries_fts) AS score FROM entries_fts "
                "WHERE entries_fts MATCH ? ORDER BY score LIMIT ?", (q, top_fts)
            ):
                fts_hits[r[0]] = -r[1]
    except Exception as e:
        print(f"[method] FTS5 检索失败（降级为仅向量）: {e!r}", file=sys.stderr)

    # 2) 向量语义
    qv = np.asarray(embed_query(query_eff), dtype=np.float32)
    qn = float(np.linalg.norm(qv))
    if qn > 0:
        qv = qv / qn
    vec_rows = conn.execute("SELECT id, entry_id, vec FROM chunks").fetchall()
    vec_entry, chunk_cos, best_chunk = {}, {}, {}
    if vec_rows:
        ids = np.array([r[0] for r in vec_rows])
        eids = np.array([r[1] for r in vec_rows])
        mat = np.frombuffer(b"".join(r[2] for r in vec_rows), dtype=np.float32).reshape(len(vec_rows), -1)
        sims = mat @ qv
        chunk_cos = {int(ids[i]): float(sims[i]) for i in range(len(ids))}
        for i in np.argsort(-sims)[:top_vec]:
            cid, eid, s = int(ids[i]), int(eids[i]), float(sims[i])
            if eid not in vec_entry or s > vec_entry[eid]:
                vec_entry[eid] = s
                best_chunk[eid] = cid

    # 3) 归并（FTS 0.4 / 向量 0.6），无时效因子
    def norm(d):
        if not d:
            return {}
        mx = max(d.values()) or 1
        return {k: v / mx for k, v in d.items()}
    nf, nv = norm(fts_hits), norm(vec_entry)
    merged = {eid: 0.4 * nf.get(eid, 0) + 0.6 * nv.get(eid, 0) for eid in set(nf) | set(nv)}
    ranked = sorted(merged.items(), key=lambda x: -x[1])[:max(k * 3, k)]

    out = []
    for eid, score in ranked:
        r = conn.execute(
            "SELECT id, slug, type, domain, discipline_scope, title, summary, principle, "
            "steps, parameters, applicable_when, contraindications, evidence_tier, citation, status "
            "FROM entries WHERE id=?", (eid,)
        ).fetchone()
        if not r:
            continue
        d = _row_to_dict(r)
        d["score"] = round(score, 4)
        d["raw_vec"] = round(vec_entry.get(eid, 0.0), 4)
        cid = best_chunk.get(eid)
        d["snippet"] = (conn.execute("SELECT chunk_text FROM chunks WHERE id=?", (cid,)).fetchone() or [""])[0] \
            if cid else (d["summary"] or "")
        d["abilities"] = _abilities_of(conn, eid)
        out.append(d)
    conn.close()
    return out[:k]


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "search"
    if cmd == "build":
        build_index()
    elif cmd == "search":
        q = sys.argv[2] if len(sys.argv) > 2 else "理科怎么学"
        k = int(sys.argv[3]) if len(sys.argv) > 3 else 5
        hi, lo = thresholds()
        print(f"查询：{q}  （门限 high={hi} low={lo}）\n" + "=" * 56)
        for i, it in enumerate(search(q, k), 1):
            print(f"\n[{i}] {it['title']}  score={it['score']} raw_vec={it['raw_vec']} [{it['evidence_tier']}/{it['status']}]")
            print(f"    {it['summary']}")
    else:
        print("用法: python method_rag.py build | search \"查询\" [k]")
