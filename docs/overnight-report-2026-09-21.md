# 通宵执行报告 · 2026-09-21

> 执行者：ZCode 无人值守夜间批次｜工作目录 `D:\WORKBUDDY DATA\学术部\_work_dev`
> 任务书：只做「夜间安全批次」四项（批 0 P0-A / 批 1 E10 / 批 2 E3 / 批 3 E8），做完即停。
> **结果：四批全部完成，各一个 commit，全程禁区文件零改动，无 BLOCKERS。**

---

## 0. 一页话

| 批次 | 内容 | commit | 门禁 |
|---|---|---|---|
| 批 0 · P0-A | `_work_dev` 内 `git init` + 全量快照 + 三树只读盘点 | `5546be9` + `30f7132` | ✅ 5/5 PASS |
| 批 1 · E10 | 梨宝语言规范入库 + 人格双写注释 + 铁律回归 + 漂移检查进门禁 | `5ad21e7` | ✅ 5/5 PASS |
| 批 2 · E3 | 画像结果页文案库 + 称呼生成器 + 敏感词机械扫描（10 条新测试） | `459420b` | ✅ 5/5 PASS |
| 批 3 · E8 | `/api/chat/history` 端点 + 聊天跨会话恢复 + 清空对话按钮 | `2fb540a` | ✅ 5/5 PASS |

最终门禁实测：`typecheck` 0 错；`test:engine` **312/312**；`test:ui` **235/235**（基线 219，新增 16 条）；禁区文件零改动；风格漂移 8/8。

---

## 1. 环境实况（影响后续人工操作，先说清）

本会话 shell 里 `git` / `node` / `npm` / `python` 都不在 PATH，全程使用 workbuddy 管理版二进制：

- git：`C:\Users\CY\.workbuddy\binaries\PortableGit\versions\1.2.0\cmd\git.exe`（2.55.0）
- node：`C:\Users\CY\.workbuddy\binaries\node\versions\22.22.2-3\node.exe`（跑 npm 需把该目录加进 PATH 前缀）
- python（后端 venv，含 fastapi 0.141.1）：`C:\Users\CY\.workbuddy\binaries\python\envs\default\Scripts\python.exe`
- python（无 fastapi，跑 stdlib 脚本用）：`C:\Users\CY\.workbuddy\binaries\python\versions\3.13.12\python.exe`

> 注意：PATH 里的 `python` 是 WindowsApps 占位符，`python --version` 实际失败（退出码 9009）。
> 已把「python 解析 + workbuddy 路径兜底」写进 `scripts/gate_overnight.mjs` 第 5 条判据，门禁在任何 shell 里都能自举。

## 2. 批 0 · P0-A 版本保险（`5546be9` + `30f7132`）

**A1–A4 快照**
1. 确认 `_work_dev` 原本无 `.git`（`git rev-parse` 失败）后，在 `_work_dev` **内部** `git init`（分支默认 `master`，仅快照用途）。
2. `git config user.name "光溯开发组"`、`user.email "usst.lightpath@example.com"`、`core.quotepath false`。
3. 暂存区检查：`git add -A` 后 `git status --porcelain | findstr .env` → 只命中 `.env.example` 与 `src/vite-env.d.ts`（均为合法文件），**无 `.env`、无密钥**；全仓 `>50MB` 文件扫描 → **0 个**（最大为 `data/usst_articles.db` 16.67MB，属有意入库的仓库资产）。
4. `git commit -m "chore: 通宵开工前全量快照（三树分叉现状）"` → `5546be9`（301 文件，12.4 MiB pack）。

**A5 三树只读盘点 → [docs/merge-inventory-2026-09-21.md](merge-inventory-2026-09-21.md)（`30f7132`）**

方法：三树全量文件枚举（排除 node_modules/.git/dist/下划线临时产物；usst-planner 另排除其内部 `.wt-1100/`(970 文件)/`.preview/`/`.p1m/` 临时目录）→ 按相对路径对齐比大小 → 关键组 MD5 复核。

核心结论（详见盘点文档）：
- `_work_dev` 独有 10 文件（意图层/记忆/identity/夜间工具）；`_full` 独有 25（空间质量线 + campus_vocab）；`usst-planner` 独有 30（**健康库资产** + 草稿杂物）。
- method 库 8 组文件在 `_full` 与 `usst-planner` 间 **MD5 完全一致**（合流无冲突风险）。
- `server/app.py` 是**真三方分叉**（work 41448 / full 39814 / planner 39680）：记忆段看 work、空间段看 full、健康注入参考 planner —— 合流必须人工按段落拼。
- 明确不进合流：`public/my_schedule.json`（个人信息）、运行日志、`.bak`、草稿脚本、`libao_memory.db`（运行时数据）。
- **未向 `_work_dev` 拷入任何其他树的文件，未改 `_full` / `usst-planner` 任何内容。**

## 3. 批 1 · E10 梨宝语言规范文件化（`5ad21e7`）

| 文件 | 改动 |
|---|---|
| `docs/libao-style-guide.md`（新增，67 行） | 自 `学术部\outputs\梨宝语言风格规范-2026-09-19.md` **逐字节复制**（MD5 双向核对一致：`6240C2E9…`） |
| `server/app.py:104-106` | LIBAO_PERSONA 头部加双写注释 `# 同步自 docs/libao-style-guide.md v1（2026-09-19）…`（+2 行） |
| `scripts/test_direct.py:107-166` | 风格回归块扩为「规范铁律机械检验」：markdown 符号全模板池零出现、emoji 零出现（维度③）、「掐指一算」套话禁用（维度②）、称呼不堆叠（维度①）、首行含实体（铁律 1 核心优先）、「· 周边：」行必须 `步行 N 分钟`（铁律 8）。**39/39 全绿**。不可机械检验的铁律（R3 数据核对/R4 品类/R5 追问有据/R6 支撑度/R7 揣测心情/R9 烂梗）属 LLM 路由与判分器层，注释已写明归属 `test_libao` / `eval:libao` |
| `scripts/check_style_drift.py`（新增，111 行，stdlib-only） | 4 组 8 项检查：规范版本可解析、app.py 同步注释版本一致、direct.py 引用的规范章节不悬空、代码侧引用仍指向规范 |
| `scripts/gate_overnight.mjs:14-15,110-130` | 门禁新增第 5 条判据「风格漂移」（含 python 解析回退），注释同步更新 |

**验收与反向验证**：
- `python scripts/check_style_drift.py` → 8/8 PASS；
- 反向验证①：临时把 app.py 注释改成 v2 → 漂移检查正确变红（`FAIL app.py 同步注释版本与规范标题一致`），还原后回绿（还原用无 BOM UTF-8 写回，`git diff` 确认 app.py 仅 +2 行注释）；
- 反向验证②：`_reverse_check_e10.py`（临时脚本，`_` 前缀不进仓库）在内存中把 `**`/emoji 注入 direct 模板池 → markdown/emoji/首行实体三类断言全部正确变红。

## 4. 批 2 · E3 结果页文案库 + 称呼生成器（`459420b`）

| 文件 | 改动 |
|---|---|
| `src/features/persona/personaCopy.ts`（新增，192 行） | `ARCHETYPE_BLURBS`（6 原型 × 5 条模糊文艺变体）、`FALLBACK_BLURBS`（4 条兜底）、`makeEpithet()`（高轴≥70 正向短语 → 低轴≤35 反差幽默 → 场景字段 → 兜底；身份尾巴按 专业→学院→年级→上理人 回落）、`pickBlurb()`（按周种子轮换，确定性可测）、`defaultSeed()` |
| `src/features/persona/PersonaResult.tsx:6,64-66,80-82` | 挂载时算一次 blurb 与称呼（重渲染不换台词）；hero 区 h1 下插入「『称呼』」行 + blurb 段；原有「数值不代表好坏」缓解文案原样保留 |
| `scripts/personaCopy.test.ts`（新增，125 行，10 条测试） | 结构校验、敏感词全量扫描（焦虑/摆烂/内卷/落后/拖延/挂科/失败/垃圾/差/废/烂 + markdown + emoji）、未命中兜底路径、同 seed 确定性、跨 seed 可变、6 原型 × 3 组轴值抽查、身份回落链 |

**验收与反向验证**：`test:ui` 219 → **229**（+10）全绿；反向验证：临时向文案注入「拖延/摆烂」→ 扫描测试正确变红（fail=1），还原后回绿（229/0）。

> ⚠️ **路径偏差说明**：方案写的是 `src/data/personaCopy.ts`，实际落在 `src/features/persona/personaCopy.ts` —— `src/data/` 不在 AGENTS §8.1 无人值守白名单里（只列了 persona/libao/calendar/server/scripts/docs/api.ts/lbao.ts），而 `src/features/persona/` 是 CY 名下且在白名单内。语义不变（画像功能文案），偏差在此报备。

## 5. 批 3 · E8 聊天记忆跨会话恢复（`2fb540a`）

| 文件 | 改动 |
|---|---|
| `server/memory.py:380-396` | 新增 `history_messages(sid, k=50)`：升序、带自增 id 与 created_at（与 `recent_messages` 分工：给 UI 恢复用，带 id 去重；给 LLM 的保持轻量） |
| `server/app.py:823-846` | 新增 `GET /api/chat/history?user_id=&session_id=&limit=`：limit 夹取 [1,200]，出口**再过一遍 `desensitize`**（防历史脏数据回流），异常返回空列表不炸 |
| `src/lib/api.ts:81-107` | 新增 `chatHistory()`、`resetMemory()` 与 `ChatHistoryRow` 类型 |
| `src/features/libao/chatRestore.ts`（新增，78 行，纯函数） | `RESTORE_CHAT` 总开关（默认开）、`historyToMsgs()`（assistant→lbao 收敛）、`mergeHistory()`（按「角色+去空白文本」**多重集**去重——快照消息没有后端 id，同文重复按条数抵消）、`restoredMessages()`（有快照走合并 / 无快照走重建 / 空历史不恢复） |
| `src/features/libao/LbaoChat.tsx:47-48,178-213,214-224,521-535` | 挂载时拉一次 history：有快照→合并去重、无快照→历史重建（问候语让位，点清空可取回）、后端不可用→静默维持现状；`Msg` 加 `mid` 字段；侧栏新增「🗑 清空对话与记忆（本设备，不可恢复）」按钮（走 `/api/memory/reset`，文案如实告知范围）；置 `CHAT_CLEARED_KEY` 标记防清空后幽灵恢复；快照注释块改写为新语义 |
| `scripts/chatRestore.test.ts`（新增，85 行，6 条测试） | 重叠去重、同文重复条数抵消、空白折叠判重、空历史/空快照边界、重建 role 收敛 |
| `scripts/test_chat_history.py`（新增，139 行，7 条测试） | 临时库重定向（同 `test_memory_facts.py` 范式，不起服务）：升序+id 唯一、limit 取最近 k 条仍升序、端点出口脱敏（塞入未脱敏手机号 `13800138000` → 输出必须变 `[手机号]`）、limit 夹取、空会话 |

**验收与反向验证**：
- `python scripts/test_chat_history.py` → 7/7 OK；`--reverse` 模式（换坏实现：降序返回 + 出口不脱敏）→ 3 条正确变红，证明测试有效；
- 破坏 `mergeHistory` 的去重分支（`if (left>0)` → `if (false)`）→ `test:ui` 正确 3 红；还原后回绿；
- `test:ui` 229 → **235**（+6）全绿；记忆面板（MemoryPanel）本就按持久化 `user_id` 拉后端 facts，配合恢复天然满足「重开可见」验收项。

## 6. 命令与输出实录（关键）

```
git init / config …                       → Initialized empty Git repository …/_work_dev/.git/
git add -A; git status --porcelain|findstr .env   → 仅 .env.example、src/vite-env.d.ts（合法）
>50MB 文件扫描                              → 0 个（最大 usst_articles.db 16.67MB）
git commit "chore: 通宵开工前全量快照…"      → 5546be9（301 files, size-pack 12.40 MiB）
node scripts/gate_overnight.mjs（每批收尾，共 4 次，最后一次输出如下）
  PASS  typecheck    0 错误
  PASS  test:engine  pass=312 fail=0（基线 ≥312，只增不减）
  PASS  test:ui      pass=235 fail=0（基线 ≥219，只增不减）
  PASS  禁区文件     禁区文件零改动
  PASS  风格漂移     规范与代码同步（check_style_drift 8 项全过）
python scripts/test_direct.py             → 39/39 通过（100.0%）
python scripts/check_style_drift.py       → 8/8 通过，无漂移
python scripts/test_chat_history.py       → Ran 7 tests, OK（--reverse → 3 红 = 反向验证成功）
git log --oneline（最终）
  2fb540a feat(libao): E8 聊天记忆跨会话恢复…
  459420b feat(persona): E3 结果页文案库+称呼生成器…
  5ad21e7 feat(libao): E10 梨宝语言规范文件化…
  30f7132 docs(merge): 三树只读盘点…
  5546be9 chore: 通宵开工前全量快照（三树分叉现状）
```

## 7. 遗留问题与白天待办

**BLOCKERS：无**（全程未遇到需要人拍板才能继续的阻塞点）。

留给白天的事项（非阻塞）：
1. **三树合流**是人工决策题：按 `docs/merge-inventory-2026-09-21.md` §3 的四类处置走，优先级 `server/app.py` 三方拼合 > 健康库/method 库拷入 > campus_map.json 取舍。
2. **E3 路径偏差报备**：`personaCopy.ts` 在 `src/features/persona/` 而非方案写的 `src/data/`（§8.1 白名单所致）。若要挪回 `src/data/`，改动是纯移动 + 两处 import，10 分钟的事，但应由人确认归属。
3. **留弃临时产物**（全部 `_` 前缀、已被 gitignore、按纪律未删除）：`_inventory_{work,full,planner}.txt`、`_uniq_{work,full,planner}.txt`、`_diff_files.txt`、`_compare_trees.ps1`、`_reverse_check_e10.py`。白天确认后可删。
4. **门禁第 5 条（风格漂移）是本夜新增**，基线口径仍是 AGENTS §8.2 的四条——第五条只增不减原则下的追加，如不认可可从 `scripts/gate_overnight.mjs` 删除该段（不影响原四条）。
5. E8 的端到端人工验收（关浏览器重开 → 记录与记忆面板恢复）建议白天起一次后端真机走一遍：`python server/app.py` + 打开前端聊两轮 → 关标签页 → 重开。

## 8. 红线自查

- 禁区（`src/features/week/`、`src/lib/planner/`、`src/lib/persona.ts`、`src/components/`、`src/types.ts`）：**零改动**（每批门禁第 4 条实测，`git status --porcelain` 无命中）。
- 未 push、未 reset --hard、未 rebase、未 clean、未 checkout -- .、未删除任何文件（含临时文件）。
- 未跨树搬文件、未自动合并三棵树；未新增第三方依赖、未改 schema、未重建索引。
- 新增断言全部做了反向验证（E10 两路、E3 注入敏感词、E8 破坏去重 + python 坏实现双路），无一靠"改断言"变绿。
- 未启动/杀死任何后台进程（后端测试走临时库 + 直接函数调用，不起 uvicorn）；未使用后台子智能体。
- 只提交、未 push；5 个 commit 均可独立回滚。
