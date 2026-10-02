# 光溯移动端完整实施方案（方案一 → 方案二 · 2026-10-03）

> **执行身份**：本文档是通宵无人值守实施的唯一技术依据。执行时**必须同时遵守** `docs/overnight-guardrails-mobile-2026-10-03.md`；两文档冲突时，**约束文档优先**。
> **调研依据**：`docs/mobile-tech-options-2026-10-03.md`（可行性事实 F1~F10、开源对标）。
> **仓库事实**：2026-10-03 集成点探索结论，引用标注 `file:line`。
> **范围**：方案一全部功能（P0+P1）+ 方案二全部功能（P2）。排除项见 §1 末尾。

---

## 0. 里程碑、顺序与砍线

| 里程碑 | 内容 | 预估 | 完成判据（DoD 细则见约束文档 §3） |
|---|---|---|---|
| M1 | M0 服务端：账号 + 同步 + ICS | 2.5h | 两个冒烟脚本 `ALL OK` + 门禁绿 + curl 实录 |
| M2 | 移动 H5 今日页闭环 | 3h | e2e 手机视口通过 + §10 手动验收清单逐条实录 |
| M5 | 服务器部署 + 公网验收 + APK 上架 | 2h | §10 部署验收全过（**先于 M4**：APK 的 server.url 指向公网） |
| M4 | Capacitor APK（壳+通知+白名单页） | 3h | `assembleRelease` 产物存在 + 版本接口可用；真机联调留白天 |
| M3 | 网页端云同步钩子（P1） | 1.5h | 双端一致性用例通过 |

**执行顺序 = M1 → M2 → M5 → M4 → M3**。
**砍线规则**：任一里程碑超预算 50% 或门禁修不回 → 按约束文档 §6 记 BLOCKERS，跳下一个里程碑；通宵时间耗尽时停在最近里程碑，完工报告如实记录。M4 依赖白天预装（§9.0）；若夜间发现 `ANDROID_HOME` 缺失 → 记 BLOCKERS，跳 M4 先做 M3。

## 1. 范围总表（每条=一个可验收功能）

**P0 · 方案一基础**
- F1 注册/登录（昵称+密码，最小账号）
- F2 今日时间轴：当前块高亮、下一块预告、空状态引导
- F3 日程块详情：时间 / 地点 / 方法备注
- F4 轻编辑三件套：完成勾选 / 顺延 ±15·30·60 分 / 换时段快捷片
- F5 页内"现在"横幅（当前块+剩余分钟，30s tick）
- F6 ICS 订阅端点 + 页内引导（复制链接）
- F7 明日预告（明天块数+第一块时间）

**P1 · 方案一进阶**
- F8 网页端云同步钩子（写入路径挂同步，默认关、开关开）
- F9 "今天有变化"标记（同步前后块级 diff）
- F10 本周剩余概览（只读）
- F11 梨宝快捷指令占位：两个固定快捷问法直连现成 `POST /api/plan/understand`，展示文本回复（不做完整对话流）

**P2 · 方案二 APK**
- F13 本地通知：当日块批量调度（开始前 10 分钟 + 开始时刻）
- F14 通知动作按钮：完成 / 顺延 15 分（点通知按钮直接写覆盖层）
- F15 常驻"正在进行：×× · 至 HH:MM"通知（v1 静态文本；每分钟跳动的倒计时列 stretch）
- F16 桌面小部件 —— **stretch，夜间不做**（Capacitor 小部件生态弱，需原生代码），留给白天
- F17 白名单引导页（华为/小米/通用路径）
- F18 应用内检查更新（`GET /api/version` → 下载 APK）

**明确排除（不做，做了就是越界）**：iOS / 纯血鸿蒙 NEXT / 小程序 / 任何推送服务 / 备案域名与 HTTPS / 移动端整周重排 / 社交排行榜 / 教务账号密码。

## 2. 决策基线（已拍板，不再讨论）

1. App 名：**光溯**；包名 `com.usst.lightpath`；图标用"光溯"字标临时生成。
2. **仅安卓**；测试机 Mate 40E（鸿蒙4，安卓内核），仅 M4 联调用。
3. 裸跑 `http://101.35.253.143:80`（F1：无 HTTPS 则 SW/PWA/推送全部不成立——所以本方案提醒全走本地通知与页内横幅）。
4. 账号只存昵称+密码（pbkdf2 哈希），无手机号/邮箱/教务信息。
5. 服务器 2核2G 上海轻量，镜像保留，**停用 Hermes Agent 自启动**（不删除）。
6. Python 用 uv 已装的 CPython 3.12.13 建仓内 `.venv`，不新装解释器。
7. commit 全部本地 `beta-v2`，`feat(mobile):`/`fix(mobile):`/`chore(mobile):`/`docs(mobile):` 前缀，小步可回滚，push 前问用户。
8. 密码/密钥/.env 永不进 git、永不写进日志正文。

## 3. 系统架构

```
手机 APK（Capacitor 壳）
  └─ WebView 加载打包进 APK 的 dist（m.html 今日页）
       └─ server.url = http://101.35.253.143  （cleartext 显式允许）
            │  HTTP（仅 /api 与下载）
            ▼
┌─ 服务器 101.35.253.143（2C2G Ubuntu）────────────────┐
│ nginx :80                                            │
│   ├─ /            → 静态 dist（index.html 主站）      │
│   ├─ /m.html      → 移动今日页入口                     │
│   ├─ /apk/*       → lightpath-x.y.z.apk 下载          │
│   └─ /api/*       → 反代 127.0.0.1:8000               │
│ uvicorn:8000 (systemd 守护, cwd=/opt/usst/app)        │
│   ├─ server/app.py（现有，仅增 2 行 include_router）  │
│   ├─ server/account.py（新：注册/登录/令牌）           │
│   ├─ server/sync.py（新：状态/周计划/ICS/version）     │
│   └─ SQLite: data/libao_account.db（运行时生成,       │
│              gitignored）+ data/usst_articles.db(只读)│
└──────────────────────────────────────────────────────┘
```

单进程原则：**不引入 PocketBase/Redis/第二个常驻服务**（F9：2G 内存预算 ~1.2GB，见 §4）。

## 4. 开源选型（选择性使用，含许可证合规）

| 组件 | 许可证 | 用法 | 红线 |
|---|---|---|---|
| @capacitor/core / cli / android / local-notifications / preferences | MIT | **直接依赖**：壳、本地通知、KV 存储 | 版本锁定见 §8.1，只此 5 件 |
| ICSx⁵ | **GPL-3.0** | **仅作为用户侧推荐组件**（安卓订阅 ICS 用） | **一行代码/资源不进本仓**（防 GPL 传染）；iOS/鸿蒙用户用系统日历，无需装 |
| Super Productivity | MIT | 模式参考：本地通知调度姿势；**规避**其踩过的 Android 12+ `SCHEDULE_EXACT_ALARM` 精确闹钟深坑（调研 issue #10013） | 不拷代码（Angular≠React），仅借鉴行为 |
| 拾光课程表 | Apache-2.0 | 设计参考：提醒/勿扰交互、"通知条目聚合"思路 | 不拷代码（Kotlin）；若未来真改编其代码须附 NOTICE——本方案预计零拷贝，不适用 |
| dontkillmyapp.com | 公开资料 | 白名单引导页的机型路径素材 | 文字改写，不搬运页面 |

**明确不用 + 理由**（写入决策记录，防止夜间执行时"顺手引入"）：
- **PocketBase**：单后端原则——FastAPI 已在且 `app.py` 只需 +2 行挂路由；自建账号/同步约 200 行；2G 内存不养第二个常驻进程；避免两套 SQLite 生态。
- **Radicale/Baïkal**：标准 CalDAV 装不下"排程参数/画像/覆盖层"业务字段，还要求用户装 DAVx⁵。
- **极光/个推等推送**：F3——大陆无 GMS 上 Web/FCM 推送全灭，厂商通道要上架市场；我们提醒走本地通知，**根本不需要推送**。

## 5. 数据契约（字段级，禁止 `any`，禁止改 `src/types.ts`）

### 5.1 SyncState payload（`schemaVer = 1`）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| schemaVer | int | 是 | 恒为 1 |
| termStart | "YYYY-MM-DD" | 是 | 学期第一周周一（`src/types.ts:67`） |
| weekNo | int | 是 | 当前周号 |
| schedule | object | 是 | 课程表对象**原样序列化**（`JSON.parse(JSON.stringify())` 剔除不可序列化项；字段以 `src/types.ts` Schedule 定义为准） |
| planState | object | 否 | `AppState.planState`（锁/lockedPlacements/rolling，`types.ts:374-406`） |
| userOverrides | object | 否 | `userPlanStore` 覆盖层 JSON 原样（key `usst-user-plan-v1`，`userPlanStore.ts:37`） |
| clientUpdatedAt | ISO-8601 UTC | 是 | LWW 依据 |

**前向兼容条款**：客户端对不认识的字段一律忽略；服务端只透传不解释 payload。
**契约纪律**：本方案**零改动 `src/types.ts`**；新增类型全部放 `src/features/mobile/types.ts`（局部类型）。sync 数据结构若有结构性变化，必须在 commit message 显式申报（AGENTS.md 契约层同等对待）。

### 5.2 冲突规则（LWW）

- 服务端 `sync_state.updated_at` 与请求 `clientUpdatedAt` 比 ISO-UTC 字符串。
- `clientUpdatedAt > updated_at` → 写入，返回 `{accepted: true, updated_at: 服务端时间}`。
- 否则**不写入**，返回 `200 {accepted: false, updated_at, state: 服务端当前副本}`；客户端提示"以云端为准"。
- 无时间戳/非法格式 → 400。

### 5.3 WeekPlan 副本仅作 ICS 素材

尊重 `types.ts:368-373`"不存整周计划、引擎随时重算"的既有决策：**权威状态 = SyncState**；客户端本地 `planWeek()` 重算视图。已算好的 `WeekPlan`（`BuildWeekPlanResult.plan`）仅作为副本 PUT 上来喂 ICS 生成，服务端不校验其内部逻辑。

## 6. 服务端设计

### 6.1 文件与改动面

- 新增 `server/account.py`、`server/sync.py`（各含一个 `APIRouter`）。
- `server/app.py` **仅**在 `:62` 旁加 `app.include_router(account.router)`、`app.include_router(sync.router)` 两行，其余零改动（无 lifespan，沿用模块级懒加载；沿用 `:77-87 _load_env`）。
- SQLite 模式沿用仓内惯例：**每次调用现开连接、用完即关**（同 `server/memory.py:54-69` `_conn()`），天然线程安全。
- 生成 `server/requirements.txt`（venv `pip freeze` 落库，版本锁定）。

### 6.2 DDL（`data/libao_account.db`，首次访问时由服务进程创建；`.gitignore` 增补该文件）

```sql
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  pass_salt  TEXT    NOT NULL,            -- 16B 随机盐 hex
  pass_hash  TEXT    NOT NULL,            -- pbkdf2 hex
  ics_token  TEXT    NOT NULL UNIQUE,     -- 32B urlsafe（日历订阅用，免鉴权头）
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tokens (
  token_hash TEXT PRIMARY KEY,             -- sha256(token) hex，原文不落库
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,                    -- 'hmac_secret' 等服务端自用
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_state (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id),
  schema_ver  INTEGER NOT NULL,
  payload     TEXT NOT NULL,               -- §5.1 JSON
  updated_at  TEXT NOT NULL                -- ISO-8601 UTC
);
CREATE TABLE IF NOT EXISTS week_plans (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  week_no    INTEGER NOT NULL,
  payload    TEXT NOT NULL,               -- WeekPlan JSON（仅 ICS 素材）
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, week_no)
);
```

### 6.3 密码与令牌

- 密码：`hashlib.pbkdf2_hmac('sha256', pwd.encode(), salt, 200000, dklen=32)`，存 hex；盐 16B `secrets.token_bytes`。**零第三方依赖**。
- 登录令牌：`secrets.token_urlsafe(32)`；库里存 `sha256(token)`；有效期 90 天（`created_at` 过期校验）。鉴权头 `Authorization: Bearer <token>`。
- ICS 令牌：users 表 `ics_token`，仅供 `plan.ics?token=` 使用；泄露可重置（白天功能，夜间不做重置接口）。

### 6.4 端点签名表

| # | Method Path | 鉴权 | 请求体 | 成功响应 | 错误 |
|---|---|---|---|---|---|
| 1 | POST `/api/auth/register` | 无 | `{username, password}` | `{userId, token}` | 400 格式（用户名 `^[A-Za-z0-9_\u4e00-\u9fa5]{2,24}$`、密码 6~64 位）；409 `{"error":"username_taken"}` |
| 2 | POST `/api/auth/login` | 无 | `{username, password}` | `{userId, token}` | 401 `{"error":"bad_credentials"}` |
| 3 | GET `/api/sync/state` | Bearer | – | `{found, state|null, schemaVer, updatedAt}` | 401 |
| 4 | PUT `/api/sync/state` | Bearer | `{state, schemaVer, clientUpdatedAt}` | `{accepted, updatedAt, state?}` | 400/401 |
| 5 | GET `/api/sync/plan?weekNo=N` | Bearer | – | `{found, plan|null, updatedAt}` | 401 |
| 6 | PUT `/api/sync/plan?weekNo=N` | Bearer | `{plan}` | `{updatedAt}` | 400/401 |
| 7 | GET `/api/sync/plan.ics?token=` | query | – | `text/calendar; charset=utf-8` | 404 |
| 8 | GET `/api/version` | 无 | – | `{version, apkUrl, notes}` | – |

统一错误形态 `{"error": "<code>"}`；所有端点挂 `/api` 前缀与现有 CORS（`app.py:64-74`）——`.env` 增补 `LIBAO_CORS_ORIGINS=http://101.35.253.143,capacitor://localhost,https://localhost,http://localhost:5173`。

### 6.5 ICS 生成规则

- 输入：`week_plans` 中 weekNo∈{当前周-1, 当前周, 当前周+1} 的副本（以 SyncState.termStart 推算"当前周"）。
- 时间换算：`日期 = termStart + (weekNo-1)*7 + (dayOfWeek-1) 天`，`startMin/endMin` 为当日分钟偏移 → 浮动本地时间（`DTSTART:20261005T080000`，不带 TZID；面向大陆单时区用户可接受，注释里写明）。
- 每块：`BEGIN:VEVENT` + `UID:<sha1(blockId@weekNo)>@lightpath` + `SUMMARY:<emoji?>title · place` + `DESCRIPTION:reason/room`；`BEGIN:VALARM` → `TRIGGER:-PT10M`（ACTION:DISPLAY）。
- F5 依据：ICS 订阅 = 唯一全机型免备案系统级提醒通道（iOS/鸿蒙/小米/ColorOS 原生，安卓可选 ICSx⁵）。

### 6.6 `/api/version`

读 `server/version.json`（部署时放置）：`{"version":"0.1.0","apkUrl":"http://101.35.253.143/apk/lightpath-0.1.0.apk","notes":"首个测试版"}`。文件不存在 → 404 JSON。

## 7. 前端 H5 设计（方案一）

### 7.1 入口与目录

- Vite 多页：根目录新增 `m.html`（挂载 `#mobile-root`，main 引 `src/features/mobile/MobileApp.tsx`）；`vite.config.ts` 增 `build.rollupOptions.input = {main: 'index.html', mobile: 'm.html'}`——**index.html / App.tsx 主流程零改动**（无路由库，独立入口最干净）。
- 目录：`src/features/mobile/` 下 `MobileApp.tsx`（登录态分流）、`LoginPage.tsx`、`TodayPage.tsx`、`BlockCard.tsx`、`EditSheet.tsx`、`TomorrowPreview.tsx`、`WeekGlance.tsx`（F10）、`IcsGuide.tsx`（F6）、`lib/{api,auth,sync,useNow,notifyBridge,types}.ts`（notifyBridge 在 web 环境空实现，在 Capacitor 环境走插件——能力分支集中此一处）。
- 登录态：token 存 localStorage `usst.mobile.token`；**不碰 `identity.ts`**（其 `getUserId()` 是设备级 ID，保持原语义）。

### 7.2 数据流

```
登录成功 → GET /api/sync/state
  ├─ found=false → 提示"去网页端排计划后回来同步"（空状态）
  └─ found → (可选合并) → 本地 planWeek({schedule, weekNo, planState, ...}) 重算
              → 取 userOverrides 渲染今日时间轴（dayOfWeek==今天）
编辑(轻编辑三件套) → 写 userPlanStore 覆盖层（唯一写法，复用既有函数）
  → 本地即时重算 → debounce 1s → PUT /api/sync/state + PUT /api/sync/plan（重算后的整周副本）
  → notifyBridge.rescheduleToday()（APK 内）
```

### 7.3 轻编辑 → 覆盖层映射（以 `userPlanStore.ts` 现有覆盖类型为准，仅追加可选字段）

| 操作 | 覆盖层效果 |
|---|---|
| 完成勾选 | 条目追加 `done?: boolean = true`（读取处向后兼容：无此字段=未完成；store 迁移容忍缺失） |
| 顺延 ±15/30/60 | `{startMin: +Δ, endMin: +Δ}` |
| 换时段快捷片 | `{startMin: 新值, endMin: 新值}`（移动端不做自由拖拽，给 ±15/±30/±60 六个片） |

### 7.4 其余

- F5 横幅：`useNow(30_000)` tick；当前块 = `startMin<=now<endMin`；剩余分钟取整。
- F7 明日预告：`(today%7)+1` 的块列表（跨周由 weekNo 逻辑处理，复用引擎）。
- F9 变化标记：每次 sync 后对当日块列表做稳定哈希（`id+startMin+endMin+done`），变化则顶部提示条"今天的安排有更新"。
- F11 快捷指令：两个固定按钮（"今天还有啥"/"帮我顺延下一块"）→ 前者本地计算，后者直接走 F4 顺延；不调 LLM，避免夜间 Key 依赖（understand 集成留白天）。
- 样式：Tailwind 移动布局（`w-full` 纵向流 + `pb-safe` 适配）；不引入组件库。
- e2e：`e2e/mobile-smoke.spec.ts`，视口 390×844：注册→POST 演示 schedule 到 sync→打开 /m.html→断言今日块渲染→点顺延→断言覆盖层 localStorage 与 PUT 请求体。

## 8. APK 设计（方案二，Capacitor）

### 8.1 依赖与配置（依赖白名单 = 约束文档 §2，锁定版本）

```bash
npm i @capacitor/core@6 @capacitor/cli@6 @capacitor/android@6 \
      @capacitor/local-notifications@6 @capacitor/preferences@6
npx cap init "光溯" com.usst.lightpath --web-dir dist
```

`mobile/capacitor.config.ts`：
```ts
const config = {
  appId: 'com.usst.lightpath',
  appName: '光溯',
  webDir: '../dist',
  android: { path: 'mobile/android', allowMixedContent: true },
  server: { url: 'http://101.35.253.143', cleartext: true }, // F7：裸跑期
};
```
（`server.url` 指向公网 = WebView 直接加载在线 m.html，APK 体积最小且更新即时；内置离线包作为 stretch，夜间不做。）

### 8.2 本地通知调度（F13/F14，Super Productivity 模式 + 规避精确闹钟）

- 触发时机：**每次同步成功 / App 进前台 / 手动刷新** → 全量重排当日剩余通知（覆盖式，幂等）。
- 每个剩余块两条：`开始前 10 分钟`（"即将开始：14:00 高数作业 · 图书馆三楼"）+ `开始时刻`（"现在开始：高数作业 · 至 15:40"）。
- 通知 id = `stableHash(blockId + date) % 10^8`（确定性，便于覆盖替换）。
- 动作按钮 `actionTypeId: 'block-actions'` = [完成✓, 顺延15]；`localNotifications.on('actionPerformed')` → 直接写覆盖层（done / startMin+15）→ 重排 → 下次 sync 上报。
- **不申请 `SCHEDULE_EXACT_ALARM`**：用非精确调度（`allowWhileIdle`），延迟分钟级可接受——符合"软提醒"定位，绕开 Android 12+ 权限深坑。
- 已知风险（诚实登记）：**手机重启后 AlarmManager 排程丢失**，插件重启重排支持有限。缓解：①引导页写明"重启手机后打开一次 App 即恢复提醒"；②每次打开 App 全量重排；③stretch（夜间不做）：自定义 BootReceiver。
- 常驻通知（F15）：块开始时发布 id 固定的通知"正在进行：高数作业 · 至 15:40"，块结束时 `unregister`；每分钟跳动的倒计时需前台服务/原生代码，列 stretch。

### 8.3 白名单引导页（F17，素材改写自 dontkillmyapp）

- 华为/鸿蒙4：设置→电池→启动管理→光溯→关闭"自动管理"→手动管理三个开关全开（允许自启动/关联启动/后台活动）；设置→通知→光溯→允许。
- 小米：设置→应用设置→应用管理→光溯→省电策略→无限制。
- 通用：链接 dontkillmyapp.com 对应机型页。
- 入口：首次启动弹层 + 设置页常驻"提醒不响？点这里"。

### 8.4 打包与签名

```bash
# keystore（一次性；密码交用户保管，文件在 mobile/signing/，gitignored）
keytool -genkeypair -v -keystore mobile/signing/lightpath.keystore \
  -alias lightpath -keyalg RSA -keysize 2048 -validity 10000
npm run build && npx cap sync android
cd mobile/android && ./gradlew assembleRelease
# 产物：mobile/android/app/build/outputs/apk/release/app-release.apk
```

### 8.5 检查更新（F18）

App 启动/设置页拉 `GET /api/version` → semver 比较 → 新版则跳浏览器下载 `apkUrl`（nginx `/apk/` 直链）。APK 文件名 ASCII：`lightpath-0.1.0.apk`。

## 9. 部署手册（命令级；服务器操作全程受约束文档 §8 限制）

### 9.0 白天预装清单（给用户的行动项，夜间缺失即 BLOCKERS）

- 本机：JDK 17（Temurin）；Android SDK cmdline-tools + `platform-tools`、`platforms;android-34`、`build-tools;34.0.0`；环境变量 `ANDROID_HOME`。
- 服务器凭据可用性（重启后密码生效）；控制台防火墙已放行 TCP:80（已做）。

### 9.1 服务器初始化（SSH root@101.35.253.143）

```bash
apt-get update && apt-get install -y nginx python3-venv
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
mkdir -p /opt/usst/app/{server,data,dist/apk} /opt/usst/backup
```

### 9.2 Hermes Agent 停用（只停不删）

```bash
systemctl list-units --type=service --state=running | grep -iE 'hermes|agent'
systemctl disable --now <上一步查到的 unit 名>
free -h   # 复核内存释放，输出贴日志
```

### 9.3 代码与数据

```bash
# 本机 → 服务器（rsync 增量，排除敏感/垃圾）
rsync -az --delete --exclude '.env' --exclude '__pycache__' server/ root@101.35.253.143:/opt/usst/app/server/
rsync -az data/usst_articles.db root@101.35.253.143:/opt/usst/app/data/
rsync -az --delete dist/ root@101.35.253.143:/opt/usst/app/dist/
scp server/.env root@101.35.253.143:/opt/usst/app/server/.env   # 只传不 cat
ssh root@... 'python3 -m venv /opt/usst/venv && /opt/usst/venv/bin/pip install -r /opt/usst/app/server/requirements.txt'
```

### 9.4 systemd unit（`/etc/systemd/system/usst-api.service`）

```ini
[Unit]
Description=USST Lightpath API (FastAPI/uvicorn)
After=network.target
[Service]
WorkingDirectory=/opt/usst/app
Environment=PORT=8000
Environment=LIBAO_CORS_ORIGINS=http://101.35.253.143,capacitor://localhost,https://localhost,http://localhost:5173
ExecStart=/opt/usst/venv/bin/uvicorn server.app:app --host 127.0.0.1 --port 8000 --workers 1
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
```
（cwd 对齐仓库根布局：`app.py` 内相对路径 `data/…`、`server/.env` 均能解析。）

### 9.5 nginx（`/etc/nginx/sites-available/usst` → 软链 sites-enabled，删 default 软链前先备份）

```nginx
server {
  listen 80 default_server;
  root /opt/usst/app/dist;
  index index.html;
  location /m.html { try_files $uri =404; }
  location /apk/   { alias /opt/usst/app/dist/apk/; }
  location /api/   { proxy_pass http://127.0.0.1:8000; proxy_set_header Host $host; proxy_read_timeout 120s; }
  location /       { try_files $uri $uri/ /index.html; }
}
```
上线命令：`nginx -t && systemctl reload nginx`；**原 default 配置先 `cp` 到 /opt/usst/backup/**（回滚点）。

### 9.6 部署验收（全部贴日志）

```bash
curl -s http://127.0.0.1:8000/api/health
curl -sI http://101.35.253.143/ | head -1            # HTTP/1.1 200
curl -sI http://101.35.253.143/m.html | head -1      # 200
curl -s http://101.35.253.143/api/health             # 经 nginx 反代
curl -s -X POST http://101.35.253.143/api/auth/register -H 'Content-Type: application/json' -d '{"username":"probe1","password":"probe123"}'
curl -s "http://101.35.253.143/api/sync/plan.ics?token=<上面返回后补造>" | head -3
curl -s http://101.35.253.143/api/version
free -h   # 最终内存水位
```

## 10. 验收矩阵（功能 → 证据）

| 功能 | 验证方式 | 期望 |
|---|---|---|
| F1 注册/登录 | 冒烟脚本 `scripts/_smoke_account_api.py`（TestClient+tempfile DB） | 输出含 `ACCOUNT ALL OK`（含重名 409、错密 401 的**反向断言**） |
| F2-F7/F9/F10 | 冒烟 `scripts/_smoke_sync_api.py` + e2e `e2e/mobile-smoke.spec.ts` | `SYNC ALL OK`；e2e 全绿 |
| LWW 冲突 | 冒烟内：旧时间戳再 PUT | `accepted=false` 且返回服务端副本 |
| F6 ICS | 冒烟：造 week_plan→GET plan.ics | `BEGIN:VCALENDAR`、`BEGIN:VEVENT`、`BEGIN:VALARM` 计数正确 |
| F8 云同步钩子 | TS 测试 `tests/syncContract.test.ts`（序列化往返+LWW 决策函数） | 全绿；开关关=零网络请求断言 |
| F13/F14 通知 | APK 真机手动（白天）；夜间验证=构建通过+调度代码单测（时间计算纯函数 tests/mobile/notify.test.ts） | 单测全绿；真机项记入"白天待验" |
| F15/F17/F18 | 构建产物存在 + 引导页渲染（e2e 断言节点存在） | 通过 |
| M5 部署 | §9.6 curl 清单 | 全部符合期望 |
| 门禁 | `npm run typecheck` / `test:ui` / `test:engine` / `node scripts/gate_overnight.mjs` | 0 错；pass 只增不减 |

## 11. 风险与回滚点

| 阶段 | 风险 | 回滚 |
|---|---|---|
| M1 | app.py 挂路由后老接口受影响 | revert 该 commit（只含 +2 行与新文件） |
| M2 | m.html 多页影响主站构建 | vite input 改回单页 revert |
| M3 | 钩子引发意外上传 | 钩子默认关闭（开关不开=零网络） |
| M4 | gradle 构建失败 | 不出 APK 即无影响；产出物不入 git |
| M5 | nginx 配置坏 | `cp /opt/usst/backup/default` 恢复 + reload；`systemctl stop usst-api`；agent `enable --now` 还原 |
| 全程 | 密钥泄露 | .env 只 scp；keystore gitignored；日志禁止粘贴敏感值 |

## 12. 调研事实 → 设计决策对照（防"凭感觉设计"）

- F1（无 HTTPS 无 SW/PWA）→ 提醒主通道=本地通知+页内横幅，Web Push 整体不做。
- F3（大陆安卓推送死）→ 零推送依赖；远程变更靠"打开即同步"。
- F4（本地通知可靠但受 ROM 杀后台）→ 白名单引导页 + 非精确调度。
- F5（ICS 全机型免备案）→ ICS 端点保留为 F6（给不装 APK 的同学兜底）。
- F7（备案是 HTTPS/小程序总闸门）→ 裸跑；全部功能不依赖备案。
- F8（2C2G 够用）→ 单进程 uvicorn+SQLite WAL+2G swap；演示时段禁跑 `rag.py build`。
- F9（鸿蒙 NEXT 不装 APK）→ 范围已排除；ICS/网页仍兜底。
- F10（Capacitor 包 Vite SPA 成熟，坑=路由/base）→ 独立 m.html 无路由库天然规避；`server.url` 模式不涉及资源相对路径问题。

## 13. 需要用户配合的事（执行方遇阻时对照）

1. 白天预装 JDK/SDK（§9.0）——否则 M4 转 BLOCKERS。
2. 服务器重启（密码生效）已做；续费（10-25 到期）——执行方无法代劳，若临期未续费导致服务器失联 → BLOCKERS 停部署。
3. M4 阶段 Mate 40E 连 USB + 华为账号登录 + USB 调试；keystore 密码保管。
4. push 授权与白天人工验收。
