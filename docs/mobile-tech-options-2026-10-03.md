# 移动端技术方案调研（2026-10-03）

> 目标：让"网页端定好的安排"落到手机上，让排程真正进入同学的生活。
> 调研方式：双智能体并行网络调研（开源对标 × 大陆环境可行性核查），来源见附录。
> 本文档是**选型材料**，不是执行方案；§8 列出了需要拍板的决策点。

---

## 0. 结论速览（TL;DR）

1. **没有"拿来改改就能用"的单一开源项目**——没有任何项目同时满足"同步自研排程引擎的周计划 + 当天轻编辑 + 当前日程软提醒 + 账号"完整链路。但拼装路线每一段都有活跃、许可证友好的现成实现：
   - **拾光课程表**（Kotlin，Apache-2.0，活跃）：前三条需求的直接对标物，可抄实现；
   - **Super Productivity**（TS + Capacitor，MIT，22.5k★）："'到点提醒当前该做什么'用本地通知实现"的活教材；
   - **PocketBase**（Go 单二进制 + SQLite，MIT，61k★）：账号 + 数据同步面，512MB 内存级，天然适配我们的 2C2G 服务器；
   - **ICSx⁵ / 系统日历订阅**：后端加一个 ICS 端点，手机订阅一次即得**系统级提醒**。
2. **大陆环境下，"提醒通道"决定一切技术选型**。硬事实：
   - 服务器现在只有 `http://IP:80` → **PWA / Service Worker / Web Push 整条 Web 提醒通道不成立**（SW 仅限 HTTPS/localhost）；
   - 大陆无 GMS 安卓上 **浏览器 Web Push（FCM）事实性失效**，厂商推送通道要求 App 上架应用市场（个人开发者拿不到）→ 安卓可靠提醒只能靠 **App 本地通知** 或 **系统日历订阅**；
   - **ICS 日历订阅是唯一同时覆盖 iOS / 安卓 / 鸿蒙、且不依赖 HTTPS 与备案的系统级提醒通道**（小米、ColorOS 原生支持 URL 订阅，鸿蒙 7 起支持，iOS 原生支持）；
   - 微信小程序做提醒 = 一次性订阅消息（订阅一次发一条）+ **必须备案域名 HTTPS** + 个人备案 1-3 周 → 决赛前"每日自动推送"没有官方保证的无人值守通道；
   - HarmonyOS NEXT **不能装 APK** → 任何"发 APK"路线天然排除鸿蒙用户，而 Web 与 ICS 通道在鸿蒙上照常工作。
3. **推荐主路线：方案一（移动网页"今日页"）+ ICS 订阅打底**，把"方案二（Capacitor 安卓 APK）"作为决赛后的增强项；域名 + ICP 备案**立即启动**（1-3 周，是 iOS 推送 / 小程序 / 正式 HTTPS 的总闸门）。方案三（Expo RN）与方案四（小程序）决赛前不建议。

---

## 1. 需求与约束盘点

### 1.1 你要的三件事 + 一条底座

| 编号 | 需求 | 说明 |
|---|---|---|
| R1 | 手机看**当天行程** | 不复刻网页全部功能，只要"今天" |
| R2 | 对当天行程**简单调整** | 顺延 / 完成 / 换时段这类轻操作，不是完整排程 |
| R3 | **"你现在处于哪个日程"软提醒** | 番茄钟式、低强制感——注意智能边界：提醒是"递地图"，不是替用户拍板 |
| R0 | **账号系统发挥作用的同步底座** | 网页端定好的安排 → 服务器 → 手机 |

### 1.2 硬约束

- **服务器**：上海轻量 2核2G Ubuntu 22.04，Nginx :80 + pm2 + SQLite，**已订阅 1 个月**（决赛 10 月底，时间窗重合；续费约 ¥50-100/月量级）。当前**无域名、无 HTTPS**。
- **现有栈**：React 18 + TS + Vite 前端（三 Tab 壳，无路由库）；**FastAPI + SQLite** 后端（`server/app.py`）；计划数据**浏览器 localStorage 本地优先**（`src/lib/storage.ts`）。
- **两个前置认知冲突，需要正视**：
  1. 部署架构图上写的是"Node.js 后端 (pm2)"，但仓库后端实际是 **FastAPI(Python)**。**建议按 FastAPI 部署**（pm2 也能守护 Python 进程，或用 systemd + uvicorn），为对齐图示重写后端不划算。
  2. `docs/plan-2026-09-21-full.md:329` 记录"跨设备记忆同步（账号体系）CY 已拍板不做；`getUserId()` 已收敛单点"。本次需求等于**正式翻案**：账号体系回来了，但范围收窄为"排程同步的最小账号"，画像/记忆仍本地优先。好消息是 `src/lib/identity.ts` 的 `getUserId()` 单点仍在，接入成本被当年的决定压到了最低。

### 1.3 隐私与红线对齐

- ADR-003 的隐私论证（课表能定位一个人的时空位置，属个人信息）依然成立 → 账号**最小化收集**：昵称/用户名 + 密码即可，**不碰教务账号密码**的红线不变，同步的数据只有"日程块"本身。
- 同步 payload 复用 `WeekPlan` 的"日切片"结构，属跨模块契约：字段增删在 commit message 显式申报，禁止 `any`（与 `src/types.ts` 同级对待）。

---

## 2. 可行性硬事实（核查结论，带来源）

| # | 事实 | 对选型的意义 |
|---|---|---|
| F1 | Service Worker 仅在 HTTPS / localhost 可注册；纯 HTTP 下 PWA 安装、离线、Web Push 全部不成立（MDN：Service Worker API / Secure Contexts） | 现状 `http://IP:80` 下，一切"PWA 网页提醒"方案先出局；先做能跑的，HTTPS 之后才升级 |
| F2 | iOS 16.4+ 主屏 PWA 的 Web Push 走 APNs，大陆 iPhone 机制上可用；但必须 HTTPS + 从 Safari 加主屏启动；**微信内置浏览器不支持 SW/推送** | iPhone 是唯一"网页也能收系统推送"的人群，且是备案/HTTPS 之后的锦上添花 |
| F3 | 大陆无 GMS 安卓：Chrome/Edge 的 Web Push 依赖 FCM 长连接，事实性失效；国产浏览器无标准 Web Push；极光/个推的厂商离线通道**要求 App 上架其应用市场**（个人开发者拿不到），免费额度另有限制 | 不要在任何方案里押注"安卓网页推送"；安卓提醒 = App 本地通知 或 日历订阅 |
| F4 | App **本地定时通知**不走推送通道（系统 AlarmManager 调度），无 GMS 也能响；但国产 ROM 杀后台/Doze 会延迟，需引导用户加电池白名单/自启动（Capacitor/Ionic 社区实测、Android 官方文档） | APK 路线的提醒可靠性 = 本地通知 + 逐机型引导，"决赛 demo 可以，极致可靠要运营成本" |
| F5 | ICS 订阅：iOS 系统日历原生支持（默认约 1h 自动刷新，可手动刷新）；安卓用 ICSx⁵（GPL-3.0，活跃）或小米"日程导入→URL"、ColorOS"添加 URL 日历"；**鸿蒙 7 起系统日历支持 ICS 链接**；日历内的提醒由系统触发 | **唯一全机型、免备案、免 HTTPS 的系统级提醒通道**；后端只加一个端点 |
| F6 | 微信小程序：request 域名必须 HTTPS + ICP 备案（不支持 IP 和端口）；个人主体可上"工具"类目（含待办/番茄钟/日历）；2025 年起小程序上线需先备案；订阅消息 = 订阅一次发一条，"长期订阅"仅限政务/医疗等公共服务类目 | 小程序 = 触达最强但前置最重 + 周期推送无保证；备案没启动前它是纯幻想选项 |
| F7 | 大陆服务器绑域名对外 web 服务**必须 ICP 备案**（未备案 24-72h 内被拦截）；个人备案顺利 2-7 天、一般 1-3 周（管局上限 20 个工作日）；不备案时：纯 IP 的 HTTP 网页、ICS 下发、**App 直连 API** 均可用 | 备案是几乎所有"系统级提醒/正式分发"的总闸门；它 1-3 周的 wall-clock 必须与开发并行 |
| F8 | 2核2G：bge-small-zh-v1.5 约 96MB，fastembed 常驻估计 150-300MB；Nginx + uvicorn + SQLite 合计约 1-1.2GB，偏紧但可行（建议加 swap、开 SQLite WAL）；50-200 学生低频负载远低于瓶颈 | 服务器不是瓶颈；唯一纪律：**别在演示时段跑 `rag.py build`** |
| F9 | HarmonyOS NEXT（纯血鸿蒙）已移除 AOSP，**不能装 APK**；Web / ICS 在鸿蒙上照常工作 | APK 路线的覆盖缺口 = 鸿蒙用户；Web + ICS 恰好补上 |
| F10 | Capacitor 直接包 Vite 构建的 React SPA 是官方支持路径，成熟；坑：HashRouter、`base: './'`、原生能力分支（本项目无路由库，坑更少）；Android 12+ 精确闹钟权限是深坑（Super Productivity issue #10013），软提醒可主动避开 | 方案二技术上低风险，代价在打包流水线与机型适配 |

---

## 3. 开源对标项目（调研汇总）

> 完整明细见附录 A；这里只放对决策有影响的。

| 项目 | 栈 / 平台 | 活跃 | License | 四需求匹配（R1/R2/R3/R0） | 用法 |
|---|---|---|---|---|---|
| [拾光课程表](https://github.com/ShiGuangSchedule/shiguangschedule) | Kotlin 安卓原生 | 2026-10 仍在发版（约 931★） | Apache-2.0 | ✓ / ✓ / ✓（含上课勿扰联动）/ ✗（纯本地） | **抄实现 + 设计对标**；"教务导入接缝"可改造成"从我们后端拉周计划 JSON" |
| [Super Productivity](https://github.com/super-productivity/super-productivity) | TS(Angular) + Capacitor 全平台 | 活跃（22.5k★） | MIT | ✓ / ✓ / ✓ / △（自托管 sync 需另跑 Node） | **抄"当前任务提醒"实现**；其踩坑（精确闹钟权限）直接绕开 |
| [ICSx⁵](https://github.com/bitfireAT/icsx5) | Kotlin 安卓 | 活跃 | GPL-3.0 | △ / ✗ / ✓系统级 / ✓ | **现成组件直接用**（安卓侧订阅器；iOS/国产 ROM 用系统日历） |
| [PocketBase](https://github.com/pocketbase/pocketbase) | Go 单二进制 + 内嵌 SQLite | 活跃（61k★） | MIT | —（是基建不是 App） | **可直接部署的账号+同步面**；与我们 Nginx+SQLite 服务器形态天然兼容 |
| [WakeUp 课程表开源旧版](https://github.com/YZune/WakeUpSchedule) | Java/Kotlin 安卓 | 2018 停更（新版闭源） | **无 license 字段** | ✓ / △ / ✓ / ✗ | **仅设计参考，代码不可合法复用**；其"精确闹钟+单日聚合通知+小部件"思路可借鉴 |
| [下节啥课](https://github.com/baoozak/timetable) | uni-app 多端 | 2026-03 | MIT | ✓ / △ / ✓（常驻通知）/ ✗ | 若走小程序/uniapp 路线再回来看 |
| Radicale / Baïkal | Python/PHP CalDAV | 活跃 | GPL | 只同步标准日历对象，装不下"排程参数/画像"业务字段 | 不推荐（还要求用户装 DAVx⁵） |

**对标结论**：把"拾光课程表抄壳（若做 APK）+ ICS 订阅白拿系统级提醒 + PocketBase 或 FastAPI 自建做同步"拼起来，自研工作量被压缩到只剩：**一个今日页 UI + 一个 ICS 端点 + 一层账号/同步 API**。

---

## 4. 共用地基 M0：任何方案都绕不开（建议先做）

无论选哪个方案，R0 这条底座都是同一个，且它是网页端的增量改造，与移动端选型解耦：

### 4.1 最小账号体系（服务端，FastAPI 增量）

- 表：`users(id, username, pass_hash, created_at)`、`user_plans(user_id, plan_date, payload TEXT/JSON, updated_at, rev)`。
- 接口：`POST /api/auth/register`、`POST /api/auth/login`（签发 token）、`GET/PUT /api/plan/day?date=`、`GET /api/plan/week?from=`。
- 密码哈希用 stdlib `hashlib.pbkdf2_hmac`，token 用 HMAC 签名——**不新增第三方依赖**就能起步；后续要换 JWT 库再说。
- 冲突策略第一版从简：按 `updated_at` 的"最后写入胜出"，rev 字段留升级空间。

### 4.2 网页端云同步（前端增量，复用 `getUserId()` 单点）

- localStorage 仍是本地优先的数据源；新增"云同步"开关（默认关），开启后：登录 → 全量推一次 → 之后变更防抖上传 + 启动时按 `updated_at` 合并。
- **不改排程引擎**，同步的是 `BuildWeekPlanResult` 的日切片，契约纪律同 §1.3。

### 4.3 ICS 订阅端点（服务端，1 天量级，性价比之王）

- `GET /api/schedule.ics?token=<每用户固定令牌>`：把该用户未来 N 天的计划输出为 ICS，每个日程块带 `VALARM`（如提前 10 分钟）。
- 用户在 iPhone 系统日历 / 小米日历"日程导入" / ColorOS"URL 日历" / 鸿蒙日历 / 安卓 ICSx⁵ 里**订阅一次，长期有效**。
- 这一步交付的就是 R3 的第一版："到点系统日历弹提醒：现在应该在高数作业（图书馆三楼）"。**不依赖 HTTPS、不依赖备案、不依赖装任何我们自己的 App**，决赛演示效果直观（手机日历自动有课表+提醒）。
- 注意 ICS 是**只读**通道：R2 的"轻调整"仍要回到网页/App，改完日历下次刷新自动跟上。

### 4.4 服务器部署纠偏

- 按 **FastAPI + uvicorn（1-2 worker）+ systemd 或 pm2 守护** 部署（pm2 完全可以管 Python 进程），Nginx 反代 :80 不变；SQLite 开 WAL；加 2G swap。
- 不要为了对齐架构图把后端重写成 Node.js。
- 运维纪律：演示时段禁止跑 `rag.py build`（fastembed 会吃满 2 核）。

---

## 5. 四个候选方案（功能上确有差异）

### 方案一：移动网页「今日页」+ ICS 打底（推荐主体）

**形态**：现有 React 前端新增一个移动布局入口（如 `#/today` 或独立 `m.html`，无路由库正好省事），服务端同一套 Nginx 托管。iPhone/安卓/鸿蒙**浏览器打开即用**，可"添加到主屏幕"当图标用（无 SW 时只是快捷方式）。

**功能实现方式**：
- R1 当天行程：今日页读 `/api/plan/day`，时间轴 + 当前块高亮；
- R2 轻编辑：复用周计划编辑模式的交互子集（拖动/顺延/勾完成），改完回传 `PUT /api/plan/day`；
- R3 提醒：**ICS 系统日历订阅**（到点系统提醒，全机型可靠）+ 页面内的"当前日程"软横幅（页面开着时有效）；
- R0：M0 直连。

**优势**：工期最短、零分发门槛（发链接即用）、全机型覆盖（含鸿蒙）、决赛演示稳。
**局限**：页面关掉就没有页面内提醒（靠 ICS 补）；HTTPS 之前没有 PWA 安装/推送；微信里打开体验打折（引导"用浏览器打开"）。
**工期估算**：M0（3-4 天）+ 今日页（4-6 天）+ ICS（1 天）≈ **1.5-2 周**，与备案流程并行。
**HTTPS + 备案落地后的免费升级**：加 Service Worker → 变成可安装 PWA；iOS 用户解锁 Web Push（服务器主动推"梨宝帮你改了明天的安排"这类远程变更触达）。

### 方案二：Capacitor 壳安卓 APK（复用整个前端的"真 App"路线）

**形态**：同一份前端打包成 APK 直装分发（扫码下载，无应用商店审核）；iPhone 不做壳（iOS 直装无解，TestFlight 要苹果开发者账号 ¥688/年），继续走方案一的网页。

**功能实现方式**（相比方案一的增量）：
- R3 提醒升级：`Local Notifications` 插件按当日计划**本地批量调度**全天通知——"下一个：14:00 高数作业"，不依赖网络与推送通道，无 GMS 可用；可做常驻式"正在：××（还剩 25 分钟）"通知，最接近番茄钟形态；
- 远程变更触达：打开 App 时拉取 + 通知重排（推送通道在大陆安卓基本死掉，见 F3，不押注）；
- 分发注意：APK 走 `http://IP:80` API 需开 cleartext 许可（调试期可，正式建议等 HTTPS）；**鸿蒙 NEXT 用户装不了 APK**（F9），给他们网页版。

**优势**：提醒体验上限显著高于网页（本地通知 + 可做桌面小部件）；改动集中在壳与提醒模块，业务代码全复用。
**局限与风险**：国产 ROM 杀后台需**逐机型引导白名单**（做一页"提醒不响？点这里"的自查引导，参考 dontkillmyapp.com）；新增打包流水线（Android SDK/签名）；鸿蒙用户排除。
**工期估算**：在方案一基础上 **+4-6 天**（含真机调试与引导页）。
**开源参考**：拾光课程表（Apache-2.0）的提醒/勿扰实现、Super Productivity 的本地通知调度姿势。

### 方案三：Expo / React Native 原生「今日页」（体验上限最高，决赛前不建议）

**形态**：用 RN 新写一个只含"今日页 + 轻编辑 + 提醒 + 登录"的原生 App；`src/types.ts`、API 封装与若干纯逻辑 TS 文件可跨仓共享，但**全部 UI 与交互重写**，长期两套前端并行维护。

**增量能力**：动效与手势体验上限、桌面小部件、后台任务（WorkManager）等原生能力天花板最高。
**代价**：1 个月内要学 RN + 过 Expo 打包 + 双端适配，工期 **+10-15 天** 起；推送死穴与方案二相同（FCM 失效、厂商通道要上架）；决赛前风险收益比最差。
**定位**：作为决赛**之后**、如果项目继续运营且想要"正式产品感"时的演进方向；届时方案二（Capacitor）的经验和 M0 契约全部平移。

### 方案四：微信小程序（触达最强，前置最重，推送最弱）

**形态**：Taro（React 语法）新写小程序；扫码/搜一搜/群分享即达，**免安装**——校园传播面确实最强。

**功能实现方式**：
- R1/R2：与方案一同构（读同一套 M0 API），UI 全重写；
- R3 提醒：**订阅消息**——一次性订阅 = 订阅一次发一条；用户勾选"总是保持以上选择"后可静默续订，靠反复收集授权**近似**做到"明早提醒你今天安排"，但**没有官方保证的无人值守每日推送**（长期订阅仅限政务/医疗等类目）；"实时知道你现在在哪个日程"这种推送形态做不了；
- 前置硬门槛（F6/F7）：**ICP 备案域名 + HTTPS**（不支持 IP/端口）、个人主体"工具"类目审核、2025 年起上线前需备案。

**优势**：在同学里的触达与传播无出其右（群里甩个码就完事）；决赛演示"扫码即用"观感好。
**局限与风险**：备案 1-3 周卡死上线时间轴；提醒形态受微信规则挤压；UI 全重写（工期 **+8-12 天**，不含备案等待）；个人主体审核存在不确定性。
**定位**：若"免安装触达"对决赛叙事重要，可在备案完成后作为**第三端**补上（与方案一共享全部后端），但不建议作为提醒主通道。

---

## 6. 方案对比总表

| 维度 | 一：网页今日页+ICS | 二：Capacitor APK | 三：Expo RN | 四：小程序 |
|---|---|---|---|---|
| R1 看当天行程 | ✓ | ✓ | ✓ | ✓ |
| R2 当天轻编辑 | ✓ | ✓ | ✓ | ✓ |
| R3 "当前在哪个日程"提醒 | ICS 系统日历（全机型可靠）+ 页内横幅 | 本地通知（最强，最近番茄钟形态） | 本地通知（同左） | 订阅消息（弱，无保证） |
| 远程变更触达（网页/梨宝改了计划） | 开页刷新；HTTPS 后 iOS 可推送 | 开 App 拉取；推送不可押注 | 同左 | 模板消息有限 |
| 覆盖机型 | **iOS+安卓+鸿蒙全覆盖** | 安卓（鸿蒙 NEXT 除外） | 安卓+iOS（iOS 需开发者账号） | 微信用户（最广） |
| 分发门槛 | 发链接，零门槛 | APK 直装（扫码） | 应用市场/签名分发 | 微信审核 + **备案** |
| 是否依赖 HTTPS/备案 | 否（HTTPS 后解锁 PWA/iOS 推送） | 否（建议尽快上 HTTPS） | 否 | **是（硬前置）** |
| 代码复用度 | **~90%（现前端增量）** | ~95%（壳+提醒插件） | ~15%（仅逻辑层共享） | ~30%（Taro 重写 UI） |
| 增量工期（在 M0 之上） | 4-6 天 | +4-6 天 | +10-15 天 | +8-12 天（备案另计 1-3 周 wall-clock） |
| 决赛前风险 | 低 | 中低 | 高 | 高（时间轴不可控） |

---

## 7. 推荐路线（分周节奏，与备案并行）

```
第 0 周（立即）
  ├─ 买域名 + 提交 ICP 备案（¥几十；1-3 周 wall-clock，卡着后面所有升级项）
  ├─ M0：账号 + user_plans 表 + 同步 API + ICS 端点（FastAPI 增量，3-4 天）
  └─ 网页端"云同步"开关接入 identity.ts 单点（1-2 天）

第 1 周
  ├─ 移动网页"今日页"（R1 + R2 轻编辑子集，4-6 天）
  └─ 交付形态：一条链接 + 每人一个 ICS 订阅链接
      → 手机日历到点提醒（R3 v1，全机型含鸿蒙）

第 2 周（备案进度允许时穿插）
  ├─ HTTPS 上线（备案下来后）：SW + PWA 安装 + iOS Web Push（锦上添花）
  └─ （可选，进度富余才做）方案二：Capacitor 打安卓 APK + 本地通知 + 引导页

决赛后
  └─ 按运营数据决定：方案二转正 / 方案四小程序 / 方案三原生演进
```

**为什么不推荐"决赛前上小程序/App 大而全"**：备案与审核的 wall-clock 不可控（F7），提醒通道在微信规则下反而最弱（F6），且 UI 重写挤占排程主线的打磨时间——与"让排程真正进入同学的生活"这个目标相比，先用 1.5 周让**所有人**（不分机型）拿到"日历自动提醒今天的安排"，性价比压倒性。

---

## 8. 需要 CY 拍板的决策点

1. **备案是否今天启动？**（¥域名费 + 1-3 周；不解锁则 PWA/iOS 推送/小程序三选全部冻结——建议启动）
2. **R3 第一版接受"系统日历订阅（ICS）"作为标准吗？**（推荐是；它免安装、全机型，但日历提醒是只读的，编辑仍回网页/App）
3. **安卓 APK（方案二）决赛前做不做？**（建议：主线完成后有富余再做；要接受"逐机型引导白名单"的运营成本）
4. **小程序是否决赛必须？**若是，备案是它的前置，今天不动就赶不上。
5. **账号形态**：用户名+密码自建（推荐，M0 即可）vs 手机号+短信验证码（要买短信服务+实名，成本与周期都高）。
6. **部署口径确认**：后端按仓库的 FastAPI 部署（pm2/systemd 守护 Python），架构图上的"Node.js 后端"按笔误处理？

---

## 附录 A：开源调研明细（智能体 1 输出存档）

| # | 项目 | 链接 | 栈/平台 | Stars | 活跃 | License | 匹配(R1/R2/R3/R0) | 用法 |
|---|---|---|---|---|---|---|---|---|
| 1 | 拾光课程表 | github.com/ShiGuangSchedule/shiguangschedule | Kotlin/安卓 8.0+ | ~931 | 2026-10 | Apache-2.0 | ✓/✓/✓+勿扰/✗ | 抄实现+设计；教务导入接缝可改造 |
| 2 | WakeUp 开源旧版 | github.com/YZune/WakeUpSchedule（及 Kotlin 重构仓） | Java·Kotlin/安卓 | ~29 | 2018 停更 | **无** | ✓/△/✓/✗ | 仅设计参考，代码不可复用（新版闭源） |
| 3 | Super Productivity | github.com/super-productivity/super-productivity | TS+Capacitor/全平台 | ~22.5k | 2026-10 | MIT | ✓/✓/✓/△ | 抄提醒实现；精确闹钟坑见 issue #10013 |
| 4 | ICSx⁵ | github.com/bitfireAT/icsx5 | Kotlin/安卓 | ~399 | 2026-05 | GPL-3.0 | △/✗/✓系统级/✓ | 现成订阅组件 |
| 5 | Fossify Calendar（原 Simple Calendar） | github.com/FossifyOrg/Calendar | Kotlin/安卓 | 未核实 | 活跃 | GPL-3.0 | ✓/✗/✓/△ | 终端呈现件 |
| 6 | 不忘课表 | github.com/psno/buwang-schedule | 未核实 | 未核实 | 未核实 | 未核实 | 一键整学期进系统日历+课前提醒 | 印证 ICS 路线是校园常规解 |
| 7 | 下节啥课 | github.com/baoozak/timetable | uni-app/多端 | ~63 | 2026-03 | MIT | ✓/△/✓常驻/✗ | 小程序路线再回看 |
| 8 | campus-course-app | gitcode.com/2401_87461541/campus-course-app | uni-app-x+uniCloud(uni-id) | 未核实 | 未核实 | 未核实 | 脚手架参考 | — |
| 9 | PocketBase | github.com/pocketbase/pocketbase | Go 单二进制+SQLite | ~61k | 2026-10 | MIT | 账号+同步基建 | 可直接部署（512MB 级内存即可） |
| 10 | Radicale / Baïkal | radicale.org 等 | Python/PHP CalDAV | — | 活跃 | GPL | 同步标准日历对象 | 备选不推荐（业务字段装不下+要 DAVx⁵） |

三件套结论：**拾光课程表（抄壳，若做 APK）+ ICS 订阅（白拿系统级提醒）+ PocketBase 或 FastAPI 自建（账号同步）**——每一段都是活跃维护、许可证友好的现成实现。

## 附录 B：可行性核查来源（智能体 2 输出摘录）

- SW 仅限安全上下文：MDN Service Worker API / Secure Contexts（developer.mozilla.org）
- iOS 主屏 PWA Web Push（APNs）：Apple《Sending web push notifications in web apps and browsers》
- 大陆安卓 FCM 失效：tailchat issue #74、blog.hanlin.press《浏览器通知推送》（2024-12）、Pushy 厂商后台文档
- Expo 通知：docs.expo.dev（本地通知不走 FCM；Push Service 强制 FCM V1 凭据）
- 厂商通道限额/上架要求：docs.jiguang.cn、docs.getui.com
- Capacitor 本地通知与 Doze/OEM 杀后台：Ionic Forum #229733 / #235387、developer.android.com（Doze）、capawesome 电池优化插件、dontkillmyapp
- 小程序订阅消息/类目/域名：developers.weixin.qq.com（订阅消息概览、网络使用说明、服务类目表）、juejin.cn/post/7544323659788288046（2025-09）
- 备案：cloud.tencent.com/document/product/243/19650、help.aliyun.com 备案入门、《2025 使用国内服务器域名不备案的唯一方法》
- ICS 订阅刷新与国产日历：calfeed.ai、ColorOS 官方指南、ChinaCalendar（github.com/YangH9/ChinaCalendar）、ICSx⁵
- 2C2G 负载：huggingface.co/BAAI/bge-small-zh-v1.5 模型卡、fastembed Supported Models、FastAPI+SQLite 轻量部署实例（CSDN，2023）
- 鸿蒙 NEXT 不装 APK：CSDN 鸿蒙专栏、juejin.cn/post/7538662953773842474、卓易通实测（toalan.com）

> 注：标注"未核实"的字段不要引用；本附录仅作选型依据的出处存档。
