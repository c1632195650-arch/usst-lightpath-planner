# G 批「重构至完成」执行方案

目标：把上次评估列出的待收口项做完——三个灰度开关全开（CY 已拍板）+ D 批派生类型清理 + 文档/台账结项。全程小步提交、不 push、不合并分支。

## P1 派生类型层清理（D 批偏差结项，CY 名下文件）

- `src/features/libao/LbaoChat.tsx`：删除 `ClarifyState`/`PickingState` 接口与 `updateClarify`/`updatePicking` 写入口适配器；约 21 处写调用机械替换为直写 `setTopic(collectTopic(...))` / `setTopic(pickingTopic(...))`，**保留适配器内 `setMissStreak(0)` 语义**。
- **保留**只读投影 `clarify`/`clarifyPicking`/`schedMode`——`tests/v2.test.ts:75-76` 源码断言依赖 `clarifyPicking`，保留则零断言漂移。
- 验证：tsc 0 + v2/d-batch 相关测试 + 一条反向验证（删写入口语义 → 用例红）。独立 commit。

## P2 三开关缺省开 + golden 重拍（动 RAY 属地三个已授权叶子，commit message 申报）

1. `knowledge.ts:36-53` / `placesPolicy.ts:31-48` / `profilePrefs.ts:25-42`：缺省 false→true，env 显式设 `0`/`false` 可关（保留逃生门），更新头注。
2. 三个 wiring 测试（knowledge-wiring/places-policy/profile-prefs）中「未设 env=关」用例翻转为「显式 env=0=关」，用例数量不减，源码锁断言同步更新。
3. 跑 `test:engine` 量化红面 → `node --import ./tests/register.mjs tests/golden-snapshot.ts --force` 重拍 5 份快照 → `golden-compare.ts` 复核 → `tests/README.md` 按「重拍记录 ①」先例格式记②，逐项说明漂移（预期：自习档位 45/60/90→25/50、crosscampus 步行排序、PROFILE 预计零漂移）。
4. 内联断言红逐条处置：**只有确认是预期行为变化才改断言并申报；疑似回归一律修实现**。若红面失控（大面积红且原因不明），记 BLOCKERS 停手。
5. E2E：隔离 vite 端口（不用 5173 常驻实例）离线跑 `e2e-sched-session.mjs` 须 77 过/0 挂。
6. 视觉验收：渲染周计划页截图 PNG，交 visual-judge 过目块卡片视觉（替代台账要求的「人工过目」，结论附台账）。
7. 独立 commit（开关翻转一个、golden 重拍一个，便于回滚）。

## P3 文档与台账结项

- `BLOCKERS.md`：understand 边界闸条目标结项（探明 T 批 `llmJudge` 已实现「在线全消息过端点」，无需代码）；三开关待决定条目、D 批偏差条目结项；**新增两条**：① sleepMin 进 PlanRequest 等四处 PARTIALS 属跨人契约扩展，需 B（RAY）确认；② beta-v2 与 origin/dev 为 unrelated histories（dev 另有 150 条独有提交），合并必须人工评审。
- `docs/wp-ledger-v2.md` 新增 §G 记录本批。
- `docs/progress-status.md` 进度快照重写至当前（真引擎链路、S/T/D/E/G 批、E2E 与评测体系、后端端口 8001 协议、删除 lbaoRecommend 旧口径）。
- `AGENTS.md` §〇 快照同步修正（已实现清单、遗留清单指向 wp-ledger-v2 台账）。
- 独立 commit。

## 最终门禁

tsc 0 ｜ engine 全绿且 pass≥458 ｜ ui≥319 ｜ E2E 离线 77/0 ｜ 风格 8/8 ｜ 禁区仅申报文件 ｜ 测试数量只增不减。

## 明确不做（留人工）

PlanRequest 契约扩展（sleepMin 等）、四处 PARTIALS 接线、beta-v2→dev 合并、push 远程——分别属「需双方确认」「unrelated histories 人工评审」与外发动作。