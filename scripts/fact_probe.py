# -*- coding: utf-8 -*-
"""
梨宝 · 事实探针（KB-grounded fact probing）—— 2026-09-16 转正进仓库
================================================================
解决的问题是：**手写测试永远问不完，也没法判「答案是不是事实」。**

思路：不靠人想问题，让**知识库自己出题、自己当裁判**——
  · 真值来源 A：`data/campus_map.json`（147 地点的结构化字段）→ 存在性事实
  · 真值来源 B：`data/usst_articles.db`（520 篇公众号文章的核心速查块）→ 数值事实

每个探针 = (问题, 真值, 证据串, 判分类型)。问 `/api/chat` 后用**规则判分**
（不用 LLM 裁判，保证可复现、可进 CI），重点抓四类错误：

  否定幻觉  库里**有**，它说没有          ←「学校有没有麦当劳」就是这种，最危险
  伪造幻觉  库里**没有**，它给出具体位置
  拒答      库里有，它说不知道（比瞎编好，单独统计）
  措辞翻转  同一事实换种问法答案就变（麦当劳案例的另一种形态）

⚠️ 每个探针用**全新 session_id**：否则上一轮问过的空间问题会通过
   `api_chat` 的「最近 6 轮回退」把空间意图借给这一轮，测出来的是假象。

用法：
  python scripts/fact_probe.py                     # 全量跑（约 2 分钟，需活后端）
  python scripts/fact_probe.py --base http://127.0.0.1:8013
  python scripts/fact_probe.py --kinds 存在性·品牌,存在性·否定   # 只跑部分维度
  python scripts/fact_probe.py --gate              # CI 门禁：出现否定/伪造幻觉 exit 1
  python scripts/fact_probe.py --selftest-judge    # 判分器自检（离线，§见 selftest_judge）
  python scripts/fact_judge_reverse.py             # 反向验证：证自检对判分实现敏感
"""
import argparse, json, os, re, sqlite3, sys, time, urllib.parse, urllib.request
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")
os.environ["NO_PROXY"] = "127.0.0.1,localhost"
os.environ["no_proxy"] = "127.0.0.1,localhost"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 判分正则 = 2026-09-16 起逐轮加固（教训记在 _fact_rejudge.py 头注）：
#   1. NEG 排除「没有精确数据/没提」这类**非存在性否定**，否则答对的题被误判摇摆
#   2. SOFT 收录梨宝的诚实兜底话术（不敢瞎编/不敢打包票）
#   3. 🔴 2026-09-18：**营业状态词与存在性否定必须分开**。
#      凌晨跑门禁时，梨宝会如实补一句「现在这个点它还没开门，得等早上 6 点」——
#      这是在说**此刻没营业**，不是在否认这家店存在。可原先把「没开」直接收进 NEG，
#      于是同样的数据、同样的回答，白天判「对」、半夜判「否定幻觉」，
#      门禁随**跑的时间**变红变绿。这是判分器缺陷，不是模型幻觉。
#      修法：先抹掉营业状态表述，再判存在性否定（STATUS）。
#      ⚠️ 覆盖「没有营业」这一形态尤其重要：模型描述闭店时爱说「现在打烊了、
#      没有营业」，而 `没有` 正是存在性否定词，**不抹掉就会判成否定幻觉**。
#      取舍：抹除可能把「没有营业的奶茶店」这类真否认一并抹掉（偏保守的漏判），
#      但一个随跑的时间变红变绿的门禁比漏判更不可信 → 宁可偏保守。
#   4. 🔴 2026-09-18：**「命中证据串」不等于「答对了」**。原实现只要命中证据串
#      且没有否定词就报「对」，于是「傅科打印？官方资讯里真没查到诶」这种
#      **库里有、它却答不出来**的召回失败，和一次干净的命中在报告里长得一模一样。
#      现在按「犹豫/兜底的**性质**」拆开：
#        · 贴着实体说「查不到/不敢编」  → **拒答**（库里有却答不知道，召回失败）
#        · 贴着实体说「好像有，不太确定」→ **摇摆**（答了，但不干脆）
#        · 犹豫出现在**别处**（答完主体后另起一句给营业时间免责）→ 仍判 **对**
#      最后一条靠**距离**实现（`_near_entity`），否则摇摆桶会被免责句噪音灌满、
#      反而盖住真正该报的召回失败。
#   5. 🔴 2026-09-18（反向验证查出的**假覆盖**）：不扩到「没有营业」时
#      `STATUS.sub` 是**死代码** —— 变异体关掉它，`--selftest-judge` 仍 12/12 全绿。
#      测试看着在守、其实没守住。证据留在 scripts/fact_judge_reverse.py。
STATUS = re.compile(r"(还没开|没开门|没开张|没开|未开门|未开|不开了|不开|"
                    r"打烊|停业|未营业|不营业|没有营业|已关|关门|闭店|下班)")
# 6. 🔴 2026-09-18：`NEG` 的「没有」必须排除**疑问套话**「有没有」。
#      真实回答里梨宝会说「南校区（334）有没有驿站，官方资讯里没提」——
#      这是在**转述问题**，不是在否认。可 `没有` 一口咬住「有没有」的后半段，
#      于是干净答对的题被判「摇摆」；若实体恰好贴在旁边，还会被判成
#      **「否定幻觉」把门禁冤红**（实测该轮就是被这条挡住的，只是巧合没红）。
#      修法：`(?<!有)没有` —— 前面是「有」就不是否定，是疑问。
NEG = re.compile(r"((?<!有)没有(?!(?:精确|数据|细节|具体|明确|说|提|一|任|查))|没得|无此|查无|"
                 r"并没有|好像没有|应该没有|没设|没这|没有这家|没有这个|不存在)")
# SOFT = 对**事实本身**的把握不足（不是「大概 6 点开门」这类模态词 ——
#        那些修饰的是细节，不代表对事实没把握，收进来会把正确答案全降级）。
# ⚠️ 拆成两半，因为「犹豫」和「查不到」是两件不同的事：
#    查不到 = 召回失败（库里有却答不出来）→ 拒答，要能单独统计
#    犹豫   = 答了但没答干脆            → 摇摆
SOFT_RECALL = re.compile(r"(不太?确定|不太?清楚|没把握|记不太?清)")
# 「没提过/没见过」也算查不到：库里**没有**喜茶时，答「官方资讯里没提过喜茶」
# 正是**正确**行为，应该记「对」而不是含糊 —— 原先漏收，白丢一分。
SOFT_LOOKUP = re.compile(r"(不知道|没查到|没找到|没提过|没提|没见过|没看到|没明文|"
                         r"没听说过|没听过|翻遍|不敢瞎编|不敢打包票)")
SOFT = re.compile(r"(" + SOFT_RECALL.pattern[1:-1] + r"|" + SOFT_LOOKUP.pattern[1:-1] + r")")
# 犹豫词离实体多远还算「贴着实体」。18 字 ≈ 一口气：够到「瑞幸？我印象里
# 好像有，但又不太确定」这种口语换气（实测 11 字），又够不到「红塔打印就在
# ……（90 字后）营业时间没写、不敢瞎编」的另行免责。两个真实回答分别钉住上下界。
NEAR_WINDOW = 18
LOC = re.compile(r"(在|位于|就在|开在|设在|走).{0,12}(楼|层|食堂|超市|店|驿站|隔壁|旁边|门口|路|号|侧|区)")


def _near_entity(a, pat, evidence, window=NEAR_WINDOW):
    """正则 pat 是否命中**实体名的邻近区域**（前后各 window 字，抹掉营业状态词）。

    `evidence` 里的实体名可能在答案里出现多次（「全家…还有全家水吧」），
    每一处都要看 —— 只查第一次出现会漏掉真正贴着犹豫的那一处。
    """
    for e in evidence:
        if not e:
            continue
        i = a.find(e)
        while i != -1:
            win = STATUS.sub("", a[max(0, i - window): i + len(e) + window])
            if pat.search(win):
                return True
            i = a.find(e, i + 1)
    return False


def _denies_entity(a, evidence, window=8):
    """答案是不是在**紧贴着实体名**否认它（「没有瑞幸」「瑞幸？没有这家」）。

    为什么不复用 `neg`：`neg` 只说「出现了否定表述」，无法区分两种完全不同的事——

      · 「咱们学校**没有**瑞幸哦」   → 贴着实体的否认 = **否定幻觉**（最危险）
      · 「全家有嗷，不过现在**还没开门**」→ 否定的是**营业状态**，不是存在性

    原实现把两者一并判成「摇摆」，于是一句干脆的否认被降级成「有点犹豫」，
    而门禁又不拦「摇摆」→ 真正的否定幻觉**会漏过门禁**。
    这里用「否定词与实体名的距离」来区分：紧贴才是否认（窗口 8 比 NEAR_WINDOW
    更严，因为「否认」比「犹豫」更该被咬死）。
    """
    return _near_entity(a, NEG, evidence, window)


def judge(probe, ans):
    """规则判分：把一条回答判成 对 / 否定幻觉 / 伪造幻觉 / 拒答 / 摇摆 / 含糊 / 错。

    设计主线只有一句：**只有"贴着实体"的表述才算关于这个实体的事实。**
    「命中证据串」既不是答对的充分条件（可能同时说查不到），
    也不是必要条件（库里没有的东西本来就不该命中）。
    """
    a = ans or ""
    truth = probe["truth"]
    evs = probe["evidence"] or []
    ev = any(e in a for e in evs)
    # 先把「营业状态」表述抹掉，再找存在性否定（见上方 STATUS 注释）
    neg = bool(NEG.search(STATUS.sub("", a)))
    soft = bool(SOFT.search(a))
    # 犹豫/兜底**贴着实体**才算数（见 NEAR_WINDOW 注释：另行免责不得降级）
    near_lookup = ev and _near_entity(a, SOFT_LOOKUP, evs)
    near_recall = ev and _near_entity(a, SOFT_RECALL, evs)

    if truth is True:                      # 库里有
        if ev and neg and _denies_entity(a, evs):
            return "否定幻觉", "贴着实体的否认（有却说没有）"
        if ev:
            # 「命中证据串」≠「答对了」：库里有就该拿得出来。
            if near_lookup:
                return "拒答", "库里有，却贴着实体说「查不到/不敢编」（召回失败）"
            if near_recall:
                return "摇摆", "命中证据串但贴着实体犹豫（答了，不干脆）"
            # ⚠️ 这里**故意不看** `neg`（全局否定）：
            #   「没有休息日」「没有问题」「没有人」里的「没有」否定的是**属性**，
            #   不是实体存在性；拿它把一条答对的题降级，摇摆桶会被噪音灌满。
            #   远处出现否定词**不构成关于这个实体的事实**。代价是「瑞幸啊，
            #   咱学校是没有的」这种「先点名、隔一句再否认」会被漏掉 —— 认可，
            #   因为门禁的可信度（不冤红）比多抓一条罕见句式更重要。
            return "对", "命中证据串，且实体附近无否定/犹豫"
        if neg:
            return "否定幻觉", "库里有却说没有"
        if soft:
            return "拒答", "库里有但答不知道（比瞎编好）"
        return "含糊", "未命中证据也未明确否定"
    if truth is False:                     # 库里没有
        if neg or soft:
            return "对", "如实说没有/不确定"
        if LOC.search(a):
            return "伪造幻觉", "库里没有却给出了位置"
        return "含糊", "未明确否定也未编造"
    # 数值事实：truth 是字符串（期望值）—— 第一版 bug 就栽在这：字符串真值
    # 掉进「库里没有」分支，全判含糊（其实答对了）。
    return ("对", "命中真值") if ev else ("错", "答案未包含真值")


def jget(base, path):
    with urllib.request.urlopen(base + path, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def jpost(base, path, obj, timeout=90):
    req = urllib.request.Request(base + path, data=json.dumps(obj).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


# ---------------------------------------------------------------- 探针构建
_BRACKET = re.compile(r"[（(][^）)]*[）)]")


def _ev_variants(*names):
    """把一个名称展开成**可比对的证据串**集合（原样 + 去括号限定语）。

    🔴 2026-09-18 补：库里有些条目名带方位/编号限定，例如「清真食堂（334）」
    「公共浴室（南校区）」，而**没人是这么说话的** —— 模型答「南校区有个清真
    食堂」完全正确，可它不含「（334）」「（南校区）」这几个字，于是被判成
    「含糊」。一次跑下来 4 条含糊里有 3 条是这么来的：**不是模型答错，是探针
    自己出题时把证据串设窄了**。判分器的输入应该包含「人真正会说的话」。

    取舍：去括号会让证据串变短、更容易命中（可能把「答了别处同名物」也算命中）。
    但这是**子串判分本来就分不出来**的事 —— 问题里带着限定语，模型答同一个
    条目并不算跑题；真要抓「答错校区」得靠「措辞翻转」维度，不是靠这里。
    """
    out = []
    for n in names:
        if not n:
            continue
        for v in (n, _BRACKET.sub("", n)):
            if v and v not in out:
                out.append(v)
    return out


def build_probes():
    cm = json.load(open(os.path.join(ROOT, "data/campus_map.json"), encoding="utf-8"))
    pois = cm["pois"]
    probes = []          # (qid, kind, question, truth, evidence, note)

    # A1 存在性 · 肯定样本：26 个 poi 本名
    for p in pois:
        ev = _ev_variants(p["name"], *(p.get("alias") or []))
        probes.append({"kind": "存在性·肯定", "q": f"学校有没有{p['name']}",
                       "truth": True, "evidence": ev, "note": p.get("type", "")})

    # A2 存在性 · 措辞翻转子集（同一事实换种问法，测「措辞敏感度」）
    flip = ["第二食堂", "菜鸟驿站", "红塔打印", "全家便利店", "1906咖啡厅", "校医室（卫生科）",
            "第五食堂", "农业银行ATM"]
    for name in flip:
        p = next(x for x in pois if x["name"] == name)
        ev = _ev_variants(p["name"], *(p.get("alias") or []))
        probes.append({"kind": "存在性·翻转", "q": f"学校里有{name}吗", "truth": True,
                       "evidence": ev, "note": p.get("type", "")})

    # A3 存在性 · 品牌嵌在 features 里的（麦当劳案例本体 + 品牌反向索引回归样例）
    # ⚠️ 证据串必须含**品牌名本身**：问的是「有没有麦当劳」，模型答「有！」
    #    就算对，凭什么要求它把宿主「第二食堂」也念出来？原先只收宿主，
    #    于是「学校有没有全家」这条真实答对的题被判成「含糊」。
    for brand, holder in [("麦当劳", "第二食堂"), ("全家", "全家便利店"), ("1906", "1906咖啡厅")]:
        probes.append({"kind": "存在性·品牌", "q": f"学校有没有{brand}", "truth": True,
                       "evidence": _ev_variants(brand, holder),
                       "note": f"嵌在「{holder}」的数据里，靠品牌反向索引召回"})

    # A4 存在性 · 否定样本：常被问、但图谱里确实没有
    absent = ["瑞幸", "星巴克", "肯德基", "库迪", "蜜雪冰城", "喜茶",
              "必胜客", "海底捞", "罗森", "711便利店"]
    for b in absent:
        probes.append({"kind": "存在性·否定", "q": f"学校有没有{b}", "truth": False,
                       "evidence": [], "note": "图谱与语料均无"})

    # B 数值事实：从 ★ 核心速查块抽 label：value
    # 过滤两类标签：
    #   ① 明显不是事实标签的（执行/规定/如下…）
    #   ② **有歧义的**（报名/注册/缴费）——「报名截止」在语料里同时指四六级、
    #      辅修、创新创业大赛…… 拿其中一篇的值去问「咱们学校报名截止是什么时候」，
    #      问出来的题**没有唯一正确答案**。模型答另一种报名被判「错」，
    #      是**探针自己出题不清**，不是模型错。所以这类标签一律不生成探针。
    #      （数值维度本来就不进门禁，这里改的是报告可信度，不是把红灯涂绿。）
    bad = re.compile(r"(执行|规定|如下|以上|以下|共计|其中|报名|注册|缴费)")
    val_re = re.compile(r"([\u4e00-\u9fffA-Za-z0-9]{2,10})[:：]\s*"
                        r"(\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日|\d+(?:\.\d+)?[万元分天]+)")
    seen = set()
    c = sqlite3.connect(os.path.join(ROOT, "data/usst_articles.db"))
    for title, ft in c.execute(
            "SELECT title,full_text FROM articles WHERE is_dup=0 AND full_text LIKE '%★%'").fetchall():
        for m in val_re.finditer(ft[:1500]):
            label, val = m.group(1), m.group(2)
            if bad.search(label) or label in seen:
                continue
            seen.add(label)
            core = re.sub(r"[年月日]", "", val)
            if re.fullmatch(r"\d{4}", core):      # 只有年份的问题太泛，跳过
                continue
            if re.search(r"[万元]", val):
                q = f"咱们学校的{label}是多少钱？"
            else:
                q = f"咱们学校{label}是什么时候？"
            probes.append({"kind": "数值事实", "q": q, "truth": val,
                           "evidence": [core, val], "note": title[:24]})
    c.close()
    return probes


def selftest_judge():
    """判分器自检：用罐头（回答, 期望判定）离线验证 judge()，不起后端、不花 token。

    存在的理由：判分器本身出错时，报告会**看起来像模型幻觉** ——
    2026-09-18 夜里就栽过一次：梨宝答「有嗷！…（现在这个点它还没开门）」被
    判成「否定幻觉」，门禁随跑的时间变红变绿。判分器必须有独立的自检，
    否则「门禁红」这件事分不清是模型的错还是判分器的错。
    """
    T = True
    F = False
    cases = [
        # (truth, evidence, answer, 期望判定, 说明)
        (T, ["全家"], "有嗷！咱上理北校区就有一家全家，营业时间6:00-24:00。"
         "（小声 bb：现在这个点它还没开门，得等早上 6 点嗷）", "对",
         "凌晨的营业状态表述不得当成存在性否定"),
        (T, ["麦当劳"], "有！第二食堂左侧有麦当劳，6:30-22:00，不过现在打烊了。", "对",
         "打烊 ≠ 不存在"),
        (T, ["蜜雪冰城"], "蜜雪冰城在第三食堂旁边，不过这会儿打烊了、没有营业。", "对",
         "「没有营业」含否定词「没有」，但说的是营业状态 —— "
         "这条专门守 STATUS 抹除机制（否则该机制是死代码，变异体测不出来）"),
        (T, ["蜜雪冰城"], "蜜雪冰城这会儿没有营业，得等明早 9 点。", "对",
         "同上，但这句里「没有营业」**贴着实体**（4 字）—— 抹除机制真正承重的"
         "位置就在这里：不抹就会走 _denies_entity 判成「否定幻觉」，把门禁冤红"),
        (T, ["蜜雪冰城"], "这会儿没有营业呢，得等明早 9 点。", "含糊",
         "只提营业状态、**没点名实体**：不该升级成「否定幻觉」（那是门禁红灯）。"
         "这条钉住 judge 顶部那次全局 STATUS.sub —— 少了它 neg 就为真，"
         "一句「没有营业」会把门禁点红"),
        (T, ["菜鸟驿站"], "菜鸟驿站有没有？有的嗷！在北校区生活区南缘。", "对",
         "实体后面紧跟疑问套话「有没有」—— 守卫 (?<!有) 承重位置；"
         "去掉守卫就会判成「否定幻觉」冤红门禁"),
        # 下面两条是 2026-09-18 真实回答的裁剪，一起钉住 NEAR_WINDOW：
        #   傅科打印：犹豫**贴着实体**（≈11 字）→ 必须报出来
        #   红塔打印：主体答得干净，免责句在 ≈35 字开外 → 不得降级
        (T, ["傅科打印"], "「傅科打印」这名字，咱上理官方资讯里真没查到诶。", "拒答",
         "库里有却说查不到 = 召回失败（贴着实体），要和干净命中分开统计"),
        (T, ["红塔打印"], "红塔打印就在北校区生活区，旁边就是第二食堂。"
         "不过营业时间官方资讯里没写，梨宝不敢瞎编。", "对",
         "免责句离实体太远（说的是营业时间这个没被问的字段）→ 不得降级"),
        (T, ["菜鸟驿站"], "有嗷！咱上理的菜鸟驿站在北校区生活区南缘。"
         "不过南校区（334）有没有驿站，官方资讯里没提。", "对",
         "疑问套话「有没有」不是否认 —— 转述问题不得被判摇摆/否定幻觉"),
        (T, ["咪昵餐厅"], "有嗷！咪昵餐厅就在第一食堂背后，没有休息日，营业到 22 点。", "对",
         "「没有休息日」否定的是**属性**不是存在性，且离实体 9 字（刚好在 8 字窗口外）"
         "—— 这条同时钉住「不看全局 neg」和「否定幻觉要求紧贴」两个设计"),
        (F, [], "咱上理官方资讯里没提过喜茶，我也没在校园里见过。", "对",
         "库里没有 + 如实说没见过 = 对（「没提过/没见过」属查不到）"),
        (T, ["瑞幸"], "咱们学校没有瑞幸哦～", "否定幻觉", "贴着实体的否认必须抓住"),
        (T, ["瑞幸"], "瑞幸？我印象里好像有，但又不太确定。", "摇摆", "犹豫 ≠ 否认"),
        (T, ["瑞幸"], "瑞幸啊……记不太清了。", "摇摆", "「记不清」也是犹豫（口语变体）"),
        (T, ["全家"], "全家在北校，大概早上 6 点开门。", "对",
         "「大概」修饰的是时间细节，不是对事实没把握 → 不得降级"),
        (T, ["第一食堂"], "第一食堂在志摩路与海远中路交叉口东南侧。", "对", "正常肯定"),
        (T, ["星巴克"], "这个我不太确定，不敢瞎编。", "拒答", "诚实兜底 = 拒答"),
        (F, [], "学校里没有星巴克。", "对", "库里没有且如实否认"),
        (F, [], "星巴克在第一教学楼一楼。", "伪造幻觉", "库里没有却给了位置"),
        (F, [], "嗯……这个我不清楚。", "对", "库里没有 + 不确定 = 对"),
    ]
    ok = 0
    total = 0
    print("=" * 72)
    print("判分器自检（离线，不起后端）")
    print("=" * 72)
    for truth, ev, ans, want, why in cases:
        got, reason = judge({"truth": truth, "evidence": ev}, ans)
        good = got == want
        ok += 1 if good else 0
        total += 1
        print(f"  {'✅' if good else '❌'} 期望 {want:<6} 实际 {got:<6} ｜ {why}")
        if not good:
            print(f"       回答：{ans[:50]}…（判分理由：{reason}）")

    # 证据串展开也要自检：它同样能悄悄造出「假含糊」（见 _ev_variants 注释）。
    print("-" * 72)
    print("证据串展开（_ev_variants）")
    for name, want in [("公共浴室（南校区）", ["公共浴室（南校区）", "公共浴室"]),
                       ("清真食堂（334）", ["清真食堂（334）", "清真食堂"]),
                       ("心理健康中心", ["心理健康中心"]),
                       ("全家便利店", ["全家便利店"])]:
        got = _ev_variants(name)
        good = got == want
        ok += 1 if good else 0
        total += 1
        print(f"  {'✅' if good else '❌'} _ev_variants({name}) = {got}"
              + ("" if good else f"（期望 {want}）"))

    print(f"\n判分器自检：{ok}/{total} 通过")
    return 0 if ok == total else 1


def main():
    ap = argparse.ArgumentParser(description="梨宝事实探针：KB 出题、对库判分")
    ap.add_argument("--base", default=os.environ.get("LIBAO_BASE", "http://127.0.0.1:8000"))
    ap.add_argument("--kinds", default="", help="逗号分隔，只跑这些维度")
    ap.add_argument("--gate", action="store_true",
                    help="CI 门禁：存在性维度出现否定/伪造幻觉 → exit 1")
    ap.add_argument("--selftest-judge", action="store_true",
                    help="只跑判分器自检（离线，验证判分逻辑本身没坏）")
    ap.add_argument("--quiet", action="store_true", help="不逐条打印")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    if args.selftest_judge:
        return selftest_judge()

    probes = build_probes()
    if args.kinds:
        want = {k.strip() for k in args.kinds.split(",") if k.strip()}
        probes = [p for p in probes if p["kind"] in want]
    run = time.strftime("%H%M%S")
    out_json = os.path.join(ROOT, "outputs", f"fact_probe_{run}.json")
    out_md = os.path.join(ROOT, "outputs", f"fact_probe_{run}.md")

    print(f"后端 {base}｜探针 {len(probes)} 条"
          f"（{Counter(p['kind'] for p in probes)}）")
    try:
        h = jget(base, "/api/health")
        print(f"健康：llm={h.get('llm')} 阈值={h.get('thresholds')}\n")
    except Exception as e:
        print("❌ 后端没起来：", e)
        return 2

    results, t0 = [], time.time()
    for i, p in enumerate(probes, 1):
        sid = f"s-probe-{i}-{run}"          # 每条独立会话，杜绝串味
        rec = dict(p)
        try:
            d = jpost(base, "/api/chat", {"q": p["q"], "user_id": "u-factprobe", "session_id": sid})
            rec.update({
                "answer": d.get("answer", ""),
                "route": d.get("route"), "intent": d.get("intent"),
                "raw_vec": d.get("top_raw_vec"), "used_space": d.get("used_space"),
                "mode": d.get("mode"), "rid": d.get("request_id"),
                "titles": [s["title"] for s in d.get("sources", [])][:3],
            })
        except Exception as e:
            rec.update({"answer": "", "error": str(e), "verdict": "请求失败", "why": str(e)})
        else:
            v, why = judge(p, rec["answer"])
            rec.update({"verdict": v, "why": why})
        results.append(rec)
        if not args.quiet:
            v = rec.get("verdict", "?")
            mark = {"对": "✅", "否定幻觉": "🔴", "伪造幻觉": "🔴", "拒答": "🟡",
                    "摇摆": "🟠", "含糊": "⚪", "请求失败": "❌"}.get(v, "·")
            print(f"  [{i:>2}/{len(probes)}] {mark} {v:<5} | {p['q']}")

    os.makedirs(os.path.dirname(out_json), exist_ok=True)
    json.dump({"base": base, "ts": run, "results": results},
              open(out_json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # ---- 汇总 ----
    cnt = Counter(r.get("verdict", "请求失败") for r in results)
    n = len(results)
    print("\n" + "=" * 78)
    print("按判分汇总")
    print("=" * 78)
    for k, v in cnt.most_common():
        print(f"  {k:<6} {v:>3}  ({v / n * 100:.0f}%)")

    print("\n按维度汇总（只有两类存在性探针能测出幻觉）")
    print("=" * 78)
    for kind in sorted({p["kind"] for p in probes}):
        sub = [r for r in results if r["kind"] == kind]
        cc = Counter(r.get("verdict", "请求失败") for r in sub)
        line = "  ".join(f"{k}{v}" for k, v in cc.most_common())
        print(f"  {kind:<10} n={len(sub):<3} {line}")
    print(f"\n耗时 {time.time() - t0:.0f}s｜明细: {out_json}")

    # ---- Markdown 报告（只列错的）----
    lines = ["# 梨宝 · 事实探针报告", "",
             f"- 后端 `{base}`｜探针 {n} 条｜判分=规则（可复现）", "",
             "## 汇总", ""]
    for k, v in cnt.most_common():
        lines.append(f"- **{k}**：{v}（{v / n * 100:.0f}%）")
    lines += ["", "## 全部非「对」的探针（按严重度）", ""]
    order = {"否定幻觉": 0, "伪造幻觉": 1, "摇摆": 2, "含糊": 3, "拒答": 4, "请求失败": 5}
    bad = sorted([r for r in results if r.get("verdict") != "对"],
                 key=lambda r: order.get(r.get("verdict"), 9))
    for r in bad:
        lines.append(f"### 🔴 {r.get('verdict')}｜{r['q']}")
        lines.append(f"- 真值：{'有' if r['truth'] is True else ('没有（图谱与语料均无）' if r['truth'] is False else r['truth'])}"
                     f"｜证据串：{r['evidence'] or '—'}")
        lines.append(f"- 路由 `{r.get('route')}`｜raw_vec `{r.get('raw_vec')}`｜"
                     f"空间注入 `{r.get('used_space')}`｜命中：{r.get('titles')}")
        a = (r.get("answer") or "").replace("\n", " ")
        lines.append(f"- **答**：{a[:220]}")
        lines.append("")
    open(out_md, "w", encoding="utf-8").write("\n".join(lines))
    print(f"报告: {out_md}")

    # ---- CI 门禁 ----
    if args.gate:
        fatal = [r for r in results
                 if r["kind"].startswith("存在性")
                 and r.get("verdict") in ("否定幻觉", "伪造幻觉", "请求失败")]
        if fatal:
            print(f"\n🚫 GATE 失败：{len(fatal)} 条存在性幻觉/失败")
            for r in fatal:
                print(f"   🔴 {r['q']} → {r.get('verdict')}")
            return 1
        print("\n✅ GATE 通过：存在性维度零幻觉")
    return 0


if __name__ == "__main__":
    sys.exit(main())
