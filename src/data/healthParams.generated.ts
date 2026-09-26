/**
 * ⚠️ 生成文件 —— 由 scripts/compile_health_params.py 从 data/health_kb.db 编译而来。
 * 手改无效：下次编译会被覆盖。要改参数请改 scripts/health_kb_data.py 里对应条目的
 * parameters 字段，然后重跑 `python scripts/compile_health_params.py`。
 *
 * 过滤纪律：escalate（安全升级）与 contested（争议）条目**不会**出现在这里 ——
 * 它们只走对话层口径，不进确定性排程引擎。
 * 每个值的出处见 `_meta.provenance`（条目 slug / 参数键 / 证据等级）。
 */

export const HEALTH_PARAMS = {
  _meta: { generated_at: "2026-09-21 19:00", source: "data/health_kb.db", hint_count: 35, disclaimer: "以上都是普通健康成年人的通用参考区间，不能替代医生的个体判断；有基础病、正在服药、孕期或症状持续时请就医。", provenance: { "sleepMinHours": { "slug": "sleep-duration-adult", "param": "minHours", "tier": "A" }, "sleepWindowHours": { "slug": "sleep-duration-adult", "param": "windowHours", "tier": "A" }, "weeklyModerateMin": { "slug": "aerobic-150", "param": "weeklyModerateMin", "tier": "A" }, "weeklyVigorousMin": { "slug": "aerobic-150", "param": "weeklyVigorousMin", "tier": "A" }, "minimumSessionMin": { "slug": "aerobic-150", "param": "sessionMin", "tier": "A" }, "strengthDaysPerWeek": { "slug": "strength-2days", "param": "strengthDaysPerWeek", "tier": "A" }, "sedentaryBreakMin": { "slug": "move-more-sit-less", "param": "sedentaryBreakMin", "tier": "A" }, "dailyStepsTarget": { "slug": "move-more-sit-less", "param": "dailyStepsTarget", "tier": "A" }, "napMin": { "slug": "nap-hygiene", "param": "napMin", "tier": "B" }, "napMaxMin": { "slug": "nap-hygiene", "param": "napMaxMin", "tier": "B" }, "mealsPerDay": { "slug": "regular-meals-breakfast", "param": "mealsPerDay", "tier": "A" }, "saltMaxG": { "slug": "sodium-oil-limit", "param": "saltMaxG", "tier": "A" }, "addedSugarMaxG": { "slug": "added-sugar-limit", "param": "addedSugarMaxG", "tier": "A" }, "waterMlMale": { "slug": "hydration", "param": "waterMlMale", "tier": "A" }, "waterMlFemale": { "slug": "hydration", "param": "waterMlFemale", "tier": "A" }, "vegetableMinG": { "slug": "diet-guide-2022", "param": "vegetableMinG", "tier": "A" }, "dairyMinMl": { "slug": "diet-guide-2022", "param": "dairyMinMl", "tier": "A" }, "proteinGPerKgSedentary": { "slug": "protein-intake", "param": "proteinGPerKgSedentary", "tier": "C" }, "weeklyLoadIncreasePct": { "slug": "progressive-overload", "param": "weeklyLoadIncreasePct", "tier": "C" } } },
  blocks: { "sleepMinHours": 7, "sleepWindowHours": [7, 9], "weeklyModerateMin": 150, "weeklyVigorousMin": 75, "minimumSessionMin": 10, "strengthDaysPerWeek": 2, "sedentaryBreakMin": 60, "dailyStepsTarget": 6000, "napMin": 20, "napMaxMin": 30, "mealsPerDay": 3, "saltMaxG": 5, "addedSugarMaxG": 50, "waterMlMale": 1700, "waterMlFemale": 1500, "vegetableMinG": 300, "dairyMinMl": 300, "proteinGPerKgSedentary": 1.0, "weeklyLoadIncreasePct": 10 },
  byDomain: { "sleep": ["sleep-duration-adult", "sleep-regularity", "sleep-light-circadian", "caffeine-cutoff", "alcohol-not-sedative", "cbt-i-first-line", "sleep-debt-weekend", "nap-hygiene", "sleep-environment", "red-flag-insomnia"], "exercise": ["aerobic-150", "strength-2days", "move-more-sit-less", "progressive-overload", "knee-pain-training", "consistency-over-intensity", "weight-management-energy", "red-flag-exercise"], "nutrition": ["diet-guide-2022", "regular-meals-breakfast", "sodium-oil-limit", "added-sugar-limit", "hydration", "protein-intake", "no-crash-diet"], "mental": ["stress-sleep-loop", "screening-scale-not-diagnosis", "when-to-seek-help", "crisis-hotline-12356", "behavioral-activation", "mindfulness-mbsr", "social-connection", "exam-anxiety-reframe"] },
  hints: [
    { "slug": "sleep-duration-adult", "domain": "sleep", "title": "成年人每晚应睡够 7 小时以上", "summary": "7 小时是健康底线，不是『能扛住就行』。长期低于 6 小时，记忆、情绪与免疫都会掉。", "tier": "A", "status": "verified", "escalate": false },
    { "slug": "sleep-regularity", "domain": "sleep", "title": "作息要稳：起床时间的稳定性比睡够更重要的一半", "summary": "今天 7 点起、明天 11 点起，身体等于天天倒时差，睡够时长也照样累。", "tier": "B", "status": "verified", "escalate": false },
    { "slug": "sleep-light-circadian", "domain": "sleep", "title": "白天见光、睡前避强光，是最便宜的节律调节手段", "summary": "上午晒一会儿、睡前少盯亮屏，比任何助眠技巧都稳。", "tier": "B", "status": "verified", "escalate": false },
    { "slug": "caffeine-cutoff", "domain": "sleep", "title": "咖啡因有半衰期：下午之后喝，晚上还在你血液里", "summary": "『我喝咖啡照样睡得着』多数只是睡得浅，不代表没受影响。", "tier": "B", "status": "verified", "escalate": false },
    { "slug": "alcohol-not-sedative", "domain": "sleep", "title": "喝酒助眠是假的：它让你更快睡着，也让你睡得更碎", "summary": "酒精缩短入睡时间，却破坏后半夜睡眠结构，还会加重打鼾与夜尿。", "tier": "A", "status": "verified", "escalate": false },
    { "slug": "cbt-i-first-line", "domain": "sleep", "title": "长期失眠的一线方案是 CBT-I，不是安眠药", "summary": "失眠超过 3 个月且影响白天状态，该做的是认知行为治疗，不是自己加药。", "tier": "B", "status": "verified", "escalate": false },
    { "slug": "sleep-debt-weekend", "domain": "sleep", "title": "睡眠债能部分补，但补不回全部，更不能靠周末一次还清", "summary": "周末狂睡能缓解困意，恢复不了被压缩掉的认知表现。", "tier": "B", "status": "verified", "escalate": false },
    { "slug": "nap-hygiene", "domain": "sleep", "title": "午睡 20–30 分钟是恢复，超过就是负担", "summary": "小睡能提神，睡过头会睡懵，还会偷走当晚的睡意。", "tier": "B", "status": "verified", "escalate": false },
    { "slug": "sleep-environment", "domain": "sleep", "title": "睡眠环境：凉、暗、静，加上一张稳定的床", "summary": "在宿舍睡不好、换个地方更睡不着，很多时候是环境问题不是意志问题。", "tier": "C", "status": "verified", "escalate": false },
    { "slug": "pre-sleep-screen", "domain": "sleep", "title": "睡前刷手机：不是蓝光一个锅，主要是内容和兴奋", "summary": "少刷一会儿有用，但别指望戴个防蓝光眼镜就解决问题。", "tier": "C", "status": "contested", "escalate": false },
    { "slug": "red-flag-insomnia", "domain": "sleep", "title": "这些失眠信号要去看医生，不是自己调作息", "summary": "长期失眠、打鼾憋醒、白天不可抗拒地困，属于医学评估范围。", "tier": "C", "status": "verified", "escalate": true },
    { "slug": "aerobic-150", "domain": "exercise", "title": "每周至少 150 分钟中等强度有氧（或 75 分钟高强度）", "summary": "这是『最低有效剂量』，不是健身达人的标准。", "tier": "A", "status": "verified", "escalate": false },
    { "slug": "strength-2days", "domain": "exercise", "title": "每周至少 2 天力量训练，练主要肌群", "summary": "只跑步不练力量，心肺上去了，膝盖和腰会更早出问题。", "tier": "A", "status": "verified", "escalate": false },
    { "slug": "move-more-sit-less", "domain": "exercise", "title": "少坐多动：每小时起来动一动，每天 6000 步起", "summary": "久坐是独立风险因素，运动再规律也抵消不掉一整天坐着。", "tier": "A", "status": "verified", "escalate": false },
    { "slug": "progressive-overload", "domain": "exercise", "title": "循序渐进加量，别一周翻倍", "summary": "突然加量是大学生运动伤最常见的来源。", "tier": "C", "status": "verified", "escalate": false },
    { "slug": "knee-pain-training", "domain": "exercise", "title": "膝盖疼时怎么练：换低冲击，别硬扛也别完全不动", "summary": "疼的时候不逞强，但完全停练会让关节更不稳。", "tier": "B", "status": "verified", "escalate": false },
    { "slug": "exercise-timing-sleep", "domain": "exercise", "title": "睡前高强度运动：看人，别当铁律", "summary": "有人睡前跑完照样睡，有人一练就亢奋到两点。", "tier": "C", "status": "contested", "escalate": false },
    { "slug": "consistency-over-intensity", "domain": "exercise", "title": "规律压倒强度：每周 4 次温和的，好过周末一次猛的", "summary": "周末突击式运动，主要收获是酸痛和受伤风险。", "tier": "B", "status": "verified", "escalate": false },
    { "slug": "weight-management-energy", "domain": "exercise", "title": "减脂的底层公式：温和缺口 + 保住肌肉 + 睡够", "summary": "减得快的多半掉的是水和肌肉，反弹也快。", "tier": "B", "status": "verified", "escalate": false },
    { "slug": "red-flag-exercise", "domain": "exercise", "title": "运动中这些症状：立刻停下并就医", "summary": "胸痛、晕厥、喘不过气不是『练到位了』，是警报。", "tier": "A", "status": "verified", "escalate": true },
    { "slug": "diet-guide-2022", "domain": "nutrition", "title": "《中国居民膳食指南（2022）》八准则", "summary": "八个短句，覆盖了普通人 90% 的饮食问题。", "tier": "A", "status": "verified", "escalate": false },
    { "slug": "regular-meals-breakfast", "domain": "nutrition", "title": "三餐定时定量，每天吃早餐，不漏餐", "summary": "漏掉的早餐通常会在夜宵里连本带利回来。", "tier": "A", "status": "verified", "escalate": false },
    { "slug": "sodium-oil-limit", "domain": "nutrition", "title": "盐每天不超过 5 g，油 25–30 g，反式脂肪不超过 2 g", "summary": "食堂重口味是最容易被忽略的健康成本。", "tier": "A", "status": "verified", "escalate": false },
    { "slug": "added-sugar-limit", "domain": "nutrition", "title": "添加糖每天不超过 50 g，最好 25 g 以下；少喝含糖饮料", "summary": "一瓶甜饮料就能吃掉一天的糖预算。", "tier": "A", "status": "verified", "escalate": false },
    { "slug": "hydration", "domain": "nutrition", "title": "足量饮水、少量多次：男生约 1700 ml，女生约 1500 ml", "summary": "渴了才喝往往已经晚了，尤其是自习坐一整天的时候。", "tier": "A", "status": "verified", "escalate": false },
    { "slug": "protein-intake", "domain": "nutrition", "title": "蛋白质：按体重算，别靠感觉", "summary": "按体重估一个区间，比『多吃点肉』靠谱得多。", "tier": "C", "status": "verified", "escalate": false },
    { "slug": "no-crash-diet", "domain": "nutrition", "title": "极端节食、断食排毒、自行服用减肥药：不推荐", "summary": "掉秤最快的方式，通常也是反弹最快、伤身最深的方式。", "tier": "C", "status": "verified", "escalate": true },
    { "slug": "stress-sleep-loop", "domain": "mental", "title": "压力与睡眠是互相放大的环，先断哪一环都行", "summary": "越焦虑越睡不着，越睡不着越焦虑——这是回路，不是意志力问题。", "tier": "B", "status": "verified", "escalate": false },
    { "slug": "screening-scale-not-diagnosis", "domain": "mental", "title": "PHQ-9 / GAD-7 是筛查与严重度工具，不是诊断", "summary": "量表分数高说明『该去聊聊了』，不等于『你有这个病』。", "tier": "C", "status": "verified", "escalate": false },
    { "slug": "when-to-seek-help", "domain": "mental", "title": "情绪问题什么时候必须求助：持续、受损、有消极念头", "summary": "两周以上的低落 + 影响正常学习生活，就该约咨询了。", "tier": "C", "status": "verified", "escalate": true },
    { "slug": "crisis-hotline-12356", "domain": "mental", "title": "全国统一心理援助热线：12356", "summary": "有自伤自杀念头时，请立刻打这个电话，不要一个人扛。", "tier": "A", "status": "verified", "escalate": true },
    { "slug": "behavioral-activation", "domain": "mental", "title": "动起来先于好起来：行为激活的小步原则", "summary": "等心情好了再做事，往往等不到；先做一点点，心情会跟着动。", "tier": "B", "status": "verified", "escalate": false },
    { "slug": "mindfulness-mbsr", "domain": "mental", "title": "正念练习：每天 10 分钟，重在规律不在时长", "summary": "不是放空，是练习把注意力带回当下。", "tier": "B", "status": "verified", "escalate": false },
    { "slug": "social-connection", "domain": "mental", "title": "社交支持是心理健康的硬指标，不是软鸡汤", "summary": "孤独对健康的影响量级，和久坐、肥胖是同一档。", "tier": "B", "status": "verified", "escalate": false },
    { "slug": "exam-anxiety-reframe", "domain": "mental", "title": "考前紧张：把它调成备战状态，而不是当成失败预兆", "summary": "适度紧张提升表现，把它解释成『身体在帮我』比『我不行』更划算。", "tier": "B", "status": "verified", "escalate": false },
  ],
} as const;

export type HealthParams = typeof HEALTH_PARAMS;