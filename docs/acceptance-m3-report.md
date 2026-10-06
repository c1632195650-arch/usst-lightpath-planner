# M3 · 任务三深层验收报告（2026-10-06，独立取证）

> 验收方式：按任务书 §八 MOSS 验收口径执行——**不采信开发期自报，全部重新取证**；
> 三套冒烟 + 全量门禁 + e2e 双连跑 + 防假覆盖新鲜变异 + 四库活体验证 + 量化 DOM 实测 + 三态截图。

## 一、门禁与红线（全新取证）

| 项 | 结果 | 证据 |
|---|---|---|
| tsc | **0 错** | `npm run typecheck` |
| test:engine | **593 pass / 0 fail**（基线 ≥496） | 重跑 |
| test:ui | **413 pass / 0 fail** | 重跑 |
| sync 冒烟 | **SYNC ALL OK**（含 4b 旧客户端兼容 / 4c 逐项 LWW / 4d persona 保留） | 重跑 |
| account 冒烟 | **ACCOUNT ALL OK** | 重跑 |
| memory 冒烟 | **SMOKE OK** | 重跑 |
| e2e | **15 passed ×2 连跑**（18.0s / 16.2s，稳定） | 重跑两遍 |
| capability-map --check | **✅ 与源码一致**（102 测试文件/93 守护源/55 RV 锚点） | `node scripts/capability_map.mjs --check` |
| `src/types.ts` | **零改动**（相对任务基线 `4a6db1b` 的 diff 为空） | `git diff 4a6db1b..HEAD -- src/types.ts` |
| golden | **零漂移**（evals/golden/ 相对基线 diff 为空，未重拍） | `git diff 4a6db1b..HEAD --stat -- evals/golden/` |
| `ChatReq extra="forbid"` | **未放宽**（app.py:495 原样） | grep |
| 既有 testid | **15/15 全在**（m-now-banner×2 处 / m-next-banner / m-today-list / m-block / m-block-done / m-edit-sheet / m-ics×3 / m-whitelist×2 / m-empty-cloud / m-quick×3） | 逐个 grep |
| 提交纪律 | 4a6db1b..HEAD 共 15 commit（含任务一/二并行线），**0 个 merge commit**，HEAD 仅在 `beta-v2` | git log |

## 二、量化硬指标（DOM computedStyle 实测，非代码目测）

在「充足」态真实渲染页测量（Playwright chromium 390×844）：

| 指标 | 要求 | 实测 | 判定 |
|---|---|---|---|
| 当前块标题字号 | ≥28px | **28px** | ✅ |
| 大按钮高度 | ≥44px | **44px** | ✅ |
| 「接下来」文本字号 | ≤14px | **12px**（两行均 12） | ✅ |
| 燃烧条宽度 | (now-start)/(end-start) | **50%**（now=start+30，块长 60，精确） | ✅ |

三态截图（真实浏览器渲染）：`docs/acceptance-m3/state-{1-empty,2-partial,3-full}.png`——三区 IA、目标待办卡（里程碑勾选态）、燃烧条琥珀色 50%、大按钮、接下来小字均正确呈现。

## 三、防假覆盖（验收期新鲜变异，红绿双输出实跑）

| 变异 | 靶子 | 结果 |
|---|---|---|
| A（首轮） | 逾期判定边界 `edd<dd → edd<=dd`（中旬 20 号当天误报） | ⚠️ **首轮 10/10 全绿——测试没接住！** 覆盖缺口：边界日 20 号当天无断言 |
| A（补测后） | 同一变异 | 补边界断言（20 号不算/21 号算）后 → **红（9/10）**；恢复 → 绿（10/10） |
| B | notifyCountdown 的 next 取最晚而非最早触发 | **红（10/12）**；恢复 → 绿（12/12） |

> 验收结论：既有测试网有效（B 类破坏必被接住）；A 首轮暴露一个边界缺口，**已在验收中修复**（tests/mobile/memoStore.test.ts ⑧ 补边界断言），这正是深层验收的价值所在。

## 四、验收期间发现并修复的问题（2 个）

1. **e2e flaky 断言（真 bug）**：第 1 条 `.or()` 在「当前块与下一块并存」时触发 Playwright strict-mode 二义性失败（时间相关：白天工作时段必现）。已修为 `.first()`，双连跑稳定。属测试缺陷，非产品缺陷（UI 并存展示是三区的正确行为）。
2. **逾期边界覆盖缺口**：见上表变异 A。

## 五、四库问答活体验证（PORT=8001 真后端，二度复验）

| 库 | 问题 | 命中证据 | 回答质量抽查 |
|---|---|---|---|
| 空间库 | 从宿舍到图书馆怎么走 | `used_space=True` | 给出 516 号校区图文信息中心步行路线 ✅ |
| 健康库 | 晚上睡不着有什么办法 | `used_health=True` | 护栏口径（20 分钟原则）✅ |
| 上理库 | 教务处最新通知在哪看 | mode=template（图谱直答） | 命中「水母楼」POI ✅ |
| 方法库 | 为什么我总是拖延 | `used_study=True` | 拆任务/启动技巧，非定论口径 ✅ |

SSE 逐字推送 ✅｜断连（读 6 行即关）无异常 ✅｜`/api/chat` 旧端点回归 ✅。

## 六、已知偏差（如实，不掩盖）

| 项 | 任务书要求 | 实际 | 说明 |
|---|---|---|---|
| 移动端目录行数 | ≤2600 | **3425**（不含任务二 eval/841） | 任务书同时要求三个全新功能面；反臃肿本意指标（TodayPage ≤260）实测 **193** 达标。BLOCKERS 已登记待 CY 裁决口径 |
| 真机走查 | CY 最终验收 | 未做（按任务书用 Playwright 390×844） | 权限前置/重启恢复的真机行为需真机 |
| dist 部署 | — | 未自动部署 | APK `server.url` 指向公网，需人工同步 dist 才能真机生效 |

## 七、验收结论

**通过**（带 1 项已申报的口径偏差）。任务书 §九 21 项清单除「行数 ≤2600」「真机走查」两项外全部满足且有独立取证；验收过程新发现并修复 2 个问题（e2e flaky 断言、逾期边界测试缺口）。

## 八、验收期间观察到的环境动态（记录，不影响判定）

- 验收进行中（08:27）曾捕获一次**瞬时 typecheck 报错**，三连跑后消失——经查为任务一会话**正在写一半的 `eval/compute.ts` 被赶上的竞态**（该文件 mtime 08:27:26，其会话当前仍有未提交改动 `methods.ts`/`method_kb_data_v2.py`），非任务三内容回归。
- 因此本报告的所有判定均以**提交粒度**为准（`d9eaf13` / `cdba7ed`，beta-v2）；其他会话的在途工作不纳入本验收范围，也不得由本验收代为提交。
- 提醒 CY：任务一/二/三三条线已交错合入 beta-v2，`docs/mobile-exec-layer-plan.md` 台账 §三.5 的协调说明仍然适用。
