# 通宵执行报告 · 2026-09-27（beta-v2 分支）

> 执行体：ZCode 无人值守夜间批次。任务书：`docs/plan-v2-2026-09-26.md` 批次子集。
> 本报告只写有命令实据的结论；每批改动文件带行号、命令带关键输出。
> 台账（批次状态/反向验证/断言申报）：`docs/wp-ledger-v2.md`。阻塞项：`BLOCKERS.md`（如有）。

## 环境对账（开工时）

- `git rev-parse --abbrev-ref HEAD` → master；`git log --oneline -1` → `03a11b5`
- `md5sum scripts/gate_overnight.mjs` → `eb43ce60816d4691a8b209f3904dcb3b`（每批收尾复核，未变）
- 开工门禁：tsc=0 / engine=326 / ui=237 / 禁区零改动 / 风格 8 项 → 5/5 PASS

## 批 0 · beta-v2 分支 + 台账 —— commit `cc901b5`

- `git checkout -b beta-v2`；`git rev-parse --verify refs/heads/beta-v2` → 存在（扁平名通过）
- 新建 `docs/wp-ledger-v2.md`（基线/规则抄录/批次状态表/各 WP 节），单独提交，未夹带任何杂物
- 收尾门禁 5/5 PASS（engine=326 / ui=237）

## 批 1 · WP1 基础信息前置

**改动文件与关键行号**

| 文件 | 改动 |
|---|---|
| `src/lib/identity.ts` | BasicInfo 增 campus/dorm/sleepMin/exercisePerWeek；grade 收窄 1-4（`Grade`/`gradeFromLabel`/`GRADE_LABELS`/`CAMPUS_OPTIONS`，:16-56 附近）；loadBasicInfo 白名单校验+旧字符串迁移（:100-129 附近）；applyObjectiveFact 年级解析（:135-155 附近）；basicInfoContext 增校区/年级标签（:180 附近） |
| `src/features/welcome/basicInfo.ts`（新） | `initialView` / `validateBasicInfo` / `parseBasicInfo` / `EMPTY_DRAFT` |
| `src/features/welcome/BasicInfoStep.tsx`（新） | 引导第 1 步 UI：必填四项（称呼/年级/学院/校区），缺禁「下一步」；campus 只认 军工路本部/1100；宿舍禁坐标；sleepMin 0-1440 / exercisePerWeek 0-7 |
| `src/App.tsx` | 净改 8 行：View 增 'basicinfo'（:17）；`useState<View>(() => initialView(state.onboarded))`（:40）；onStart→basicinfo（:151）；basicinfo 渲染分支（:157-159）；handleComplete 去 onboarded（:108）；result onEnter 写 onboarded（:172） |
| `src/features/persona/personaCopy.ts` | makeEpithet 年级经 gradeLabel 标签化（:187-196 附近） |
| `src/features/persona/PersonaResult.tsx` | 基础信息卡 grade 转数字写入/标签显示（:25-44、:49-53 附近） |
| `scripts/basicInfo.test.ts`（新） | 10 用例：冷启动闸门/必填/campus 值域/数字域/宿舍禁坐标/草稿解析 |
| `tests/identity.test.ts` | 3 处 grade 期望值 字符串→数字（已申报，见台账 3b 节）+ 新增 2 用例 |

**命令实据**

- `npm run --silent typecheck` → TSC-OK
- `node --import ./scripts/register-alias.mjs --test scripts/basicInfo.test.ts tests/identity.test.ts scripts/personaCopy.test.ts` → tests 28 / pass 28 / fail 0
- 反向验证 4 组（RV1-RV4，详见台账 §WP1）：关实现 → 红（fail 5/4/2/2）→ 恢复 → 绿；恢复后 md5 与改动前一致
- 收尾门禁：**tsc=0 / engine=328 / ui=246 / 禁区零改动 / 风格 8 项 → 5/5 PASS**；`md5sum scripts/gate_overnight.mjs` → `eb43ce60…` 未变

**遗留**：Welcome「先浏览应用」跳过引导不置 onboarded（刷新回欢迎页）——语义正确，未改；如需改请人拍板。

---
