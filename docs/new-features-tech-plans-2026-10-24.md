# 新功能 · 具体技术方案集（工作单级）

> 生成：2026-10-24（zcode）。上游：`docs/new-features-menu-2026-10-24.md`（功能菜单与路线抉择）、`docs/refactor-and-optimization-assessment-2026-10-24.md`（前置偿债）。
> **开工前置**：`docs/execution-charter-2026-10-24.md`（执行章程）已锁定本方案集全部技术路线（§1 裁决表）、逐批界限（§3.2）、零回归判据（§4）与提交规范（§2）——执行任何 F 批前必读，批次 kickoff 按章程 §8 模板写进 BLOCKERS 首条。
> **性质**：每个功能一份可直接开工的工作单——目标 / 前置 / 逐文件改动清单 / 数据与契约 / 实现步骤 / 测试与验收 / 风险回退 / 估时与批次。全部方案遵守：红线 6（`features/libao` 与引擎唯一接缝）、契约申报制、golden 只增不改、RV 反向验证、条件展开零漂移模式（见 `src/lib/planner/schedule.ts:178-191` 既有范式）。

---

## 0. 批次总表与依赖图

| 批次 | 内容 | 估时 | 前置 |
|---|---|---|---|
| F1 | D3 数据自动更新最小版（纯服务器侧） | 2.5 天 | 无 |
| F2 | B1 引用溯源 + B2 不确定分级 | 2.5 天 | 无 |
| F3 | A1-v1 偏好学习（建议卡形态） | 2.5 天 | 偿债 D1-批1（libaoIntent 拆分）可后补 |
| F4 | A2 一键多方案 + D10 目标函数补项（合并批） | 3 天 | 偿债 D2（周视图下沉）；golden 增量快照 |
| F5 | C1 今日晨报 + C2 周报复盘 | 4 天 | 无（C2 的"最爱挪时段"统计依赖 F3 的记录字段扩展） |
| F6 | A4 场景模式 | 1.5 天 | F4 的 weights 通道 |
| F7（二批） | A3 习惯块 → D1 课表多格式 → B3 时效标注（L2 拍板）→ C3 小组件 | ~7 天 | 各自见下 |

依赖图：`F3 记录字段扩展 ─→ F5-C2 统计`；`F4 weights 通道 ─→ F6`；`F1 审核队列 ─→ F7-B3 的 effective_to 维护入口`。批次间无强制顺序（F1/F2 可与决赛材料并行）。

**本方案集涉及的契约申报点汇总**（届时写进对应 commit message）：① `BuildWeekPlanInput.weights?`（F3-v1.5/F4）② `BuildWeekPlanInput.variants?` + `BuildWeekPlanResult.variants?`（F4）③ `BehaviorRecord` 增可选 `startMin?/place?`（F3）④ `/api/chat` 响应增 `confidence`（F2，纯新增字段）⑤ `SyncState` schemaVer=3 `deadlines[]`（F5-v2，另立项）。全部为**可选字段/opt-in**，缺省 = 旧行为逐字段一致。

---

## F1 · D3 数据自动更新最小版（云上 agent 的第一步）

**目标**：服务器每天两次自动增量采集校园资讯，新条目进**人工审核队列**，批准后自动重建检索索引；token 过期自动报警且不产半截数据。
**前置**：无。纯服务器侧（`scripts/` + crontab），零前端改动，零应用行为变化。

**改动清单**：
| 文件 | 动作 | 说明 |
|---|---|---|
| `scripts/crawl_cron.py` | 新增 | 编排器：①哨兵 ②增量采集 ③入队 ④报告（见步骤） |
| `data/pending_review.jsonl` | 运行产物 | 审核队列（**选 jsonl 而非建表：零 DB 迁移**，避开 L2） |
| `scripts/review_queue.py` | 新增 | 审核 CLI：`list / show / approve <id> / reject <id>` |
| `_logs/crawl_alert.jsonl` | 运行产物 | 哨兵失败/连续零新增的告警留痕 |
| 服务器 crontab | 运维 | `17 5,17 * * * cd /opt/usst/app && .venv/bin/python scripts/crawl_cron.py`（04:17 快照 cron 已有先例） |

**实现步骤**：
1. **哨兵**：探测一条已知文章 URL（公众号路径探测搜狗 token 可用性，官网路径探测站点可达）。失败 → 写 `crawl_alert.jsonl`（时间/原因）+ 正常退出（exit 0，不产半截数据）。
2. **增量采集**：调既有 `collector.py` / `collect_web.py` 的函数级接口（import 复用，不复制逻辑），`--since` 限定近 7 天；新条目**不写 articles 表**，写 `pending_review.jsonl`：`{id, title, summary, pub_time, source_url, source_type, fetched_at}`。**合规缺省**：公众号源只存标题+摘要+链接（不落全文），官网公开栏目可存全文（沿用现状）。
3. **报告**：每次运行向 `_logs/crawl_run.jsonl` 追加一行 `{时间, 新增N, 待审M, 耗时}`；连续 3 天零新增也告警。
4. **审核 CLI**：`approve` → 复用 `dedup_db` / `clean_text` 的函数做去重清洗 → 写入 articles 表（`keyword`/`source` 填源清单）→ 跑 `python scripts/rag.py build`（17MB 库全量重建，分钟级，简单可靠）→ 更新 `data_pins.json` 计数。
5. 每周人工仪式：`review_queue.py list` 过一遍（预计 10 分钟）。

**测试与验收**：`scripts/test_crawl_queue.py`（新增，pytest）：临时库上 approve 后 articles 计数 +1 且 FTS 可检索到；reject 后不入库；哨兵失败路径（mock fetch 异常）产出 alert 且零入库。**验收**：连续 3 天 cron 运行日志干净；一次真实 approve 走通"采集→审核→重建→问答命中"全链。
**风险与回退**：cron 与现有 04:17 快照无冲突（不同时点）；审核队列是唯一入库口 → 误采不污染线上库；回退 = 摘掉 crontab 一行。
**估时**：2 天 + 0.5 天服务器运维（跑通首周）。

---

## F2 · B1 引用溯源 + B2 不确定分级

**目标**：每条梨宝回答下方挂"依据卡片"（文章标题+日期+外链）；回答带统一的可信度徽章（✅ 查到原文 / ⚠️ 推算或时效存疑 / 🧩 来自校内图谱 / ❌ 没查到）。
**现状利好**（ recon 实证）：`/api/chat` 响应**已经返回** `sources: [{title, account, pub_time, snippet, url, score}]`（`server/app.py:1032-1039,1191-1193`），且模板答会把 sources 置空避免"假来源"（`app.py:1131`）；SSE 流式版已透传 `sources`（`app.py:1259-1267`）。**后端工作量远小于预估，主要在前端呈现与分级。**

**改动清单**：
| 文件 | 动作 | 说明 |
|---|---|---|
| `scripts/rag.py` | 微调 | `search()` 投影里 `url` 取 `resolved_url or source_url` 兜底（若现投影缺） |
| `server/app.py` | 小改 | `_chat_core` 响应增 `confidence: {level, reason}`（见映射表）；`study_sources`/`health_sources` 透传 title 之外补 `kb: 'method'\|'health'` 标记 |
| `src/components/SourceChips.tsx` | 新增 | 共享组件（web 梨宝与移动端抽屉共用）：≤3 个来源 chips + "查看原文"外链（`target=_blank rel="noopener noreferrer"`）+ 展开更多 |
| `src/components/ConfidenceBadge.tsx` | 新增 | 四态徽章 + 悬停解释文案（口径过一遍 project-core「懂分寸」话术） |
| `src/features/libao/LbaoChat.tsx` | 小改 | 消息渲染挂 `<SourceChips>` + `<ConfidenceBadge>`（AI 回答块） |
| `src/features/mobile/LbaoDrawer.tsx` | 小改 | 同上（复用同组件） |
| `tests/chatSources.test.ts`（ui）+ `server/tests/test_chat_confidence.py` | 新增 | 见下 |

**confidence 映射表**（server 端一处计算）：
| 条件 | level | 前端文案 |
|---|---|---|
| `sources ≥1` 且相关性门（D5 `relevance_gate`）通过 | `cited` | ✅ 依据校园公开信息 |
| 走 LLM 但 `top_raw` 低 / route=hybrid | `inferred` | ⚠️ 部分为梨宝的推断 |
| 模板答（图谱/空间结构化数据） | `structured` | 🧩 来自校内空间数据 |
| 空 query / 无来源且边界外 | `none` | ❌ 没查到可靠依据 |

**实现步骤**：① rag 投影兜底 ② confidence 计算 + 响应/SSE 字段 ③ 两个共享组件（走组件库令牌，顺手提升组件库接入率）④ 两端挂载 ⑤ 文案审校。
**测试与验收**：pytest——grounded 问题 confidence=cited 且 sources[0].url 非空；模板路由 sources 空 + level=structured；无来源边界问题 level=none/inferred。ui 测试——chips 渲染出 a[href] 且带 noopener；徽章四态。E2E `e2e-journey.mjs` 增一条"问截止日→看到来源卡"锚点。**验收**：真机问答 3 例（政策类/空间类/闲聊类）三态呈现正确。
**风险与回退**：纯新增字段与组件，旧前端忽略之；回退 = 隐藏组件。
**估时**：2.5 天（后端 0.5 + 组件 1.5 + 测试文案 0.5）。

---

## F3 · A1 偏好学习 v1（"越用越懂你"·建议卡形态）

**目标**：把已有行为数据（`behaviorLog` 块级 done/skipped、`actualMin`）统计成**人话建议卡**——"最近 3 周晚 8-10 点的自习块跳过率 71%，要不要把深度学习挪到下午？"——用户**一键确认**后经既有画像/作息接线生效。**v1 零引擎改动、零契约改动**（引擎输入不变 → golden 天然零漂移）。
**设计依据**：引擎哲学已是"人群底线输给用户明确说过的话"（corrections 层）——偏好学习走"**建议→用户确认**"恰好复用这条最高优先级通路，且完全符合智能边界 L3（给倾向+讲理由+可推翻）。

**改动清单**：
| 文件 | 动作 | 说明 |
|---|---|---|
| `src/lib/behaviorLog.ts` | 小改 | `BehaviorRecord` 增可选 `startMin?: number`（当日分钟）与 `place?: string`；`markBlock` 入参加透传；`isRecord` 校验放宽。**老记录无字段 → 统计时自动过滤，零迁移** |
| `src/lib/prefLearn.ts` | 新增 | 纯函数核心（见下） |
| `src/features/overview/PrefLearnCard.tsx`（或画像页） | 新增 | 建议卡 UI：文案+证据+【采纳/忽略】；"数据累积中"空态 |
| `src/lib/storage.ts` 或独立 key | 新增 | `usst.preflearn-v1`：建议的 applied/dismissed 状态（仅本机） |
| `tests/pref-learn.test.ts` | 新增 | 见验收 |

**prefLearn 规则集 v1**（全部保守：样本不足不出建议）：
| 规则 | 输入 | 触发（最小样本） | 建议动作 |
|---|---|---|---|
| R1 时段跳过 | done/skipped 按 `startMin` 分桶（晨<720 / 午720-1080 / 晚>1080） | 近 4 周某桶 n≥6 且 skipRate≥0.6 | 作息修正建议：该桶写低亲和（经 routineStore 作息段写入端 R2 落地，`profilePrefs` HEA 接线自动消费） |
| R2 档位完成 | done 率按 plannedMin 桶（<50 vs ≥50） | 各桶 n≥5 且差 ≥25pct | 自习档位建议（25/50 档，经 knowledge 档位参数用户确认后生效） |
| R3 估时偏差 | 有 `actualMin` 的记录：实际/计划比值中位数 | n≥8 且偏差 ≥±30% | 提示"你的 X 类任务普遍比计划多/少 30%，下次按 Y 分钟估"（v1 仅提示+改待办默认时长，不动引擎） |

导出签名：`learnPrefs(records: BehaviorRecord[], now: string): PrefSuggestion[]`，每条 `{id, kind:'routine'|'tier'|'estimate', text, evidence: string, status}`——**纯函数、确定性、可单测**；梨宝对话若要引用，读 `src/lib/prefLearn.ts`（不在 `lib/planner/` 下，不触红线 6）。
**v1.5（可选小步，随 F4 一并）**：`BuildWeekPlanInput.weights?: Partial<Weights>` 透传 `PlanRequest.weights`（条件展开零漂移）——用于两条全局微调规则（用户高频删除活动块 → `blankDeficit` 微降；高频整周重排 → `churn` 微升）。
**测试与验收**：合成记录三组用例（跳过率触发/不触发、样本不足返回空、applied 状态幂等）；**RV**：注释掉 R1 触发逻辑 → 对应用例红。**golden**：v1 不动引擎 → 全套 golden 逐字节一致（实证零漂移）。**验收**：演示账号注入 3 周样本 → 建议卡出现 → 采纳后下周计划作息段变化且引擎 notes 说出理由。
**风险与回退**：建议全本机、可逐条撤销（面板"梨宝学到的偏好"含总开关+清除，隐私口径与 telemetry 零上报一致）。
**估时**：2.5 天（字段扩展 0.5 + 规则与测试 1 + UI 1）。

---

## F4 · A2 一键多方案 + D10 目标函数补项（合并批）

**目标**：周视图一键出**均衡 / 紧凑 / 松弛**三版周计划切换；顺带把 spec §13.8 登记的两个"无目标驱动算子"补上。
**核心技巧（本批的零漂移钥匙）**：给 `Weights` 增两个新键 `blockLengthOverrun`（超档位时长惩罚）与 `windowViolation`（提交项窗口违约惩罚），**默认值 0** ——默认路径代价不变 → 存量 golden 逐字节零漂移；只有变体预设把它们设为 >0 才生效。`resplit` 拆分方向与 `reschedule-place` 窗口方向这两个已实现但从未被目标驱动的算子（spec §13.8）从此激活。

**改动清单**：
| 文件 | 动作 | 说明 |
|---|---|---|
| `src/lib/planner/model.ts` | 小改 | `Weights` 增 `blockLengthOverrun: number; windowViolation: number`（DEFAULT 均 0）；增 `VariantPreset` 类型（id/label/weights 覆盖表） |
| `src/lib/planner/objective.ts` | 小改 | 两项新代价项（缺省 0 时数学上无操作） |
| `src/lib/planner/planWeek.ts` / `solver` 编排 | 小改 | 变体编排：construct 一次 → improve 三次（balanced=默认 / compact={studyShortfall×1.3, blankDeficit×0.5, blockLengthOverrun:0.5} / relaxed={blankDeficit×1.6, transferRisk×2.4, windowViolation:0.3}），**总耗时预算 ≤600ms**（每变体 budgetMs 180，超时返回构造解）；填充既有占位 `PlanResult.variants` |
| `src/lib/planner/schedule.ts` | 小改 | `BuildWeekPlanInput.variants?: boolean`；`BuildWeekPlanResult.variants?: Array<{id,label,plan,costTotal}>`（契约申报；条件式：不请求则字段不出现） |
| `src/features/week/WeekPlanView.tsx` | 小改 | 顶部三段切换（用组件库 `ui/Segmented`）；选择持久化 `usst.variant-{weekNo}`；切变体 = 换 plan 渲染（**锁跨变体有效**：语义键 id 与时间无关，同块在三个变体里 id 相同 → `lockLevels` 天然生效） |
| `src/features/libao/weekPlanForChat.ts` | 小改 | 梨宝"换个节奏"出三版摘要（走防腐层，不触红线） |
| `tests/variants.test.ts` + golden 增量 | 新增/新增 | 见验收 |

**实现步骤**：① Weights+objective 两项（缺省 0，先证零漂移）② 变体编排与预算闸 ③ 契约透传 ④ 周视图 UI ⑤ golden 为变体语料**新增**快照（只增不改）⑥ 梨宝接入。
**测试与验收**：a) 全套存量 golden 逐字节一致（变体关闭时）；b) 变体开启：三版 cost 满足 compact.studyMin ≥ balanced ≥ relaxed 的单调性（合成语料断言）；c) 同一 commit 在三变体中块 id 一致（锁有效性）；d) 预算闸：构造超大规模输入时变体数降级且不超时；e) **RV**：把 `blockLengthOverrun` 默认改 1 → 存量 golden 红（证明新代价项真的接线）。**验收**：真机演示"一键三版 + 切换 + 锁定跟随"。
**风险与回退**：env 开关 `PLAN_VARIANTS=0` 一键回旧；预算闸保证低端机不卡。
**估时**：3 天（objective/编排 1.5、UI+梨宝 1、测试 golden 0.5）。

---

## F5 · C1 今日晨报 + C2 周报复盘（移动端执行层深化）

**目标**：①每天早 7:30 一条本地通知"今天 3 个块，第一件 8:00 图书馆；⚠六级报名后天截止"；②每周日 20:00 一条周报通知 + 应用内"本周复盘"卡（完成率/环比/最爱挪的时段/欠账目标/一句人话建议）。
**设计依据**：复用 `notifyBridge.ts` 既有模式——**纯函数出通知清单 + 确定性 id + 每次同步/前台全量重排**（`planTodayNotifications` 先例）；数据全部现成（`useTodayData` 今日块、`memoTypes` todos/goals 带 dueAt、`behaviorLog` 纯函数层 `summarizeWeek/goalDebtByGoal/actualLoadByDow`）。

**改动清单**：
| 文件 | 动作 | 说明 |
|---|---|---|
| `src/features/mobile/lib/morningBrief.ts` | 新增 | 纯函数：`morningBrief({blocksToday, todos, goals, nowMin, dateKey}) → {title, lines[], warnings[]}`；warnings：dueAt 72h 内且无对应 done 记录的 goal/todo、已逾期项（≤3 条，宁缺毋滥） |
| `src/features/mobile/lib/notifyBridge.ts` | 扩展 | 增 `planBriefNotifications(brief, goalDeadlines, dateKey)`：晨报 1 条（明早 7:30，id=stableHash('morning'+dateKey)）+ deadline D-3/D-1 各 1 条（id=stableHash('ddl'+goalId+d)）——并入既有全量重排通道 |
| `src/features/mobile/TodayTab.tsx`（或 TodayPage 顶部） | 小改 | MorningCard：同数据的应用内呈现，可滑走 |
| `src/lib/weeklyReview.ts` | 新增 | 纯函数：`weeklyReview(records, weekNo, prevWeekNo) → {rate, delta, movedSlotTop?, debtGoals[], lines[]}`（movedSlot 统计依赖 F3 的 `startMin` 字段；无字段时该行省略——诚实降级） |
| `src/features/week/`（周报卡）+ `src/features/mobile/MeTab.tsx`（复盘区） | 小改 | 呈现层 |
| `tests/mobile/morningBrief.test.ts`、`tests/weeklyReview.test.ts` | 新增 | 见验收 |

**LLM 点缀（可选、默认关）**：周报末尾一句梨宝口吻总结——走既有 `/api/chat` 一次性调用，flag 控制；默认纯模板句（零成本、离线可用）。
**v2（另立项，动契约）**：`SyncState` schemaVer=3 增 `deadlines[]`（网页端重要日体系同步到手机，让 deadline 提醒覆盖校历事件，不只 goals/todos）。
**测试与验收**：纯函数用例（空数据→"数据累积中"沿用 `rate: null` 诚实口径；72h 临近/逾期/清白三态；周报环比计算含跨周边界）；通知清单确定性 id 幂等（同输入两次生成逐字节一致）；**RV**：摘掉 D-3 规则 → 对应用例红。**验收**：真机次日 7:30 实收晨报；周日 20:00 实收周报；两卡在应用内呈现与通知一致。
**风险与回退**：通知重排依赖"打开 App"（重启后恢复的既有口径不变）；回退 = flag 关。
**估时**：4 天（晨报 1.5、周报 1.5、两端 UI 1）。

---

## F6 · A4 场景模式（考试周/比赛周一键切换）

**目标**：总览页一键"考试周模式"：本周自习目标上调、留白压缩、运动社交降权——引擎 notes 与 UI 都明说"当前处于考试周模式"。
**改动清单**：新增 `src/lib/scenarioModes.ts`（模式定义 + `patchPolicy(policy, mode)`——**在安全档内打补丁**：上下限沿用引擎 knowledge 接线的钳制值，模式只在其区间内取值）；`features/overview` 模式卡 + `usst.scenario-mode` 持久化；`toPlanRequest` 调用侧先 patch 再传（零引擎改动）；权重部分走 F4 的 `weights` 通道（如考试周 `dueOverdue×1.3`）。
**测试与验收**：钳制边界用例（任何模式不得越 knowledge 安全档）；关闭时逐字段与原 policy 一致（零漂移）；notes/横幅出现模式名。**RV**：去掉钳制 → 边界用例红。
**估时**：1.5 天。

---

## F7 · 二批项（紧凑工作单）

### F7-1 · A3 习惯块（最小实现，零引擎改动）
"每周三 20:00 跑步 40min" → 应用层展开为 `UserTask`（固定时段）或 splittable `Commit`（"每周累计 3 次×40min" → effortMin 120 + minAcceptableMin 30 + window 晚间）；任务 id 命名 `habit-{habitId}[-s{n}]` 使块 id 带前缀 → 欠账统计复用 `goalDebtByGoal` 模式新写 `habitDebt()`（behaviorLog 内，10 行）；UI：GoalTodoCard 增习惯行 + 打勾。新类型 `HabitDef` 放 `src/lib/habitStore.ts`（app 层，非引擎）。估时 2 天。

### F7-2 · D1 课表多格式导入
`server/timetable_parser/` 增 `wakeup.py`（WakeUp JSON：课程名/周次/节次→统一 course_records 格式，生态有文档化 schema）与 `ics.py`（VEVENT RRULE 简化解析，纯标准库）；端点 `/api/import_file?format=wakeup|ics`（复用现有 import_pdf 的响应形状）；fixtures 双份（json/ics）+ pytest 断言映射正确。与框架线 M2 的 profile 课表格式**用同一统一格式**（两线对齐，各自实现）。估时 2 天。

### F7-3 · B3 时效标注
`articles` 表增可空 `effective_to`（**DB 迁移 = L2，白天拍板后执行**；BLOCKERS 2026-09-28 早有登记）；`rag.py` 检索对过期项降权并在返回中标 `stale: true`；F2 的 confidence 把 `stale` 计入 `inferred` 档；F1 的审核 CLI 增"设定失效日期"字段。UI：来源 chip 带"可能已过期"角标。估时 1.5 天 + 迁移窗口。

### F7-4 · C3 桌面小组件
**v0（零工作，先写进文档）**：F15 常驻"正在进行"通知已覆盖锁屏场景——这就是"穷人版小组件"。v1：`mobile/android` 内写 AppWidgetProvider（原生 Kotlin，无 npm 依赖）+ 每次同步把当前/下一块 JSON 写入 SharedPreferences 供 widget 读（自写微型 Capacitor 插件桥，原生侧约 200 行）。估时 3 天，决赛后按需。

---

## F8 · 暂缓项（含暂缓理由与重启条件）

| 项 | 暂缓理由 | 重启条件 |
|---|---|---|
| C4 语音输入 | 系统输入法自带语音转文字已覆盖 90% 场景（零依赖零工作）；插件方案带来权限/隐私/包体三重成本 | 真机走查发现高频"手腾不出来"场景再议 |
| D2 拍照导入（OCR） | 现有 DeepSeek 通道为文本模型，视觉能力需新依赖/成本；识别错误的归责与"诚实原则"冲突 | ①接入具备视觉能力的模型通道 ②且限定"拍海报→提取截止日期"窄场景试点 |

---

## 9. 全局验收纪律（每批收尾）

1. `node scripts/preflight.mjs` → 批内开发 → `node scripts/impact.mjs` → `node scripts/gate_overnight.mjs`（tsc 0 / engine·ui 只增不减）。
2. 新测试带 RV（关实现必红）；`capability_map.mjs --write` 重登记。
3. 涉契约的批（F4/F5-v2）commit message 显式申报字段；golden 变化只出现在 F4 的**新增**语料。
4. 移动端改动随下一版 APK 出包（`release_version.mjs` 校验四处同步）；服务器侧（F1/F2 后端）部署走既有 `dist_pre_*` 备份惯例。
