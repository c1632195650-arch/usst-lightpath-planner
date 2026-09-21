#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
健康知识库源数据（health_kb）——纯数据模块，无外部依赖、无 IO。

定位：给「排程 + 对话」提供**面向普通成年大学生人群**的健康常识与行为方法，
覆盖四域：睡眠 / 运动 / 饮食 / 心理，外加一层**安全护栏**。

与方法库（method_kb）的分工：
  method_kb 回答「怎么学」，health_kb 回答「怎么活」。
  两者都独立成库、都不并入上理库（理由见 docs/health-kb-plan.md）。

⚠️ 三条不可逾越的红线（数据在源头上就要配合）：
  1. 不做诊断、不解释检查结果、不开药、不给剂量/处方。
  2. 红旗症状与安全条目只输出「就医/求助」口径，不给自我处理方案。
  3. 个体差异极大的数值（减重速度、蛋白质、训练量）只给**人群区间**并标注
     「有基础病/服药/孕哺/慢病者遵医嘱」，绝不给出「你应当…」的 personalized 结论。
     —— CY 的个人数据（BMI / 膝伤 / 睡眠浅）**不入库**，只走画像侧。

证据分级（与方法库一致，只是来源偏向官方指南）：
  A = 官方指南 / 权威机构共识（WHO、CDC、中国居民膳食指南、AASM 共识…）
  B = 系统综述 / RCT / 一致性实证
  C = 教科书 / 专家共识 / 常规做法
  D = 从业者经验

citation.verification（不编造引用，如实标注）：
  verified  = 本次经检索工作流找到并读到了出处
  canonical = 公认经典结论，本轮预算内未逐条复核（诚实标注，不算 verified）
  practitioner = 实践经验，无文献依据

★ 书写铁律：字符串内部一律用「」做强调，**禁止出现 ASCII 双引号**
  （历史上因此把 Python 字符串提前终止，编译失败过一次）。
"""

# ============================================================
# 一、四域 + 安全的条目
# ============================================================

def _e(
    slug, domain, type_, title, summary, principle, steps,
    parameters=None, applicable_when=None, contraindications=None,
    evidence_tier="C", citation=None, status="verified", escalate=False,
    abilities=None, tasks=None,
):
    return {
        "slug": slug,
        "domain": domain,
        "type": type_,          # principle | skill | protocol | safety
        "title": title,
        "summary": summary,
        "principle": principle,
        "steps": steps or [],
        "parameters": parameters or {},
        "applicable_when": applicable_when or [],
        "contraindications": contraindications or [],
        "evidence_tier": evidence_tier,
        "citation": citation or {"source": "", "url": "", "year": "", "verification": "canonical"},
        "status": status,       # verified | contested | deprecated
        "escalate": escalate,   # True = 命中即走就医/求助口径，不给自我处理方案
        "abilities": abilities or [],
        "tasks": tasks or [],
    }


# ---------- 域一：睡眠 ----------

SLEEP = [
    _e(
        "sleep-duration-adult", "sleep", "principle",
        "成年人每晚应睡够 7 小时以上",
        "7 小时是健康底线，不是『能扛住就行』。长期低于 6 小时，记忆、情绪与免疫都会掉。",
        "美国睡眠医学会（AASM）与睡眠研究学会（SRS）的联合共识：18–60 岁成年人每晚规律睡眠 "
        "7 小时及以上是维持健康所必需；长期短睡与心血管、代谢、认知与情绪风险上升相关。",
        [
            "先算起床时间，再倒推上床时间，留出 7–9 小时的在床窗口。",
            "把睡眠当固定日程排进去，而不是『做完事剩下的时间』。",
            "连续两周睡不够时，优先砍掉的是任务，不是睡眠。",
        ],
        parameters={"minHours": 7, "windowHours": [7, 9]},
        applicable_when=["普通健康成年人", "考试周/项目冲刺期想压缩睡眠"],
        contraindications=["确诊睡眠障碍者按医嘱执行，本条为一般人群参考"],
        evidence_tier="A",
        citation={
            "source": "AASM & SRS 联合共识《Recommended Amount of Sleep for a Healthy Adult》（SLEEP, 2015，PMID 25979105）；AASM 官网健康提示",
            "url": "https://pubmed.ncbi.nlm.nih.gov/25979105/",
            "year": "2015",
            "verification": "verified",
        },
    ),
    _e(
        "sleep-regularity", "sleep", "skill",
        "作息要稳：起床时间的稳定性比睡够更重要的一半",
        "今天 7 点起、明天 11 点起，身体等于天天倒时差，睡够时长也照样累。",
        "昼夜节律靠稳定的授时因子（起床时间、晨间光照、进餐时间）维持；作息漂移会造成"
        "『社交时差』，与代谢紊乱、日间嗜睡和情绪波动相关。",
        [
            "固定起床时间（含周末），波动尽量控制在 1 小时内。",
            "白天补觉控制在 20–30 分钟，且别安排在傍晚。",
            "前一天熬了夜，第二天仍按原时间起，靠当晚早点睡还，不要靠第二天赖床。",
        ],
        parameters={"wakeDriftMin": 60},
        applicable_when=["作息不规律", "周末报复性补觉", "早八与周末作息差异大"],
        evidence_tier="B",
        citation={"source": "昼夜节律与社交时差研究（经典文献，本轮未逐条复核）", "url": "", "year": "", "verification": "canonical"},
    ),
    _e(
        "sleep-light-circadian", "sleep", "skill",
        "白天见光、睡前避强光，是最便宜的节律调节手段",
        "上午晒一会儿、睡前少盯亮屏，比任何助眠技巧都稳。",
        "光照是昼夜节律最强的授时因子：日间充足光照提高日间警觉与夜间睡意；"
        "夜间强光（尤其近距离屏幕）抑制褪黑素分泌、推迟睡意。",
        [
            "起床后 1 小时内到户外见自然光 10–30 分钟（阴天也有效）。",
            "睡前 1 小时把环境调暗，屏幕亮度调低、尽量远离眼睛。",
            "夜里起夜别开大白灯，用低亮度小灯。",
        ],
        applicable_when=["入睡困难", "昼夜颠倒", "白天困晚上精神"],
        evidence_tier="B",
        citation={"source": "光照与褪黑素/昼夜节律研究（经典文献，本轮未逐条复核）", "url": "", "year": "", "verification": "canonical"},
    ),
    _e(
        "caffeine-cutoff", "sleep", "skill",
        "咖啡因有半衰期：下午之后喝，晚上还在你血液里",
        "『我喝咖啡照样睡得着』多数只是睡得浅，不代表没受影响。",
        "咖啡因半衰期约 5–6 小时，完全代谢更久；下午摄入会延长入睡潜伏期、减少深睡比例，"
        "且个体差异（代谢酶、耐受）很大。",
        [
            "把含咖啡因饮品（咖啡、浓茶、能量饮料、可乐、部分奶茶）排在上午。",
            "以『上床时间往前推 6 小时』作为咖啡因截止线。",
            "熬夜前灌能量饮料是借债：睡意被压住了，但认知照样掉。",
        ],
        parameters={"caffeineCutoffHours": 6},
        applicable_when=["下午仍需要咖啡/浓茶", "入睡困难", "备考冲刺"],
        contraindications=["心律失常、焦虑障碍、胃食管反流者对咖啡因更敏感，遵医嘱"],
        evidence_tier="B",
        citation={"source": "咖啡因药代动力学与睡眠研究（经典文献，本轮未逐条复核）", "url": "", "year": "", "verification": "canonical"},
    ),
    _e(
        "alcohol-not-sedative", "sleep", "principle",
        "喝酒助眠是假的：它让你更快睡着，也让你睡得更碎",
        "酒精缩短入睡时间，却破坏后半夜睡眠结构，还会加重打鼾与夜尿。",
        "酒精虽具镇静作用，但代谢过程中会引起反跳性觉醒，抑制快速眼动睡眠，"
        "并使上气道肌肉松弛加重打鼾与呼吸暂停。",
        [
            "不要用『睡前一杯』当助眠手段。",
            "如饮酒，控制量并留出代谢时间，别安排在临近入睡时。",
            "《中国居民膳食指南（2022）》：成年人如饮酒，一天酒精量不超过 15 g。",
        ],
        parameters={"alcoholMaxG": 15},
        applicable_when=["用酒精助眠", "睡前应酬"],
        contraindications=["未成年人、孕妇、乳母、慢性病患者不应饮酒", "服药期间禁酒"],
        evidence_tier="A",
        citation={
            "source": "《中国居民膳食指南（2022）》准则五（四川省卫生健康委转载）",
            "url": "http://wsjkw.sc.gov.cn/scwsjkw/jkys/2022/5/16/91e41c4ffdcf4dae8ccf0e34130a6060.shtml",
            "year": "2022",
            "verification": "verified",
        },
    ),
    _e(
        "cbt-i-first-line", "sleep", "protocol",
        "长期失眠的一线方案是 CBT-I，不是安眠药",
        "失眠超过 3 个月且影响白天状态，该做的是认知行为治疗，不是自己加药。",
        "失眠认知行为治疗（CBT-I）被列为慢性失眠的一线治疗，核心是睡眠限制、刺激控制、"
        "认知重建与放松训练，长期效果优于药物且无依赖风险。",
        [
            "睡不着时离开床做些安静的事，有困意再回床（刺激控制）。",
            "记录两周睡眠日记，把实际睡眠时间算清楚再谈怎么办。",
            "药物（含褪黑素、安眠药）属于医疗决策，交给医生，不由本助手建议。",
        ],
        applicable_when=["失眠持续 3 个月以上", "躺床清醒时间明显偏长", "正在自行长期服用助眠产品"],
        contraindications=["本条不提供具体药物方案；有抑郁/双相/呼吸暂停等共病先就医评估"],
        evidence_tier="B",
        citation={
            "source": "Wikipedia: Cognitive behavioral therapy for insomnia（一线、非药物治疗）",
            "url": "https://en.wikipedia.org/wiki/Cognitive_behavioral_therapy_for_insomnia",
            "year": "",
            "verification": "verified",
        },
    ),
    _e(
        "sleep-debt-weekend", "sleep", "principle",
        "睡眠债能部分补，但补不回全部，更不能靠周末一次还清",
        "周末狂睡能缓解困意，恢复不了被压缩掉的认知表现。",
        "短期睡眠剥夺后可出现补偿性睡眠（深睡比例上升），但注意力、反应速度与记忆巩固的"
        "损失并不能完全由一次性补觉抵消，且大补觉会进一步打乱节律。",
        [
            "平时欠的觉靠『每天多睡 30–60 分钟』还，别靠周末一次性睡到中午。",
            "补觉后仍用固定起床时间收住节律。",
            "周中要还债，先砍掉低价值任务而不是砍睡眠。",
        ],
        parameters={"repayExtraMinPerDay": [30, 60]},
        applicable_when=["周中熬夜", "周末报复性补觉"],
        evidence_tier="B",
        citation={"source": "睡眠剥夺与恢复研究（经典文献，本轮未逐条复核）", "url": "", "year": "", "verification": "canonical"},
    ),
    _e(
        "nap-hygiene", "sleep", "skill",
        "午睡 20–30 分钟是恢复，超过就是负担",
        "小睡能提神，睡过头会睡懵，还会偷走当晚的睡意。",
        "短时小睡（20–30 分钟）可改善警觉与情绪而不进入深睡；超过 30–40 分钟易出现"
        "睡眠惯性（醒后发懵），傍晚小睡还会减少夜间睡眠压力。",
        [
            "午睡设定 20–30 分钟闹钟，坐着或半躺都行。",
            "安排在午饭后至 15:00 前，尽量别晚于 15:00。",
            "晚上入睡困难的人，先取消午睡试试两周。",
        ],
        parameters={"napMin": 20, "napMaxMin": 30, "napLatestHour": 15},
        applicable_when=["下午犯困", "午休时间可利用"],
        contraindications=["夜间入睡困难者慎排午睡", "发作性睡病等按医嘱"],
        evidence_tier="B",
        citation={"source": "小睡与睡眠惯性研究（经典文献，本轮未逐条复核）", "url": "", "year": "", "verification": "canonical"},
    ),
    _e(
        "sleep-environment", "sleep", "skill",
        "睡眠环境：凉、暗、静，加上一张稳定的床",
        "在宿舍睡不好、换个地方更睡不着，很多时候是环境问题不是意志问题。",
        "核心体温下降有助于入睡，过暖的环境延长入睡时间；噪声与光线引起微觉醒；"
        "陌生环境首夜睡眠变浅（首夜效应）属正常生理现象。",
        [
            "卧室尽量偏凉、遮光，必要时用眼罩与耳塞。",
            "认床、换环境第一晚睡不好是常见现象，不要因此给自己贴『失眠』标签。",
            "床只用来睡觉，别在床上长时间刷手机或赶作业。",
        ],
        applicable_when=["宿舍噪声/光线干扰", "认床", "换环境的第一晚"],
        evidence_tier="C",
        citation={"source": "睡眠卫生与首夜效应（专家共识，本轮未逐条复核）", "url": "", "year": "", "verification": "canonical"},
    ),
    _e(
        "pre-sleep-screen", "sleep", "skill",
        "睡前刷手机：不是蓝光一个锅，主要是内容和兴奋",
        "少刷一会儿有用，但别指望戴个防蓝光眼镜就解决问题。",
        "夜间屏幕光对褪黑素的影响确实存在，但meta 分析的效应量有限；"
        "更主要的是内容与互动带来的认知唤醒（越刷越精神、越刷越焦虑）。",
        [
            "睡前 30–60 分钟停止高刺激内容（短视频、对战、群聊争执）。",
            "把手机放到伸手够不到的地方，比装 App 锁更有效。",
            "不追求『完全不碰手机』，先做到不放床头。",
        ],
        parameters={"windDownMin": 30},
        applicable_when=["睡前刷手机停不下来", "越刷越精神"],
        evidence_tier="C",
        status="contested",
        citation={"source": "屏幕光与褪黑素的证据强度存在争议（结论未统一）", "url": "", "year": "", "verification": "canonical"},
    ),
    _e(
        "red-flag-insomnia", "sleep", "safety",
        "这些失眠信号要去看医生，不是自己调作息",
        "长期失眠、打鼾憋醒、白天不可抗拒地困，属于医学评估范围。",
        "持续失眠、疑似睡眠呼吸暂停（打鼾 + 憋醒 + 日间嗜睡）、发作性睡病样症状、"
        "昼夜节律障碍等需要专业评估，靠作息技巧硬扛会延误诊治。",
        [
            "失眠 ≥3 个月且每周 ≥3 晚，并已影响白天状态 → 就医/睡眠门诊。",
            "被观察到睡眠中呼吸暂停、醒来口干头痛、白天坐着就困 → 就医评估呼吸暂停。",
            "失眠伴明显情绪低落、兴趣丧失或消极念头 → 优先心理/精神科，见心理域条目。",
        ],
        applicable_when=["长期失眠", "打鼾憋醒", "日间不可抗拒的困"],
        evidence_tier="C",
        escalate=True,
        citation={"source": "AASM 睡眠健康教育（睡眠障碍需专业评估）", "url": "https://sleepeducation.org/sleep-disorders/", "year": "", "verification": "verified"},
    ),
]

# ---------- 域二：运动 ----------

EXERCISE = [
    _e(
        "aerobic-150", "exercise", "principle",
        "每周至少 150 分钟中等强度有氧（或 75 分钟高强度）",
        "这是『最低有效剂量』，不是健身达人的标准。",
        "WHO《关于身体活动和久坐行为的指南》与《美国人身体活动指南》：成年人每周应进行"
        "至少 150 分钟中等强度，或 75 分钟高强度有氧活动，或等效组合；"
        "任何活动量都好过不动，超过最低量还有额外收益。",
        [
            "换算成日程：每天 30 分钟 × 每周 5 天，或每天 20 分钟 × 每周 7 天。",
            "判断中等强度的简单标准：能说话但不能唱歌。",
            "不必一次凑满，10 分钟一段累计同样有效。",
        ],
        parameters={"weeklyModerateMin": 150, "weeklyVigorousMin": 75, "sessionMin": 10, "sessionsPerWeek": 5},
        applicable_when=["久坐少动", "想开始规律运动", "体测/减脂期"],
        contraindications=["急性期伤病、发热、未控制的心血管疾病先咨询医生"],
        evidence_tier="A",
        citation={
            "source": "WHO 身体活动实况报道；CDC 成人活动指南（依据 HHS《美国人身体活动指南》）",
            "url": "https://www.cdc.gov/physical-activity-basics/guidelines/adults.html",
            "year": "2020",
            "verification": "verified",
        },
    ),
    _e(
        "strength-2days", "exercise", "skill",
        "每周至少 2 天力量训练，练主要肌群",
        "只跑步不练力量，心肺上去了，膝盖和腰会更早出问题。",
        "肌肉力量训练可降低全因死亡风险、改善代谢与骨密度，并提升关节稳定性、降低运动损伤风险；"
        "建议每周 ≥2 天覆盖腿、髋、背、腹、胸、肩、臂。",
        [
            "每周排 2 次，间隔至少 1 天（如周二、周五）。",
            "每个动作 2–3 组、每组 8–12 次，做到最后几次明显吃力但动作不变形。",
            "自重（深蹲、俯卧撑、弓步、平板支撑）就够起步，不必进健身房。",
        ],
        parameters={"strengthDaysPerWeek": 2, "setsPerExercise": [2, 3], "repsPerSet": [8, 12]},
        applicable_when=["只做有氧不做力量", "久坐导致核心/下肢薄弱", "想降低运动损伤风险"],
        contraindications=["急性关节疼痛期先减量并评估", "未控制的高血压避免憋气发力和大重量"],
        evidence_tier="A",
        citation={
            "source": "CDC 成人活动指南：每周 ≥2 天肌力活动，覆盖主要肌群",
            "url": "https://www.cdc.gov/physical-activity-basics/guidelines/adults.html",
            "year": "2020",
            "verification": "verified",
        },
    ),
    _e(
        "move-more-sit-less", "exercise", "skill",
        "少坐多动：每小时起来动一动，每天 6000 步起",
        "久坐是独立风险因素，运动再规律也抵消不掉一整天坐着。",
        "久坐行为与全因死亡、心血管病、肿瘤及 2 型糖尿病风险上升独立相关；"
        "打断久坐（哪怕站起来走两分钟）可改善血糖与血管功能。",
        [
            "每坐 1 小时起身活动 3–5 分钟（接水、走动、拉伸都算）。",
            "自习/写代码时把『站起来』设成可见的提醒，而不是靠意志。",
            "日常步行累计到每天 6000 步以上。",
        ],
        parameters={"sedentaryBreakMin": 60, "breakDurationMin": [3, 5], "dailyStepsTarget": 6000},
        applicable_when=["长时间自习/写代码", "课后久坐", "宿舍久躺"],
        evidence_tier="A",
        citation={
            "source": "《中国居民膳食指南（2022）》准则二（每周 5 天中等强度、每天 6000 步、减少久坐每小时动一动）；WHO 久坐行为风险说明",
            "url": "http://wsjkw.sc.gov.cn/scwsjkw/jkys/2022/5/16/91e41c4ffdcf4dae8ccf0e34130a6060.shtml",
            "year": "2022",
            "verification": "verified",
        },
    ),
    _e(
        "progressive-overload", "exercise", "skill",
        "循序渐进加量，别一周翻倍",
        "突然加量是大学生运动伤最常见的来源。",
        "组织（肌肉、肌腱、骨）适应需要时间；负荷增长过快超出组织耐受是过度使用性损伤的主要原因。",
        [
            "每周总负荷（时间 × 强度）增幅控制在 10% 左右。",
            "先加频率/时间，最后再加强度。",
            "出现持续加重的关节疼痛就降回上一档，别带痛硬扛。",
        ],
        parameters={"weeklyLoadIncreasePct": 10},
        applicable_when=["开始新的训练计划", "体测前突击训练", "假期想快速提升"],
        contraindications=["已有疼痛/肿胀部位暂停加载"],
        evidence_tier="C",
        citation={"source": "运动训练负荷管理共识（专家共识，本轮未逐条复核）", "url": "", "year": "", "verification": "canonical"},
    ),
    _e(
        "knee-pain-training", "exercise", "protocol",
        "膝盖疼时怎么练：换低冲击，别硬扛也别完全不动",
        "疼的时候不逞强，但完全停练会让关节更不稳。",
        "髌腱/髌股关节等过度使用性疼痛对『负荷管理』反应最好：短期内降低冲击性负荷、"
        "保留等长与力量训练、逐步回到原项目；疼痛持续或加重需运动医学评估。",
        [
            "疼痛期把跳跃、急停急转、深蹲深度暂时减下来。",
            "换成低冲击：固定自行车、椭圆机、游泳、直腿抬高与股四头肌等长收缩。",
            "判断标准：运动中疼痛 ≤3/10 且次日不加重可继续，否则减量。",
            "疼痛持续超过 1–2 周、肿胀、绞锁或夜间痛 → 运动医学科就诊。",
        ],
        parameters={"painThreshold": 3, "reviewDays": 14},
        applicable_when=["跑步/打球后膝痛", "下蹲或上下楼膝痛", "旧伤反复"],
        contraindications=["明显肿胀、绞锁、打软腿、外伤后不能负重 → 尽快就诊"],
        evidence_tier="C",
        citation={"source": "过度使用性肌腱病负荷管理（专家共识，本轮未逐条复核）", "url": "", "year": "", "verification": "canonical"},
    ),
    _e(
        "exercise-timing-sleep", "exercise", "skill",
        "睡前高强度运动：看人，别当铁律",
        "有人睡前跑完照样睡，有人一练就亢奋到两点。",
        "晚间高强度运动对睡眠的影响存在个体差异，meta 分析总体未显示明显负面效应，"
        "但对部分人（尤其高强度、临近就寝）会延长入睡。",
        [
            "如果发现自己睡前练完难入睡，把高强度挪到睡前 2 小时以外。",
            "晚上做拉伸、慢走这类低强度活动通常不受影响。",
            "以自身记录为准，不套用别人的经验。",
        ],
        parameters={"avoidVigorousBeforeSleepHours": 2},
        applicable_when=["睡前训练后入睡困难"],
        evidence_tier="C",
        status="contested",
        citation={"source": "晚间运动与睡眠关系的证据结论不一致", "url": "", "year": "", "verification": "canonical"},
    ),
    _e(
        "consistency-over-intensity", "exercise", "principle",
        "规律压倒强度：每周 4 次温和的，好过周末一次猛的",
        "周末突击式运动，主要收获是酸痛和受伤风险。",
        "健康收益来自长期累积的活动量；单次超大负荷在缺乏基础的人群中显著提高"
        "肌肉骨骼损伤与心血管事件风险。",
        [
            "把运动拆成小而密的固定时段，写进周计划。",
            "没时间就做 10–15 分钟版本，别整周跳过。",
            "中断后恢复时按『上次量的 60%』起步。",
        ],
        parameters={"resumeRatioPct": 60},
        applicable_when=["只有周末有空", "中断后复训"],
        evidence_tier="B",
        citation={"source": "WHO 指南：任何活动量都好过不动，动得多收益更大", "url": "https://www.who.int/news-room/fact-sheets/detail/physical-activity", "year": "2020", "verification": "verified"},
    ),
    _e(
        "weight-management-energy", "exercise", "protocol",
        "减脂的底层公式：温和缺口 + 保住肌肉 + 睡够",
        "减得快的多半掉的是水和肌肉，反弹也快。",
        "体重变化由能量缺口决定；过大缺口会加速肌肉流失与代谢适应，"
        "配合足量蛋白质与抗阻训练、充足睡眠可尽量保留瘦体重。",
        [
            "把目标定在每周减 0.5–1 kg，而不是一个月十斤。",
            "每天缺口控制在 300–500 kcal 左右，靠少吃 + 多动各承担一部分。",
            "每周称 2–3 次取趋势，别被每天的水分波动牵着走。",
            "有基础病、服药、BMI 极高或极低、进食紊乱史者 → 先咨询医生/营养师。",
        ],
        parameters={"weeklyLossKg": [0.5, 1.0], "dailyDeficitKcal": [300, 500]},
        applicable_when=["想减脂", "体重近期上升"],
        contraindications=["进食障碍史、孕哺期、慢性病或服药者需专业指导", "不建议极端节食或断食"],
        evidence_tier="B",
        citation={"source": "体重管理与能量平衡研究（经典文献，本轮未逐条复核）", "url": "", "year": "", "verification": "canonical"},
    ),
    _e(
        "red-flag-exercise", "exercise", "safety",
        "运动中这些症状：立刻停下并就医",
        "胸痛、晕厥、喘不过气不是『练到位了』，是警报。",
        "运动中出现胸痛/压榨感、晕厥或近乎晕厥、异常气短、持续心悸、单侧肢体无力或言语不清、"
        "严重头痛等，属于需要紧急医学评估的症状。",
        [
            "立即停止运动，就地休息，不要硬撑完组。",
            "胸痛持续不缓解、伴冷汗/放射到左臂下颌/恶心 → 立即呼叫急救（120）。",
            "突发的言语不清、口角歪斜、单侧无力 → 按卒中处理，立即急救。",
            "晕厥或近乎晕厥后即使缓过来，也应就医查明原因。",
        ],
        applicable_when=["运动中或运动后出现上述症状"],
        evidence_tier="A",
        escalate=True,
        citation={"source": "急救与运动医学通行处置原则（权威机构一致建议，本轮以权威机构口径为准）", "url": "", "year": "", "verification": "canonical"},
    ),
]

# ---------- 域三：饮食 ----------

NUTRITION = [
    _e(
        "diet-guide-2022", "nutrition", "principle",
        "《中国居民膳食指南（2022）》八准则",
        "八个短句，覆盖了普通人 90% 的饮食问题。",
        "一、食物多样，合理搭配；二、吃动平衡，健康体重；三、多吃蔬果、奶类、全谷、大豆；"
        "四、适量吃鱼、禽、蛋、瘦肉；五、少盐少油，控糖限酒；六、规律进餐，足量饮水；"
        "七、会烹会选，会看标签；八、公筷分餐，杜绝浪费。",
        [
            "平均每天摄入 12 种以上食物、每周 25 种以上。",
            "每天谷类食物 200–300 g（含全谷物、杂豆 50–150 g；薯类 50–100 g）。",
            "每天蔬菜不少于 300 g（深色占一半）、水果 200–350 g，果汁不能代替鲜果。",
            "每天奶及奶制品相当于 300 ml 以上液态奶；常吃全谷、豆制品，适量坚果。",
            "鱼、禽、蛋、瘦肉平均每天 120–200 g；每周吃鱼 2 次或 300–500 g，蛋类 300–350 g。",
        ],
        parameters={"foodVarietyDaily": 12, "foodVarietyWeekly": 25, "grainsG": [200, 300],
                    "vegetableMinG": 300, "fruitG": [200, 350], "dairyMinMl": 300,
                    "meatEggFishG": [120, 200]},
        applicable_when=["日常饮食安排", "食堂怎么选菜", "想吃得健康但不知从哪改"],
        evidence_tier="A",
        citation={
            "source": "中国营养学会《中国居民膳食指南（2022）》（四川省卫生健康委官方转载）",
            "url": "http://wsjkw.sc.gov.cn/scwsjkw/jkys/2022/5/16/91e41c4ffdcf4dae8ccf0e34130a6060.shtml",
            "year": "2022",
            "verification": "verified",
        },
    ),
    _e(
        "regular-meals-breakfast", "nutrition", "skill",
        "三餐定时定量，每天吃早餐，不漏餐",
        "漏掉的早餐通常会在夜宵里连本带利回来。",
        "规律进餐有助于维持稳定的血糖与食欲调节；长期不吃早餐与代谢紊乱风险上升相关，"
        "且不规律进餐常伴随夜间加餐与能量摄入超标。",
        [
            "一天三餐定时定量，不暴饮暴食、不偏食挑食、不过度节食。",
            "起床后没有胃口也至少吃点（酸奶 + 面包/鸡蛋 + 水果的极简组合）。",
            "晚间加餐尽量提前、轻量，别把晚餐当第二顿午餐。",
        ],
        parameters={"mealsPerDay": 3},
        applicable_when=["早八来不及吃早餐", "饮食时间混乱", "夜宵频繁"],
        evidence_tier="A",
        citation={
            "source": "《中国居民膳食指南（2022）》准则六（安排一日三餐，定时定量，不漏餐，每天吃早餐）",
            "url": "http://wsjkw.sc.gov.cn/scwsjkw/jkys/2022/5/16/91e41c4ffdcf4dae8ccf0e34130a6060.shtml",
            "year": "2022",
            "verification": "verified",
        },
    ),
    _e(
        "sodium-oil-limit", "nutrition", "skill",
        "盐每天不超过 5 g，油 25–30 g，反式脂肪不超过 2 g",
        "食堂重口味是最容易被忽略的健康成本。",
        "高钠摄入与高血压及心血管风险相关；烹调油与反式脂肪关系到血脂与能量密度。",
        [
            "少点重油重盐的菜，能涮水的就涮一下。",
            "加工肉制品、腌制食品、方便面/自热锅少碰。",
            "看营养标签的钠含量，同类选钠低的。",
        ],
        parameters={"saltMaxG": 5, "oilG": [25, 30], "transFatMaxG": 2},
        applicable_when=["食堂就餐为主", "爱吃重口味/加工食品"],
        contraindications=["肾病、高血压等需限钠者按医嘱执行"],
        evidence_tier="A",
        citation={
            "source": "《中国居民膳食指南（2022）》准则五（盐 ≤5 g、油 25–30 g、反式脂肪酸 ≤2 g）",
            "url": "http://wsjkw.sc.gov.cn/scwsjkw/jkys/2022/5/16/91e41c4ffdcf4dae8ccf0e34130a6060.shtml",
            "year": "2022",
            "verification": "verified",
        },
    ),
    _e(
        "added-sugar-limit", "nutrition", "skill",
        "添加糖每天不超过 50 g，最好 25 g 以下；少喝含糖饮料",
        "一瓶甜饮料就能吃掉一天的糖预算。",
        "添加糖提供空能量，与龋齿、体重增加及代谢风险相关；含糖饮料是青少年与大学生"
        "添加糖摄入的主要来源。",
        [
            "把含糖饮料换成白水、无糖茶/苏打水，不用饮料代替白水。",
            "买包装食品看配料表：白砂糖、果葡糖浆排在前面就要小心。",
            "奶茶选无糖/三分糖、少小料，频次比单次甜度更关键。",
        ],
        parameters={"addedSugarMaxG": 50, "addedSugarTargetG": 25},
        applicable_when=["常喝奶茶/含糖饮料", "爱吃甜食"],
        evidence_tier="A",
        citation={
            "source": "《中国居民膳食指南（2022）》准则五（添加糖 ≤50 g，最好 <25 g；不喝或少喝含糖饮料）",
            "url": "http://wsjkw.sc.gov.cn/scwsjkw/jkys/2022/5/16/91e41c4ffdcf4dae8ccf0e34130a6060.shtml",
            "year": "2022",
            "verification": "verified",
        },
    ),
    _e(
        "hydration", "nutrition", "skill",
        "足量饮水、少量多次：男生约 1700 ml，女生约 1500 ml",
        "渴了才喝往往已经晚了，尤其是自习坐一整天的时候。",
        "《中国居民膳食指南（2022）》给出温和气候、低身体活动水平下的成年人饮水量参考；"
        "高温、运动、出汗多时需额外补充。",
        [
            "桌上放一杯水，比记着喝水更管用。",
            "运动前后各补一次；大量出汗时补水同时注意电解质。",
            "推荐白水或茶水，不用饮料代替白水。",
        ],
        parameters={"waterMlMale": 1700, "waterMlFemale": 1500},
        applicable_when=["久坐自习", "运动出汗", "宿舍/教室忘记喝水"],
        contraindications=["心衰、肾衰等需限水者严格按医嘱"],
        evidence_tier="A",
        citation={
            "source": "《中国居民膳食指南（2022）》准则六（男 1700 ml / 女 1500 ml）",
            "url": "http://wsjkw.sc.gov.cn/scwsjkw/jkys/2022/5/16/91e41c4ffdcf4dae8ccf0e34130a6060.shtml",
            "year": "2022",
            "verification": "verified",
        },
    ),
    _e(
        "protein-intake", "nutrition", "skill",
        "蛋白质：按体重算，别靠感觉",
        "按体重估一个区间，比『多吃点肉』靠谱得多。",
        "一般成年人蛋白质需要量可按体重估算；规律抗阻训练者通常需要更高摄入以支持肌肉合成，"
        "但具体量受肾功能、总能量与训练状态影响。",
        [
            "普通成年人先按每天约 1.0 g/kg 体重估算自己的基线。",
            "规律力量训练/减脂期可上调，但别自行长期大量补充蛋白粉。",
            "优先从鱼禽蛋瘦肉、奶、豆制品里拿，食物优先于补剂。",
            "肾功能异常或有代谢疾病者必须由医生/营养师给量。",
        ],
        parameters={"proteinGPerKgSedentary": 1.0, "proteinGPerKgActive": [1.2, 1.6]},
        applicable_when=["力量训练期", "减脂期想保住肌肉", "食堂肉吃得少"],
        contraindications=["慢性肾病、肝病、痛风等需医嘱", "不建议自行长期大量使用蛋白补剂"],
        evidence_tier="C",
        citation={"source": "蛋白质需要量相关研究与膳食参考摄入量（经典结论，本轮未逐条复核）", "url": "", "year": "", "verification": "canonical"},
    ),
    _e(
        "no-crash-diet", "nutrition", "safety",
        "极端节食、断食排毒、自行服用减肥药：不推荐",
        "掉秤最快的方式，通常也是反弹最快、伤身最深的方式。",
        "极低能量摄入、完全断碳/单一食物、自行使用减重药物或泻剂，会带来肌肉流失、"
        "电解质紊乱、胆结石、月经紊乱与进食障碍风险；减重药物属医疗决策。",
        [
            "不要采用极低热量（如每天 <800 kcal）或不吃主食的极端方案。",
            "不要自行购买服用减重药、泻药、利尿剂或来源不明的『燃脂』产品。",
            "出现暴食—催吐循环、对体重过度焦虑 → 及时寻求专业帮助。",
        ],
        applicable_when=["想快速减重", "被推荐断食排毒/减肥药"],
        evidence_tier="C",
        escalate=True,
        citation={"source": "体重管理与进食障碍临床共识（专家共识，本轮未逐条复核）", "url": "", "year": "", "verification": "canonical"},
    ),
]

# ---------- 域四：心理 ----------

MENTAL = [
    _e(
        "stress-sleep-loop", "mental", "principle",
        "压力与睡眠是互相放大的环，先断哪一环都行",
        "越焦虑越睡不着，越睡不着越焦虑——这是回路，不是意志力问题。",
        "压力激活交感与下丘脑—垂体—肾上腺轴，延长入睡并浅化睡眠；睡眠不足又降低情绪调节能力，"
        "形成正反馈回路。打断任一端（睡眠或压力反应）都能减弱整体。",
        [
            "选一个切入点：要么先把作息固定两周，要么先把运动排进去。",
            "睡前把待办写下来放到明天，减少在床上『反刍』。",
            "连续两周没改善且影响日常功能 → 考虑专业咨询（见下条）。",
        ],
        applicable_when=["压力大睡不好", "考试周焦虑", "越想睡越睡不着"],
        evidence_tier="B",
        citation={"source": "压力与睡眠相互作用的实证研究（经典文献，本轮未逐条复核）", "url": "", "year": "", "verification": "canonical"},
    ),
    _e(
        "screening-scale-not-diagnosis", "mental", "principle",
        "PHQ-9 / GAD-7 是筛查与严重度工具，不是诊断",
        "量表分数高说明『该去聊聊了』，不等于『你有这个病』。",
        "PHQ-9（抑郁）、GAD-7（焦虑）是自评量表，用于筛查与评估严重程度、追踪变化，"
        "诊断必须由具备资质的专业人员结合临床访谈作出。",
        [
            "可以用量表做自我觉察与就医前的整理，不要给自己下诊断。",
            "分数提示中重度时，把它当成『预约就诊的理由』。",
            "本助手不做诊断、不解释量表分数含义之外的内容。",
        ],
        applicable_when=["想自我评估情绪状态", "犹豫要不要去心理咨询"],
        evidence_tier="C",
        citation={
            "source": "Wikipedia: Generalized Anxiety Disorder 7（用于筛查与评估严重程度的自评工具）",
            "url": "https://en.wikipedia.org/wiki/Generalized_Anxiety_Disorder_7",
            "year": "",
            "verification": "verified",
        },
    ),
    _e(
        "when-to-seek-help", "mental", "safety",
        "情绪问题什么时候必须求助：持续、受损、有消极念头",
        "两周以上的低落 + 影响正常学习生活，就该约咨询了。",
        "持续（多数日子、两周以上）的情绪低落或焦虑，伴随兴趣丧失、功能受损（上课/社交/自理"
        "明显下滑）、躯体症状或任何自伤自杀念头，都属于需要专业评估的信号。",
        [
            "明显影响上课、睡眠、进食或人际超过两周 → 预约学校心理咨询或精神/心理科。",
            "出现自伤念头、想『消失』、安排后事等 → 立即求助，不要独自扛，见危机热线条目。",
            "身边同学出现上述信号 → 陪他去，并联系辅导员/家人。",
        ],
        applicable_when=["持续情绪低落", "功能明显受损", "出现消极念头"],
        evidence_tier="C",
        escalate=True,
        citation={"source": "抑郁与焦虑的临床识别原则（权威机构一致口径，本轮未逐条复核）", "url": "", "year": "", "verification": "canonical"},
    ),
    _e(
        "crisis-hotline-12356", "mental", "safety",
        "全国统一心理援助热线：12356",
        "有自伤自杀念头时，请立刻打这个电话，不要一个人扛。",
        "国家卫生健康委发文启用 12356 作为全国统一心理援助热线电话号码，"
        "面向公众提供心理咨询与危机干预服务。",
        [
            "有自伤/自杀念头、或担心身边同学有危险时，立即拨打 12356。",
            "情况紧急（已实施自伤、身边有人要行动）同时拨打 120/110。",
            "陪同 > 劝说：陪在身边，协助联系专业人员与家人。",
        ],
        applicable_when=["自伤自杀念头", "身边同学出现危机信号"],
        evidence_tier="A",
        escalate=True,
        citation={
            "source": "中国政府网：国家卫生健康委关于应用 12356 全国统一心理援助热线电话号码的通知",
            "url": "https://www.gov.cn/zhengce/zhengceku/202412/content_6994470.htm",
            "year": "2024",
            "verification": "verified",
        },
    ),
    _e(
        "behavioral-activation", "mental", "skill",
        "动起来先于好起来：行为激活的小步原则",
        "等心情好了再做事，往往等不到；先做一点点，心情会跟着动。",
        "行为激活通过安排可执行的小目标与正反馈，打破『低落—回避—更低落』的循环，"
        "是抑郁干预中的核心行为技术之一。",
        [
            "把目标切到『今天能做完』的粒度（如：出门走 10 分钟）。",
            "做完就记录，不看完成质量，看是否发生。",
            "优先安排带来掌控感或愉悦感的活动，而不是应该做的事。",
        ],
        parameters={"dailyMicroGoalMin": 10},
        applicable_when=["提不起劲", "拖延严重", "情绪低落期"],
        evidence_tier="B",
        citation={"source": "行为激活相关研究（经典文献，本轮未逐条复核）", "url": "", "year": "", "verification": "canonical"},
    ),
    _e(
        "mindfulness-mbsr", "mental", "skill",
        "正念练习：每天 10 分钟，重在规律不在时长",
        "不是放空，是练习把注意力带回当下。",
        "正念减压（MBSR）等结构化训练在减轻压力与焦虑症状上有中等强度的证据支持，"
        "效果与练习频次稳定性相关。",
        [
            "固定时段练（起床后/睡前），每天 10 分钟优于周末一次 1 小时。",
            "从呼吸观察或身体扫描入手，走神了就回来，不评判。",
            "严重抑郁/创伤史者先咨询专业人员再自行练习。",
        ],
        parameters={"mindfulnessMinPerDay": 10},
        applicable_when=["压力大", "注意力分散", "入睡前的反刍"],
        contraindications=["精神病性症状、严重创伤史者需专业指导"],
        evidence_tier="B",
        citation={"source": "正念减压（MBSR）相关 meta 分析（经典文献，本轮未逐条复核）", "url": "", "year": "", "verification": "canonical"},
    ),
    _e(
        "social-connection", "mental", "skill",
        "社交支持是心理健康的硬指标，不是软鸡汤",
        "孤独对健康的影响量级，和久坐、肥胖是同一档。",
        "社会连接与孤独感是死亡率与心理健康的独立预测因素；主动维持少量稳定的关系，"
        "比扩大社交圈更有效。",
        [
            "每周固定一次线下共处（吃饭、走路、打球都算）。",
            "情绪低谷时明确向具体的人提出具体请求，而不是『没人懂我』。",
            "社团/班级活动不必全参加，挑能见到熟人的。",
        ],
        parameters={"weeklySocialContacts": 1},
        applicable_when=["觉得孤独", "换了新环境", "压力大不想说话"],
        evidence_tier="B",
        citation={"source": "社会连接与孤独感对健康影响的研究（经典文献，本轮未逐条复核）", "url": "", "year": "", "verification": "canonical"},
    ),
    _e(
        "exam-anxiety-reframe", "mental", "skill",
        "考前紧张：把它调成备战状态，而不是当成失败预兆",
        "适度紧张提升表现，把它解释成『身体在帮我』比『我不行』更划算。",
        "焦虑的躯体反应（心跳加快、警觉上升）与兴奋高度重叠；对唤起做『这是助力』的重新评价，"
        "比试图完全放松更利于发挥。",
        [
            "紧张时对自己说『我在备战』，并做几次缓慢呼气。",
            "考前保留固定作息与睡眠，通宵换来的熟练度抵不上状态损失。",
            "焦虑严重到影响发挥或持续存在 → 学校心理咨询。",
        ],
        applicable_when=["考前紧张", "体测/答辩/面试前"],
        evidence_tier="B",
        citation={"source": "焦虑重评（reappraisal）相关研究（经典文献，本轮未逐条复核）", "url": "", "year": "", "verification": "canonical"},
    ),
]

ENTRIES = SLEEP + EXERCISE + NUTRITION + MENTAL

# ============================================================
# 二、不入库清单（记录但不进检索，命中时给纠正口径）
# ============================================================

REJECTED_HEALTH = [
    {"slug": "rejected-detox", "title": "排毒减肥 / 断食排毒",
     "why": "身体有肝肾完成代谢，『排毒』产品与断食排毒无证据支持，且有电解质紊乱与进食障碍风险。"},
    {"slug": "rejected-fat-burn-zone", "title": "必须运动 30 分钟以上才开始燃脂",
     "why": "能量消耗从第一分钟就在发生，底物比例随强度与时间连续变化，不存在 30 分钟开关。"},
    {"slug": "rejected-sweat-detox", "title": "出汗＝排毒、汗蒸能减肥",
     "why": "汗液主要是水与电解质，减掉的是水分不是脂肪；汗蒸不带来额外脂肪消耗，且有脱水风险。"},
    {"slug": "rejected-brain-8h", "title": "每个人都必须睡够 8 小时",
     "why": "睡眠需要存在个体差异，成人共识是 7 小时及以上为健康必需，8 小时不是统一硬标准。"},
    {"slug": "rejected-supplement-stack", "title": "靠补剂/燃脂产品替代饮食与运动",
     "why": "减脂与健康的证据集中在饮食结构、活动量与睡眠；补剂只针对特定缺乏人群，且不替代生活方式。"},
    {"slug": "rejected-sauna-shaper", "title": "塑身衣、震动带、甩脂机减脂",
     "why": "局部减脂与被动器械减脂缺乏可靠证据，体重变化需能量缺口。"},
    {"slug": "rejected-melatonin-otc", "title": "长期自行服用褪黑素当安眠药",
     "why": "褪黑素主要调节节律而非普遍催眠，剂量与适应证属医疗决策；长期失眠应走 CBT-I 与评估。"},
]

# ============================================================
# 三、红旗症状表（确定性词面匹配，命中即升级）
# ============================================================

# 分两级：
#   urgent  = 立即呼叫急救（120）
#   consult = 尽快就医/专业评估
RED_FLAGS = {
    "urgent": [
        "胸痛", "胸口痛", "心绞痛", "压榨感", "喘不过气", "呼吸困难", "窒息",
        "晕厥", "晕倒", "昏倒", "意识丧失",
        "口角歪斜", "说话不清", "言语不清", "一侧无力", "半身无力", "偏瘫",
        "自杀", "想死", "不想活", "轻生", "自伤", "割腕", "跳楼", "结束生命",
        "大量出血", "呕血", "咯血", "黑便",
        "抽搐", "癫痫发作",
    ],
    "consult": [
        "心悸", "胸闷", "头晕", "头痛", "头疼", "反复头痛", "剧烈头痛",
        "体重骤降", "体重一直掉", "体重下降", "突然瘦", "瘦了很多", "不明原因消瘦", "持续发热", "低热不退",
        "便血", "血尿", "乳房肿块", "淋巴结肿大",
        "抑郁", "持续低落", "焦虑发作", "惊恐", "幻听", "幻觉",
        "进食障碍", "暴食", "催吐",
    ],
}

# 命中即判定为「求医/求药」类问题 → 拒答具体方案，转专业
DIAGNOSIS_PATTERNS = [
    "我是不是得了", "我是不是有", "帮我诊断", "确诊", "什么病",
    "吃什么药", "吃哪种药", "吃几片", "吃几粒", "用药", "剂量", "处方", "买什么药",
    "检查结果", "化验单", "体检报告", "指标异常", "ct报告", "片子",
]

# ============================================================
# 四、编译目标（构建期 → src/data/healthParams.generated.ts）
#   只编译「确定性、无医疗风险」的排程参数；contested / escalate 一律不进编译
# ============================================================

COMPILE_TARGETS = {
    "sleepMinHours": ("sleep-duration-adult", "minHours"),
    "sleepWindowHours": ("sleep-duration-adult", "windowHours"),
    "weeklyModerateMin": ("aerobic-150", "weeklyModerateMin"),
    "weeklyVigorousMin": ("aerobic-150", "weeklyVigorousMin"),
    "minimumSessionMin": ("aerobic-150", "sessionMin"),
    "strengthDaysPerWeek": ("strength-2days", "strengthDaysPerWeek"),
    "sedentaryBreakMin": ("move-more-sit-less", "sedentaryBreakMin"),
    "dailyStepsTarget": ("move-more-sit-less", "dailyStepsTarget"),
    "napMin": ("nap-hygiene", "napMin"),
    "napMaxMin": ("nap-hygiene", "napMaxMin"),
    "mealsPerDay": ("regular-meals-breakfast", "mealsPerDay"),
    "saltMaxG": ("sodium-oil-limit", "saltMaxG"),
    "addedSugarMaxG": ("added-sugar-limit", "addedSugarMaxG"),
    "waterMlMale": ("hydration", "waterMlMale"),
    "waterMlFemale": ("hydration", "waterMlFemale"),
    "vegetableMinG": ("diet-guide-2022", "vegetableMinG"),
    "dairyMinMl": ("diet-guide-2022", "dairyMinMl"),
    "proteinGPerKgSedentary": ("protein-intake", "proteinGPerKgSedentary"),
    "weeklyLoadIncreasePct": ("progressive-overload", "weeklyLoadIncreasePct"),
}

# 编译后仍需在对话层附上的「个体差异声明」（不进数值，进文案）
DISCLAIMER = "以上都是普通健康成年人的通用参考区间，不能替代医生的个体判断；有基础病、正在服药、孕期或症状持续时请就医。"
