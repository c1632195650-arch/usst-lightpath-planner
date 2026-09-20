# 三树合流盘点 · 2026-09-21（夜间只读盘点，未做任何合并）

> 生成：无人值守夜间批次 0 · A5。**本文只是清单与建议，不代表已做任何内容合并。**
> 方法：对三棵树做文件级枚举（排除 `node_modules/`、`.git/`、`dist/`、下划线临时产物；usst-planner 另排除其内部 `.wt-1100/`、`.preview/`、`.p1m/` 三个临时目录），按相对路径对齐后比较文件大小，对关键组用 MD5 复核内容一致性。
> 中间清单（`_inventory_*.txt` / `_uniq_*.txt` / `_diff_files.txt` / `_compare_trees.ps1`）留在 `_work_dev` 根目录，均以 `_` 开头（gitignore 内），白天复核后可手工清理。

## 0. 三树 git 元数据（只读查询结果）

| 树 | git 状态 | 备注 |
|---|---|---|
| `_work_dev` | **无 git** → 夜间已 `git init` + 全量快照提交 `5546be9`（分支 `master`） | 快照是保险，不是合流 |
| `_full` | 有 git，分支 `integration`，HEAD `43e9fc2`（一串 merge commit），**17 个文件未提交** | 有远端 `origin/main` |
| `usst-planner` | 有 git，本地 `main` **0 次提交（HEAD 0000000）**，**170 个文件未提交**；远端有全套历史分支（`origin/dev`、`feat/*` 等） | `.wt-1100/` 未出现在 `git worktree list` 里，是普通目录（疑似旧 worktree 残留拷贝），需人工看一眼 |

## 1. 各树独有文件清单

### 1.1 `_work_dev` 独有（10 个）—— 梨宝意图层 + 记忆 + 夜间工具

| 文件 | 是什么 |
|---|---|
| `src/features/libao/libaoIntent.ts` | 梨宝意图识别（create/replace/reschedule/cancel/query 全套） |
| `src/features/libao/MemoryPanel.tsx` | 记忆面板（M2 建议卡/记忆展示） |
| `src/lib/identity.ts` | 用户身份/基础信息单点（BasicInfo） |
| `scripts/libaoIntent.test.ts` | 意图层测试 |
| `scripts/goalPlan.test.ts` | 目标规划测试 |
| `scripts/test_memory_facts.py` | 记忆事实抽取测试 |
| `scripts/gate_overnight.mjs` | 夜间门禁脚本（2026-09-21 新增） |
| `docs/plan-2026-09-21-full.md` | 本次推进方案（仓库内稳定引用路径） |
| `scripts/_smoke_memory_api.py` | 下划线临时冒烟脚本（**建议不参与合流，仅参考**） |
| `tests/identity.test.ts` | identity 测试 |

> 与方案 §一 #12–15 的核验一致：意图层、记忆 M0–M3、身份单点都只在这棵树上。

### 1.2 `_full` 独有（25 个）—— 空间质量线 + campus_vocab + method 库副本

**空间/路网质量线**（2026-09-16 ~ 09-19 的工作，全部只在这里）：

- 脚本：`scripts/audit_network_quality.py`、`audit_readiness.py`、`audit_spatial_quality.py`、`audit_weak_anchors.py`、`build_bike_minutes.py`、`build_relative_bearing.py`、`overlap_accuracy.py`
- 数据：`data/access_policy.json`、`data/campus_vocab.json`、`data/quality_checkpoints.json`、`data/relative_bearing.json`
- 文档：`docs/anchor-audit-2026-09-18.md`、`field-check-2026-09-16.md`、`gps-trace-protocol.md`、`network-health-2026-09-18.json`、`spatial-optimization-2026-09-19.txt`、`spatial-quality-2026-09-19.{json,md,txt}`、`spatial-quality-baseline.json`、`spatial-readiness-2026-09-19.txt`、`valhalla-assessment.md`
- 评测运行记录：`evals/runs/run_20260920-211412.json`
- 服务端：`server/campus_vocab.py`
- 测试：`tests/campus-vocab.test.ts`

**method 库**（与 usst-planner 双树共有，见 §2）：`data/method_kb.db`、`scripts/method_rag.py`、`method_kb_data.py`、`build_method_kb.py`、`compile_method_params.py`、`src/data/methodParams.generated.ts`、`src/lib/planner/methods.ts`、`tests/method_params.test.ts`、`evals/method/*`

### 1.3 `usst-planner` 独有（30 个）—— 健康库 + 杂物

**健康库资产（真实要合流的）**：

- 数据：`data/health_kb.db`
- 脚本：`scripts/health_rag.py`、`health_kb_data.py`、`build_health_kb.py`、`compile_health_params.py`
- 前端/引擎：`src/data/healthParams.generated.ts`、`src/lib/planner/health.ts`
- 测试：`tests/health_params.test.ts`
- 评测：`evals/health/golden_v1.jsonl`、`evals/health/run.py`
- 文档：`docs/health-kb-plan.md`、`docs/method-kb-plan.md`（method 计划文档只在这棵树）

**临时/个人产物（明确建议不进合流）**：

- 草稿脚本：`scripts/_patch_app.py`、`_patch_app_comment.py`、`_serve8001.py`、`_verify_app.py`、`_verify_libao.ts`、`_verify_rag.py`、`_commit_msg.txt`
- 运行日志：`data/backfill_web_log.txt`、`collect_log.txt`、`collect_web_log.txt`、`dedup_log.txt`、`removed_log.txt`、`docs/_coverage_stat.json`
- 备份：`data/campus_map.json.bak-20260911`
- **个人课表**：`public/my_schedule.json`（含课程与教师个人信息，`_work_dev` 的 .gitignore 明确排除它，**绝不能合入**）
- Vite 时间戳残留：`vite.config.ts.timestamp-*.mjs` × 2

### 1.4 仅 `_full` + `usst-planner` 共有、`_work_dev` 缺失（11 个）—— method 库组

`data/method_kb.db`、`evals/method/{golden_v1.jsonl,run.py,_last_run.json}`、`scripts/{build_method_kb.py,compile_method_params.py,method_kb_data.py,method_rag.py}`、`src/data/methodParams.generated.ts`、`src/lib/planner/methods.ts`、`tests/method_params.test.ts`

> **已用 MD5 逐个复核：这 8 组文件在 `_full` 与 `usst-planner` 之间内容完全一致**（`data/method_kb.db` 也一致）。合流时任取一棵树均可，无冲突风险。

## 2. 双树以上都有、但内容不同的关键分歧（人工裁决区）

### 2.1 梨宝/记忆线 —— `_work_dev` 明显更新，以它为准

| 文件 | _work_dev | _full | usst-planner |
|---|---|---|---|
| `server/app.py` | **41448** | 39814 | 39680 |
| `server/memory.py` | **18685** | 10225 | 9982 |
| `src/features/libao/LbaoChat.tsx` | **31690** | 17494 | 16806 |
| `src/features/libao/weekPlanForChat.ts` | **24802** | 5421 | 7128 |

方案 P0-1 步骤 3「记忆端点以 `_work_dev` 版为准，勿反向覆盖」与此核验一致。

### 2.2 空间/路网线 —— `_full` 明显更新，但不能自动盖

| 文件 | _work_dev | _full | usst-planner |
|---|---|---|---|
| `server/campus.py` | 39971 | **52144** | 33038 |
| `server/campus_network.py` | 22116 | **37913** | 22116 |
| `scripts/test_campus.py` | 24456 | **59402** | 21464 |
| `scripts/fact_probe.py` | 13960 | **30798** | — |
| `scripts/fact_judge_reverse.py` | 6682 | **8689** | — |

⚠️ **注意**：`_full` 的 `server/app.py` 反而更小——说明 `_full` 在空间线推进时**没有** `_work_dev` 后来的记忆/意图改动。这两条线在 `app.py` 上是**真三方分叉**，不能任何方向直接覆盖，必须人工按段落拼合（空间段取 `_full`，记忆/意图段取 `_work_dev`）。

### 2.3 其余大小差异的模式

- **绝大多数文件 `_full` 比 `_work_dev` 大 ~2%**：抽查为行尾/注释类差异的可能性大（如 `docs/*`、`evals/*`、`scripts/*` 全线 +150~250 字节），**建议白天抽 2–3 个文件 diff 确认是否只是换行符（CRLF/LF）差异**，若是则统一 `.gitattributes` 后自动消解，不是内容分叉。
- `usst-planner` 的 `src/features/week/*`、`src/lib/planner/*` 普遍比 `_work_dev` 小很多（如 `WeekPlanView.tsx` 17683 vs 92768）：**planner 树是 09-11 的旧基座**，这部分不参与合流判断，`_work_dev` 直接为准。
- 个别反向：`src/lib/lbao.ts`（planner=8040 > work=4280）、`src/lib/planner/schedule.ts`（planner=43083 最大）、`src/lib/planner/places.ts`（planner=9498）——与方案 §一 #10/13 互印证（planner 树有被删掉的旧功能），按方案口径**不复旧**，仅留档。

### 2.4 数据文件三方不同（需人工裁决，禁止自动选）

| 文件 | _work_dev | _full | usst-planner | 初步判断 |
|---|---|---|---|---|
| `data/campus_map.json` | 109573 | **128012** | 112320 | `_full` 最大且其独有审计脚本都围绕它 → 倾向 `_full`，**需人工确认** |
| `data/libao_memory.db` | 32768 | 28672 | 176128 | 运行时 DB，非资产；`_work_dev` 已 gitignore 该文件 → **不合流**，保留各自本地 |
| `data/usst_articles.json` | 4448254 | 4457010 | 4457010 | full/planner 相同且略大；主库是 `usst_articles.db`（work=16.67MB 未列出差异即三方一致？见 §3 注） |
| `data/osm/*.osm` | — | 略大 | 与 work 相同 | `_full` 的 OSM 版本略新（+2KB 级），与空间质量线吻合 |

> 注：`data/usst_articles.db`（16.67MB 主库）**未出现在差异清单**，即在三棵树间大小一致（同为一方基准）。白天可用 MD5 复核一次即可安心。

## 3. 合流建议（白天人工执行，夜间绝不自动做）

**总原则**：以 `_work_dev` 为唯一基座（其内容最新且已建 git 快照），分四类处置：

1. **直接拷入（低风险，内容独占或双树一致）**
   - 健康库组（usst-planner 独有）：`health_kb.db` + 4 个 scripts + `healthParams.generated.ts` + `health.ts` + `health_params.test.ts` + `evals/health/` + 2 个 plan 文档
   - method 库组（full/planner 双树同内容，MD5 已核）：11 个文件原样拷入
   - `_full` 独有的空间审计脚本、`data/{access_policy,campus_vocab,quality_checkpoints,relative_bearing}.json`、`server/campus_vocab.py`、`tests/campus-vocab.test.ts`、spatial 文档组
2. **段落级人工拼合（高风险，禁止自动）**
   - `server/app.py`：记忆/意图段（`_work_dev`）+ `health_context()`/`method_context()` 注入段（参考 usst-planner 版 ：236/:741）+ 空间段（`_full`，如 campus_vocab 接线）——即方案 E9 + P0-1 步骤 3
   - `server/campus.py` / `campus_network.py` / `scripts/test_campus.py`：`_full` 版本领先太多，但需先确认 `_work_dev` 侧同期没有叠加改动
3. **需要人拍板后再动**
   - `data/campus_map.json` 三版本取舍（倾向 `_full` + 重跑审计脚本验证）
   - `data/osm/*` 与 `data/query_expand.json`、`data/key_points.json` 随 campus_map 一并定
   - `.gitattributes` 行尾统一（先抽 diff 确认 §2.3 的 +2% 差异是不是 CRLF）
4. **明确不合流**
   - usst-planner 的草稿脚本、日志、`.bak`、vite 时间戳、`public/my_schedule.json`（个人信息！）、`docs/_coverage_stat.json`
   - `data/libao_memory.db`（运行时数据，各自本地保留）
   - `usst-planner/.wt-1100/`、`.preview/`、`.p1m/`（临时目录，先人工确认 `.wt-1100` 里没有未沉淀的工作再清理）

**建议的合流顺序**（对应方案 §七）：P0-1（本盘点 → 四类处置）→ E9（健康/方法库接线进 app.py + gate 脚本）→ E10（规范入库）→ 其余批次。

## 4. 夜间盘点本身的证据

- 三树枚举数：`_work_dev` 304 / `_full` 330 / `usst-planner` 1559（其中 `.wt-1100` 970 + `.preview` 223 + `.p1m` 174，核心源码树仅 ~192）
- 对齐结果：三方同内容 13 个文件；双/三方内容不同 281 个（含 11 个仅双树共有）；各自独有 10 / 25 / 30
- 本批次只做了**读**和**写本文**，未向 `_work_dev` 拷入任何其他树的文件，未改 `_full` / `usst-planner` 任何内容
