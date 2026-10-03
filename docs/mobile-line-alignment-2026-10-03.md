# 光溯移动端线 · 对齐文件（buddy / 新会话 / 协作者入口）

> **这份文件是什么**：移动端线的唯一对齐入口。读完即可接手，不需要翻任何聊天记录。
> **快照时间**：2026-10-03 白天验证批之后（commit `6e76593`）。本文件只描述"现在是什么"，论证过程在引用的底层文档里。
> **一句话**：把网页端排好的周计划落到安卓手机上——看当天行程、轻编辑、番茄钟式软提醒；公网已可用，APK 已可下载，真机走查待做。

---

## 1. 决策基线（已拍板，不要再议，改任何一条都要先找 CY）

| # | 决策 | 内容 |
|---|---|---|
| 1 | 只做安卓 | 测试机 Mate 40E（鸿蒙4，安卓内核可装 APK）；iPhone / 纯血鸿蒙 NEXT / 小程序**不做** |
| 2 | App 身份 | 名"光溯"，包名 `com.usst.lightpath`，图标字标临时生成 |
| 3 | 裸跑 | `http://101.35.253.143:80`，无域名/备案/HTTPS/PUSH——提醒全走**本地通知 + 页内横幅** |
| 4 | 账号最小化 | 昵称+密码（pbkdf2），不含任何敏感信息；**不碰教务账号密码**（老红线） |
| 5 | 不落整周计划 | 同步的是"重算状态包"，移动端本地 `planWeek()` 重算（尊重 `types.ts:368` 既有决策）；已算 WeekPlan 仅作 ICS 副本 |
| 6 | 单后端 | FastAPI 自建账号/同步（约 200 行）；**不用 PocketBase / 推送服务 / Redis**（2G 内存单进程原则） |
| 7 | ICS 兜底保留 | `/api/sync/plan.ics?token=` 给不装 APK 的同学白拿系统级提醒 |
| 8 | 版本与分发 | APK 直装（扫码/链接），无应用市场；应用内检查更新走 `/api/version` |

## 2. 底层文件（本文件的上游，按需深读）

| 文件 | 作用 |
|---|---|
| `docs/mobile-tech-options-2026-10-03.md` | 选型依据：四方案对比、大陆可行性事实 F1~F10、开源对标 |
| `docs/mobile-impl-plan-2026-10-03.md` | **技术契约**：F1~F18 功能表、端点签名、SyncState schema、DDL、部署手册 §9、验收矩阵 §10 |
| `docs/overnight-guardrails-mobile-2026-10-03.md` | 执行纪律：DoD/反自欺条款/白名单（改代码或再跑无人值守前必读 §2/§4/§9） |
| `docs/overnight-log-2026-10-03.md` | **事实与证据**：夜班 M1-M3 完工报告 + 白天验证批（含全部实测输出与环境坑） |
| `BLOCKERS.md` 尾部三条 | M5/M4/F8 结项记录（2026-10-03 白天验证批） |

## 3. 现状快照

### 3.1 代码地图（都在 beta-v2，**未 push**）

```
server/account.py        注册/登录/令牌（POST /api/auth/register|login）
server/sync.py           GET|PUT /api/sync/state（LWW）、/api/sync/plan?weekNo=、
                         /api/sync/plan.ics?token=、/api/version
server/app.py            仅 +2 行 include_router（其余零改动）
m.html                   移动端独立入口（vite 多页，index.html/App.tsx 主流程不侵入）
src/features/mobile/     MobileApp/LoginPage/TodayPage/BlockCard/EditSheet/
                         TomorrowPreview/WeekGlance/IcsGuide/WhitelistGuide
                         + lib/{api,auth,sync,webSync,planCompute,useNow,notifyBridge,types}
mobile/                  Capacitor 壳：capacitor.config.ts + android/（原生工程）
                         + signing/（keystore，gitignored）
src/App.tsx              F8 接线一处 useEffect（installWebSyncHook，开关默认关）
tests/syncContract.test.ts（11）tests/mobile/notify.test.ts（4）
e2e/mobile-smoke.spec.ts（2）scripts/_smoke_account_api.py / _smoke_sync_api.py
```

### 3.2 功能状态（F 编号 = impl-plan §1）

- **DONE**：F1~F15、F17、F18（其中 F13/F14/F15 的**真机行为**待 Mate 40E 走查；F15 为静态文本 v1）
- **stretch 未做**：F16 桌面小部件、通知倒计时跳动、BootReceiver 开机重排、APK 内置离线包
- **门禁基线**：tsc 0 / engine 496·0 / ui 413·0 / gate_overnight 全 PASS（只增不减）
- **git**：本地 beta-v2 领先 origin 若干提交未 push（push 需 CY 拍板）

### 3.3 线上状态（2026-10-03 验收通过）

- 后端 `systemd: usst-api`（uvicorn:8000）+ nginx:80，公网 `/`、`/m.html`、`/api/*` 全 200
- 探针账号 `deployprobe`（userId=1）留在库中，可删可留
- fastembed 模型在服务器**首次向量调用时才下载**（~100MB），第一个 `/api/search` 会慢一次——正常现象

## 4. 运行环境事实（踩过的坑，操作前必读）

| 事实 | 影响 |
|---|---|
| SSH 用户是 **`ubuntu`**，不是 root（Hermes Agent 应用镜像） | `ssh ubuntu@101.35.253.143`；公钥已布置（id_ed25519）；root 会 AUTH FAIL |
| 服务器是 **Ubuntu 24.04.4**（非架构图的 22.04），自带 1.9G swap | swap 步骤不需要 |
| **caddy 占过 80**（Hermes Agent 入口），已 `disable --now caddy`（未删除） | 别再启它；agent 想恢复就 `enable --now caddy` |
| systemd unit 带 `PYTHONPATH=/opt/usst/app:/opt/usst/app/server` | uvicorn 以 `server.app:app` 引导的 import 依赖它，改 unit 前看日志 |
| **data/ 必须全目录同步**（campus_vocab.json 等在 import 期被读），只传 `usst_articles.db` 会启动失败 | 实测踩过：`FileNotFoundError .../data/campus_vocab.json` |
| 服务器部署布局：`/opt/usst/app/{server,scripts,data,dist}` + `/opt/usst/venv` | nginx root 指 `/opt/usst/app/dist` |
| 本机：**dl.google.com 被墙**；SDK 包唯一可达官方源 = **`googledownloads.cn/android/repository/*`**（文件名从 repository2-1.xml 解析，platform-34 实为 `platform-34-ext12_r01.zip`、platform-tools 是 `...-win.zip` 非 `-windows`） | 重装 SDK/换机时照此走，别再试国内第三方镜像（全灭，记录在日志） |
| maven 走**阿里云镜像**（google/central/gradle-plugin 优先），gradle 发行版走 github 资产可达 | `mobile/android/build.gradle` 已改，别改回去 |
| 仓路径含中文（`学术部`）→ `gradle.properties` 有 `android.overridePathCheck=true` | 删掉这行 gradle 直接构建失败 |
| 本机工具链：`.venv`（uv 3.12.13）、JDK17 `D:\Android\jdk-17.0.20.1+1`、SDK `D:\Android\Sdk`，`JAVA_HOME`/`ANDROID_HOME` 已 setx | 新开终端即生效 |
| 凭据：keystore 密码在 `mobile/signing/signing.properties`（gitignored，已交 CY 保管）；SSH 密码已在聊天中出现过，**建议 CY 尽快改** | 日志/文档里永不出现密码明文 |
| apt 可能撞 unattended-upgrades 的 dpkg 锁 | 等锁释放重试，**不要杀进程** |

## 5. 日常操作手册（copy-paste）

```bash
# ── 本地开发 ──────────────────────────────────────────────
PORT=8001 .venv/Scripts/python.exe server/app.py        # 后端（cwd=仓库根）
npm run dev                                             # 前端 → 5173；移动页 = /m.html
# 前端连 8001：VITE_API_BASE=http://127.0.0.1:8001（见 src/lib/api.ts）

# ── 门禁与测试（提交前必过）────────────────────────────────
npm run typecheck && npm run test:engine && npm run test:ui
node scripts/gate_overnight.mjs
.venv/Scripts/python.exe scripts/_smoke_account_api.py   # 期望 ACCOUNT ALL OK
.venv/Scripts/python.exe scripts/_smoke_sync_api.py      # 期望 SYNC ALL OK
npx playwright test e2e/mobile-smoke.spec.ts             # 期望 2 passed

# ── 出新 APK（版本变更时三处同步改：app/build.gradle versionName
#    + server/version.json + APK 文件名）──────────────────
npm run build && npx cap sync android
cd mobile/android && ./gradlew assembleRelease --no-daemon
# 产物 mobile/android/app/build/outputs/apk/release/app-release.apk（已签名）
cp .../app-release.apk dist/apk/lightpath-<ver>.apk
tar -czf - dist/apk | ssh ubuntu@101.35.253.143 'tar -xzf - -C /opt/usst/app'
# 验证：curl -sI http://101.35.253.143/apk/lightpath-<ver>.apk → 200

# ── 发后端/前端更新 ───────────────────────────────────────
cd <仓库根>
tar --exclude='__pycache__' --exclude='.env' -czf - server scripts \
  | ssh ubuntu@101.35.253.143 'tar -xzf - -C /opt/usst/app'
tar -czf - data --exclude='data/libao_memory.db' | ssh ubuntu@... 'tar -xzf - -C /opt/usst/app'
tar -czf - dist | ssh ubuntu@... 'tar -xzf - -C /opt/usst/app'
scp -q server/.env ubuntu@101.35.253.143:/opt/usst/app/server/.env   # 只传不 cat
ssh ubuntu@101.35.253.143 'sudo systemctl restart usst-api && systemctl is-active usst-api'

# ── 服务器排障 ────────────────────────────────────────────
ssh ubuntu@101.35.253.143 'systemctl status usst-api --no-pager | head -10; \
  sudo journalctl -u usst-api -n 40 --no-pager | tail -20; \
  curl -s http://127.0.0.1:8000/api/health'
```

## 6. 边界与红线（buddy 执行时）

1. **契约**：`src/types.ts` 与 SyncState schema 是契约层——字段增删必须在 commit message 申报，禁止 `any`；本线至今**零改动 types.ts**，请保持。
2. **智能边界**（project-core §4）：提醒文案是"递地图"口吻，不做强制、不替用户拍板。
3. **无人值守**：任何通宵/闲时执行，`overnight-guardrails-mobile-2026-10-03.md` 全文适用（白名单路径、依赖白名单、DoD、反自欺条款）。
4. **范围**：不做 iOS/小程序/推送/备案（要解锁先看调研文档 §2 的 F7——备案是总闸门）；移动端**不做整周重排**（那是网页端+引擎的职责）。
5. **服务器**：只动 `/opt/usst/**` 与 usst-api/nginx 两个配置；Hermes Agent/caddy/tat_agent 只停用不删除；`.env`/keystore 永不入 git、不入日志。
6. **git**：commit 用 `feat(mobile):`/`fix(mobile):`/`docs(mobile):` 前缀，本地小步提交，**push 前问 CY**。

## 7. 下一步（按优先级，2026-10-03 时点）

1. **真机走查**（Mate 40E 装_apk）：通知权限弹窗、开始前 10 分钟+开始时刻两条通知、动作按钮（完成/顺延 15）、重启手机后打开 App 恢复提醒、F17 白名单引导页三机型路径。
2. **服务器续费**——**10-25 12:17 到期，卡在决赛前**，只有 CY 能在控制台点。
3. SSH 密码更换（公钥已通，改密码零影响）。
4. P1 收尾小项：persona 加进 SyncState（schemaVer 前向兼容）、F11 快捷指令接 `/api/plan/understand` 真端点、ICS 对 web-only 用户为空的提示。
5. F16 桌面小部件 + 通知倒计时（stretch，需原生代码，决赛后再议）。
6. push beta-v2 与 dev 合并（关联 BLOCKERS 里 unrelated histories 大事，与移动端无关但同树）。

## 8. FAQ 速查

- **构建报 "non-ASCII characters"**？→ `gradle.properties` 的 `android.overridePathCheck=true` 被删了，加回来。
- **gradle 解析依赖超时**？→ `mobile/android/build.gradle` 的阿里云镜像行被改掉了。
- **服务器 502/接口全挂**？→ `systemctl status usst-api` + journalctl；十有八九是 data/ 没同步全或 `.env` 没传。
- **APK 装上没通知**？→ 先走 F17 引导页（华为：设置→电池→启动管理→手动管理三开关）；重启手机后要打开一次 App 重排通知（已知限制，见 impl-plan §8.2）。
- **改动 SyncState 结构**？→ schemaVer +1、客户端忽略未知字段的条款同步检查、commit message 申报。
