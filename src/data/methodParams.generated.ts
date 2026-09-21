/**
 * ⚠️ 生成文件 —— 由 scripts/compile_method_params.py 从 data/method_kb.db 编译而来。
 * 手改无效：下次编译会被覆盖。要改参数请改 scripts/method_kb_data.py 里对应条目的
 * parameters 字段，然后重跑 `python scripts/compile_method_params.py`。
 *
 * 每个值的出处见 `_meta.provenance`（哪个条目 / 哪个参数键 / 证据等级）。
 */

export const METHOD_PARAMS = {
  _meta: { generated_at: "2026-09-20 20:31", source: "data/method_kb.db", hint_count: 42 },
  blocks: { "studyDurations": [25, 50], "focusMin": 25, "breakMin": 5, "deepBlockMin": 90, "maxDeepBlocksPerDay": 3, "maxConsecutiveBlockMin": 90, "maxNewConceptsPerBlock": 5, "reviewIntervalsDays": [1, 3, 7, 15, 30], "dailyReviewCapMin": 30, "minSleepHours": 7, "napMin": 20, "napMaxMin": 30, "ultradianCycleMin": 90, "ultradianBreakMin": 15, "examSprintLeadDays": 14, "examMockIntervalDays": 3, "examMinMockCount": 3, "examErrorTaxonomy": ["knowledge", "careless", "time", "comprehension"], "habitExpectDays": 66, "mcmTotalHours": 72, "mcmDecideTopicByHour": 12, "mcmWritingBlockHours": 20, "mcmSleepMinHours": 5 },
  byPhase: { "any": ["working-memory-limit", "cognitive-load-theory", "spacing-effect", "retrieval-practice", "interleaving", "deliberate-practice", "generation-effect", "desirable-difficulty", "elaborative-interrogation", "dual-coding", "sleep-memory-consolidation", "circadian-chronotype", "ultradian-rhythm", "self-determination-theory", "flow", "implementation-intentions", "habit-formation-loop", "procrastination-regulation", "pomodoro", "time-blocking", "deep-work", "eisenhower-matrix", "cornell-notes", "zettelkasten", "feynman-technique", "sq3r", "spaced-repetition-tool", "note-taking-active", "environment-design", "metacognitive-monitoring", "science-math-method", "engineering-method", "humanities-method", "mcm-playbook", "mcm-3day-timeline", "literature-search", "experiment-design", "team-project-management"], "期末": ["stress-performance", "exam-strategy", "mock-exam-analysis"] },
  byTask: { "cet": ["spacing-effect", "retrieval-practice", "interleaving", "generation-effect", "stress-performance", "spaced-repetition-tool", "exam-strategy", "mock-exam-analysis"], "final-exam": ["spacing-effect", "retrieval-practice", "interleaving", "deliberate-practice", "generation-effect", "elaborative-interrogation", "sleep-memory-consolidation", "stress-performance", "feynman-technique", "spaced-repetition-tool", "exam-strategy", "mock-exam-analysis", "metacognitive-monitoring", "science-math-method", "humanities-method"], "grad-school": ["spacing-effect", "retrieval-practice", "deliberate-practice", "sleep-memory-consolidation", "deep-work", "zettelkasten", "spaced-repetition-tool", "exam-strategy", "mock-exam-analysis", "metacognitive-monitoring", "science-math-method", "literature-search"], "mcm": ["deliberate-practice", "elaborative-interrogation", "deep-work", "zettelkasten", "feynman-technique", "science-math-method", "engineering-method", "mcm-playbook", "mcm-3day-timeline", "literature-search", "experiment-design", "team-project-management"], "guangdianbei": ["engineering-method", "experiment-design", "team-project-management"] },
  hints: [
    { "slug": "working-memory-limit", "title": "工作记忆只有 4 个左右的槽位", "summary": "同时能主动处理的信息单元极少，超出就会漏。学不动往往是「超载」，不是「笨」。", "tier": "C", "status": "verified" },
    { "slug": "cognitive-load-theory", "title": "认知负荷理论：先降无关负荷，再谈努力", "summary": "学习效果差常常来自「呈现方式」而非「内容难度」；先把无谓的负荷砍掉。", "tier": "C", "status": "verified" },
    { "slug": "spacing-effect", "title": "间隔效应：分散学比集中学记得久", "summary": "同样总时长，拆成多次、拉开间隔，长期记忆显著更好。", "tier": "A", "status": "verified" },
    { "slug": "retrieval-practice", "title": "检索练习（测试效应）：考自己比再读一遍强", "summary": "主动回忆一次，胜过被动重读多次；重读会制造「我懂了」的错觉。", "tier": "A", "status": "verified" },
    { "slug": "interleaving", "title": "交错练习：把不同类型的题混着做", "summary": "同类型题连着刷会「手感很好、考试就废」；混着练更接近真实考试。", "tier": "B", "status": "verified" },
    { "slug": "deliberate-practice", "title": "刻意练习：练自己最弱、且有反馈的那部分", "summary": "重复已经会的不是练习，是舒适。进步发生在「略超出能力、且有纠正反馈」的区间。", "tier": "B", "status": "verified" },
    { "slug": "generation-effect", "title": "生成效应：自己造出来的记得更牢", "summary": "由自己生成答案（而非读现成答案）的记忆更持久。", "tier": "B", "status": "verified" },
    { "slug": "desirable-difficulty", "title": "合意困难：学得「有点费劲」才记得牢", "summary": "让学习变简单（划重点、重读、连刷同类题）会降低长期保持。适度困难反而有益。", "tier": "B", "status": "verified" },
    { "slug": "elaborative-interrogation", "title": "精细追问：不停问「为什么」", "summary": "对事实追问「为什么是这样、和我知道的有什么联系」，能显著提升记忆与理解。", "tier": "C", "status": "verified" },
    { "slug": "dual-coding", "title": "双重编码：文字配结构图，别重复别堆砌", "summary": "同一信息同时用言语与视觉两条通道编码，记忆更强。", "tier": "C", "status": "verified" },
    { "slug": "sleep-memory-consolidation", "title": "睡眠是记忆的固化时段，不是可牺牲的", "summary": "熬夜刷夜学到的内容，第二天记住的远少于睡够的人。", "tier": "B", "status": "verified" },
    { "slug": "circadian-chronotype", "title": "找到你的高效时段，把硬骨头放进那里", "summary": "人的认知峰值随时间不同（晨型/夜型）；把最难的任务排在个人峰值段，收益最大。", "tier": "C", "status": "verified" },
    { "slug": "ultradian-rhythm", "title": "注意力有约 90 分钟的起伏周期", "summary": "专注不是越久越好；一个深度周期后应有短暂休整，否则效率陡降。", "tier": "C", "status": "verified" },
    { "slug": "self-determination-theory", "title": "自我决定论：自主、胜任、归属决定内在动机", "summary": "当学习满足「我自己选的、我做得到、有人一起」三条时，动机最稳。", "tier": "B", "status": "verified" },
    { "slug": "flow", "title": "心流：难度与能力匹配时最投入", "summary": "任务太难会焦虑、太易会无聊；调到略超能力一点点最容易进入专注状态。", "tier": "C", "status": "verified" },
    { "slug": "implementation-intentions", "title": "实施意图：如果…就…比「我要努力」管用", "summary": "把计划写成具体的 if-then（何时何地做什么），执行率显著提高。", "tier": "B", "status": "verified" },
    { "slug": "habit-formation-loop", "title": "习惯靠重复与稳定情境，而非意志力", "summary": "在固定情境里重复，行为会逐渐自动化；平均需要约 66 天，个体差异很大。", "tier": "B", "status": "verified" },
    { "slug": "procrastination-regulation", "title": "拖延是情绪调节问题，不是时间管理问题", "summary": "拖的不是没时间，是一想到就难受。解法是降低启动痛苦，而非再加一个番茄钟。", "tier": "B", "status": "verified" },
    { "slug": "growth-mindset", "title": "成长型思维：能力可增长（但别神化它）", "summary": "相信能力可通过努力提升，有助于面对挫折——但它的实际效应比流行说法小得多。", "tier": "C", "status": "contested" },
    { "slug": "stress-performance", "title": "耶克斯-多德森定律：适度紧张最好，过度就崩", "summary": "唤醒水平太低（走神）或太高（慌）都不利于表现；中等偏高最优。", "tier": "C", "status": "verified" },
    { "slug": "pomodoro", "title": "番茄工作法：25 分钟专注 + 5 分钟休息", "summary": "把长任务切成短专注单元，降低启动门槛、维持节奏。", "tier": "D", "status": "verified" },
    { "slug": "time-blocking", "title": "时间块：给每件事预占一段日历", "summary": "不是列待办，而是把任务放到具体时段；能看见时间去哪了。", "tier": "D", "status": "verified" },
    { "slug": "deep-work", "title": "深度工作：一段无人打扰的高强度专注", "summary": "同样 2 小时，无干扰的深度工作产出远高于随时被打断的状态。", "tier": "D", "status": "verified" },
    { "slug": "eisenhower-matrix", "title": "四象限：先分轻重缓急，再动手", "summary": "按重要、紧急两维把任务分类，避免被紧急但不重要的事淹没。", "tier": "D", "status": "verified" },
    { "slug": "cornell-notes", "title": "康奈尔笔记：一页分栏，逼出主动加工", "summary": "把笔记页分成线索、笔记、总结三栏，复习时遮住笔记用线索自我提问。", "tier": "D", "status": "verified" },
    { "slug": "zettelkasten", "title": "卡片盒笔记：通过链接让知识长成网络", "summary": "把每条想法写成独立卡片并互相链接，形成可复用的思考网络。", "tier": "D", "status": "verified" },
    { "slug": "feynman-technique", "title": "费曼技巧：讲给外行听，卡住处就是漏洞", "summary": "用自己的话把概念讲到外行能懂，讲不通的地方就是你其实没懂的地方。", "tier": "D", "status": "verified" },
    { "slug": "sq3r", "title": "SQ3R：带着问题读教材", "summary": "浏览、提问、精读、复述、复习五步，把被动阅读变成主动提取。", "tier": "C", "status": "verified" },
    { "slug": "spaced-repetition-tool", "title": "间隔重复软件：把复习节奏交给算法", "summary": "Anki 类工具按遗忘曲线安排复习，把「什么时候复习」这件事自动化。", "tier": "B", "status": "verified" },
    { "slug": "exam-strategy", "title": "应试三板斧：真题驱动 + 错题本 + 模考", "summary": "以真题定方向，以错题定重点，以模考定节奏。", "tier": "C", "status": "verified" },
    { "slug": "mock-exam-analysis", "title": "模考后必须做卷面分析，不然白考", "summary": "模考的价值在复盘：超时分布、错因归类、策略调整。", "tier": "D", "status": "verified" },
    { "slug": "note-taking-active", "title": "笔记要加工不要搬运", "summary": "抄板书是低效的；把笔记写成自己的话、问题与联系才有价值。", "tier": "C", "status": "verified" },
    { "slug": "environment-design", "title": "环境设计：让好行为更容易、坏行为更麻烦", "summary": "改变环境比改变意志力省力：把手机放远、把书放近。", "tier": "C", "status": "verified" },
    { "slug": "metacognitive-monitoring", "title": "元认知：知道自己哪里不会最值钱", "summary": "学习最大的陷阱是以为会了。定期自测校准判断，把时间投到真正不会的地方。", "tier": "B", "status": "verified" },
    { "slug": "science-math-method", "title": "理科：定义→定理→例题→推导的闭环", "summary": "理科不是背结论，是能把结论推出来、并知道它从哪来。", "tier": "C", "status": "verified" },
    { "slug": "engineering-method", "title": "工科：从问题出发，边做边建直觉", "summary": "工科靠做出来：动手、仿真、调参、失败修正的循环。", "tier": "C", "status": "verified" },
    { "slug": "humanities-method", "title": "文科：读—议—写，三件事都要练", "summary": "文科能力体现在理解与表达：会读（提取论点）、会议（批判）、会写（结构化论证）。", "tier": "C", "status": "verified" },
    { "slug": "mcm-playbook", "title": "数学建模打法：抽象→假设→建模→求解→验证→论文", "summary": "数模考的不是会不会某个模型，是把开放问题变成可解模型并说清楚的能力。", "tier": "D", "status": "verified" },
    { "slug": "mcm-3day-timeline", "title": "数模 3 天赛程：时间线怎么分", "summary": "3 天不是写论文三天，而是选题、建模、求解、写作四条线并行。", "tier": "D", "status": "verified" },
    { "slug": "literature-search", "title": "文献检索：三层漏斗找得又快又准", "summary": "先用关键词铺开，再用引文追溯收窄，最后按质量筛选。", "tier": "C", "status": "verified" },
    { "slug": "experiment-design", "title": "实验设计：变量、对照、误差三者缺一不可", "summary": "好的实验能排除其他解释；差的实验只能产生一个数字。", "tier": "C", "status": "verified" },
    { "slug": "team-project-management", "title": "竞赛团队：分工要按能力类型，不按人头", "summary": "团队效率取决于角色是否覆盖建模、计算、写作、统筹，而非人多。", "tier": "D", "status": "verified" },
  ],
} as const;

export type MethodParams = typeof METHOD_PARAMS;