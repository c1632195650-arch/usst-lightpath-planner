# 通宵无人值守约束（光溯移动端专项 · 2026-10-03）

> **效力**：本文档与 `AGENTS.md` §八（无人值守执行协议）**叠加生效，冲突时本文档更严者胜**。
> **适用**：任何以无人值守方式执行 `docs/mobile-impl-plan-2026-10-03.md` 的会话（通宵任务/闲时任务/定时任务）。
> **目的**：确保执行 agent **不会自己骗自己、不会敷衍了事**。本文档的每一条都是硬约束，不是建议。

---

## 1. 身份与心智模型

- 你是**实施工程师**，不是"计划复述员"。方案文档说"做什么"，你负责让它**真实发生并能拿出证据**。
- 你的产出物是三样：**能跑的代码、实跑过的验证记录、诚实的日志**。三者缺一，这一项就不算完成。
- 默认假设：**没有人在看着你**。你偷的每一个懒、绕的每一个验证，都会在白天验收时变成返工。本文档存在的意义就是让你的偷懒路径全部被封死。

## 2. 夜间硬禁区与预授权

### 2.1 硬禁区（碰到即停，写 BLOCKERS）

1. `src/types.ts`——任何改动（结构性改动的口子夜间不开）。
2. `data/` 下任何二进制的**手工**创建/编辑/提交。**唯一例外（白纸黑字）**：服务进程运行时自动生成、且已 gitignore 的 `data/libao_account.db` 允许存在——这是程序行为，不是手工操作。
3. `evals/golden/` 既有条目（只增不改的老纪律）。
4. **`tests/` 下任何既有文件的既有断言**：`git diff --name-only -- tests/ | grep -vE '^tests/(syncContract\.test\.ts|mobile/)'` 输出必须为空。新测试文件允许，旧文件零 diff。
5. AGENTS.md §8.1/8.5 的既有禁区（不 push、不 reset --hard、不 rebase、不删文件、不起常驻服务、不装系统包——下条白名单除外）。

### 2.2 依赖预授权白名单（夜间**唯一**允许安装的东西）

```text
npm:  @capacitor/core@6  @capacitor/cli@6  @capacitor/android@6
      @capacitor/local-notifications@6  @capacitor/preferences@6
pip (仅装入 /opt 或仓内 .venv):  fastapi  uvicorn  jieba  fastembed  requests
                                 （版本以 server/requirements.txt 锁定为准）
```

- 白名单之外**任何** `npm i` / `pip install` / `apt install` / 全局安装 → 停手，BLOCKERS。
- JDK / Android SDK：**必须白天已装好**（方案 §9.0）。夜间发现 `ANDROID_HOME` 缺失或 `java` 不存在 → BLOCKERS，跳过 M4 继续后续里程碑，**禁止现场下载安装 SDK**。
- 允许执行的系统命令白名单见 §8。

## 3. 完成的定义（DoD）——四者缺一不算完成

一个任务/功能只有在以下四条**全部满足**时才可以在日志里标记 `[DONE]`：

1. **实现落地**：代码在允许路径内，无 TODO/占位/mock 充数。
2. **测试在位且经过反向验证**：新断言至少一条做过"关掉实现→断言必须变红→恢复"的过程，并把红/绿两次输出**都**贴进日志。
3. **门禁实跑**：§7 门禁命令序列完整跑过，输出原样贴日志。
4. **证据入账**：日志条目含"做了什么 / 证据命令 / 关键输出 / 剩余风险"四段。

**禁止**用"应该可以了""理论上没问题""代码看起来是对的"这类语句替代以上任何一条。日志里出现这类措辞且无实跑输出 = 本条未完成。

## 4. 反自欺硬条款（每条附自查命令）

4.1 **禁止改测试让门禁变绿**。包括：改断言、删用例、加 `.skip`/`.only`/`.todo`、放宽超时、跳过 setup。
   自查（每里程碑收尾必跑，输出贴日志）：
   ```bash
   grep -rnE "\.skip\(|\.only\(|\.todo\(|\bxit\(" tests/ scripts/ e2e/ || echo CLEAN
   git diff --stat -- tests/ e2e/ scripts/   # 既有文件零 diff，只许新增文件
   ```

4.2 **禁止假报数**。门禁 pass/fail 数字必须来自**本次实跑**的输出原样粘贴，不许手抄记忆、不许四舍五入、不许"约等于"。
   ```bash
   npm run typecheck 2>&1 | tail -3
   npm run test:engine 2>&1 | tail -5
   npm run test:ui 2>&1 | tail -5
   ```

4.3 **禁止 mock 冒充端到端**。服务端冒烟只允许打桩 `rag`/`memory` 这类重依赖（既有 `_smoke_memory_api.py` 范式），**必须打真实 HTTP 端点与真实临时 SQLite**；不许"直接调函数就算测过"。

4.4 **禁止 TODO/占位/半成品冒充完成**。收尾自查：
   ```bash
   grep -rnE "TODO|FIXME|XXX|占位|待实现|placeholder" server/account.py server/sync.py src/features/mobile/ mobile/capacitor.config.ts || echo CLEAN
   ```
   命中任何一行且不是注释里引用的报错文本 → 该功能不得标 `[DONE]`。

4.5 **禁止缩小范围冒充完成**。方案 §1 的每条功能都有编号（F1~F18）。日志的完工报告必须**逐条**列出 F1~F18 状态（DONE / BLOCKED / NOT-STARTED + 一句证据）。漏报 = 未完成。

4.6 **禁止静默降级**。遇到方案与现实的冲突（依赖缺失、接口对不上、测试修不回），**唯一**合法动作是 BLOCKERS（§6），然后跳到下一个独立任务。禁止"顺手改方案""绕过去""先这样"。如果你发现自己在说服自己"这个偏差没关系"——那就是 BLOCKERS 时刻。

4.7 **禁止在日志里写敏感值**：SSH 密码、token、`.env` 内容、keystore 密码一律以 `***` 代替。`.env` 只 scp 不 cat。

4.8 **进程纪律**：本地起过后端/服务必须记录 PID 到日志并在收尾 `kill <自启 PID>`；**绝不 kill 任何不是自己启动的进程**（8000 端口可能有别人的服务，这正是方案用 PORT=8001 起本地后端的原因）。

## 5. 进度日志（append-only）

文件：`docs/overnight-log-2026-10-03.md`。**只许追加，不许改写已有条目、不许删除**（写错了追加更正条目）。

每完成一个任务块追加一条：

```markdown
## [HH:MM] M2-T3 · 轻编辑三件套  [DONE]
- 做了什么：EditSheet.tsx 完成三件套；覆盖层映射按方案 §7.3
- 证据命令：`npm run test:ui 2>&1 | tail -5`
- 关键输出：`# pass 232 / fail 0`（新增 3 条，反向验证见 T3-red）
- 剩余风险：换时段只给了 ±60 内快捷片，自由输入留白天
```

被 BLOCK 的任务同样记一条 `[BLOCKED]`，附 BLOCKERS.md 条目编号。**收尾完工报告模板**（追加在日志最后）：

```markdown
# 完工报告
- 里程碑状态：M1 [DONE] / M2 [DONE] / M5 [BLOCKED→BLOCKERS#3] / M4 [NOT-STARTED] / M3 [DONE]
- 功能清单 F1~F18：逐条状态 + 一句证据
- 门禁最终四连：typecheck / test:engine / test:ui / gate_overnight 输出原样
- 新增 commit 列表：hash + 一行说明
- 未完成项与原因（如实；"时间不够"是合法原因，"没做"不是状态）
- 留给白天的事：真机验收 / push / keystore 密码交付 / keystore 备份提醒
```

## 6. 失败协议（唯一合法的失败处理方式）

门禁红 / 测试失败 / 依赖缺失 / 方案与现实冲突 / 需要改禁区 / 需要新依赖：

1. 修——给一次真正的修复机会（读报错、查原因，不是瞎试）。
2. 修不回 → `BLOCKERS.md` 追加一条：`- [HH:MM] 阻塞点：<一句话>｜已排除：<试过什么，贴关键报错>｜需要人决定：<具体问题>`。
3. 跳到**下一个独立任务**继续推进（里程碑之间相互独立，不许因一处卡死全夜空转）。
4. **绝对禁止**：改测试（见 4.1）、改方案文档让它迁就现状、降级断言、注释掉失败用例、"先提交回头再说"地提交红门禁。

## 7. 收尾门禁（每里程碑结束 + 全程收尾各跑一次，输出原样贴日志）

```bash
npm run typecheck                                   # 0 错
npm run test:engine 2>&1 | tail -5                  # fail=0 且 pass ≥ 312+本夜新增
npm run test:ui 2>&1 | tail -5                      # fail=0 且 pass ≥ 219+本夜新增
node scripts/gate_overnight.mjs                     # exit 0
grep -rnE "\.skip\(|\.only\(|TODO|FIXME" tests/ e2e/ src/features/mobile/ server/ || echo CLEAN
git status --short                                  # 只含白名单路径
```

- 基线**只增不减**：任何一项少于既有基线 = 有测试被删/跳过，红灯处理（§6）。
- `git status --short` 里出现白名单（约束 §9）之外的路径 → 先 `git restore`（仅限自己本夜新增的误改）或 BLOCKERS。

## 8. 服务器操作护栏（仅 M5，全程走 SSH；只许下列命令类别）

**允许**（幂等优先）：
```bash
apt-get install -y nginx python3-venv            # 仅这两个包
fallocate/chmod/mkswap/swapon (仅 /swapfile 2G) ; echo '/swapfile none swap sw 0 0' >> /etc/fstab
mkdir -p /opt/usst/... ; rsync/scp 至 /opt/usst/** ; python3 -m venv /opt/usst/venv ; pip install -r requirements.txt
systemctl daemon-reload / enable --now usst-api ; nginx -t && systemctl reload nginx
systemctl list-units / disable --now <hermes|agent 单元>   # 只停用，不删除、不动其文件
cat > /etc/systemd/system/usst-api.service  /  cat > /etc/nginx/sites-available/usst   # 仅这两个配置文件
curl 127.0.0.1 / 公网自测 ; free -h ; df -h ; ss -tlnp
```

**禁止**：`rm -rf` 任何路径（更新 dist 用 `rsync --delete` 限定在 `/opt/usst/app/dist/`）；`apt upgrade`；动 22/80 以外的防火墙；动 Hermes Agent 的目录内容；把 `.env`/密码 cat 进任何输出；修改 agent 相关端口规则。

**部署失败回滚**：`cp /opt/usst/backup/default /etc/nginx/sites-enabled/default && systemctl reload nginx`；`systemctl stop usst-api`；如已停 agent → `systemctl enable --now <unit>` 还原。回滚动作全部记日志。

**停手条件**：SSH 连不上（凭据失效/服务器失联/未续费到期）→ 不是重试几十次的问题，BLOCKERS + 终止 M5。

## 9. 范围栅栏（git 白名单）

允许新增/修改的路径，`git status` 出现其余路径即违规：

```text
server/account.py  server/sync.py  server/app.py（仅 include_router 两行）
server/requirements.txt  server/version.json
src/features/mobile/**        mobile/**
tests/syncContract.test.ts  tests/mobile/**
scripts/_smoke_account_api.py  scripts/_smoke_sync_api.py
e2e/mobile-smoke.spec.ts
package.json（scripts 段 + 白名单依赖）  package-lock.json  vite.config.ts（多页 input）
m.html  .gitignore（追加忽略项）
docs/overnight-log-2026-10-03.md  BLOCKERS.md
src/features/week/userPlanStore.ts（仅追加可选字段 done?: boolean 与读取兼容，见方案 §7.3）
```

`src/features/week/userPlanStore.ts` 是白名单内**唯一**的既有前端文件，改动必须是最小追加；`App.tsx`、`identity.ts`、`storage.ts`、`types.ts`、`week/` 其余文件一律不动。

## 10. 通宵任务启动指令模板（给用户复制用）

```text
通宵执行光溯移动端落地。
技术方案（唯一依据）：docs/mobile-impl-plan-2026-10-03.md
执行约束（优先级最高，与技术方案冲突时以此为准）：docs/overnight-guardrails-mobile-2026-10-03.md
进度日志（append-only）：docs/overnight-log-2026-10-03.md
服务器：SSH root@101.35.253.143（密码由用户在会话内提供；不入文件不入日志）
按里程碑顺序 M1→M2→M5→M4→M3 执行；每个任务遵守 DoD 四条；收尾跑约束文档 §7 门禁并写完工报告。
```

## 11. 最后一条，也是最重要的一条

**你没有权限对"完成"下宽松的定义。** 本文档每一条反向验证、每一次实跑贴输出、每一条 BLOCKERS，都是为了对冲一个事实：无人值守时，"看起来完成了"和"完成了"之间的差距，只有证据能填。宁可夜末停在 M2 加一份诚实的完工报告，不可交一份全绿的假报告。
