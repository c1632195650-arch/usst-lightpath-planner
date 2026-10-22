# 光溯 · 服务器迁移交接报告（供 RAY 复核）

> **报告日期**：2026-10-22
> **执行**：CY 侧（ZCode 协助）
> **范围**：线上服务器从 `101.35.253.143` 整体迁到 `43.142.141.186`，含数据、代码、运维配置与安卓客户端
> **结论**：迁移已完成并验收通过；旧机保留为回滚点并把请求转发到新机，10-25 12:17 到期后失效
> **代码提交**：`cee3631`（本地 `beta-v2`，**未 push**）

---

## 一、三句话结论

1. **新地址是 `http://43.142.141.186`**，网页、`/m.html`、`/api/*`、课表解析、APK 下载全部已在新机跑通。
2. **数据是整库搬的**：20 个账号、12 份云端待办状态、6 份周计划、23 个梨宝会话、98 条消息、11 条记忆事实、11 条课表，`integrity_check` 全部 ok，登录后能取回原有数据。
3. **客户端必须换 0.4.10**：旧 APK 的 API 地址硬编码在包里，指向旧机。旧机现在做纯转发，所以旧包在 10-25 前仍能用、也能应用内升级；10-25 后旧包彻底失效。

---

## 二、拓扑变化

| 项 | 迁移前 | 迁移后 |
|---|---|---|
| 公网入口 | `http://101.35.253.143` | **`http://43.142.141.186`** |
| SSH | `ubuntu@101.35.253.143` | `ubuntu@43.142.141.186`（私钥，**root 不接受该私钥**） |
| 机器 | 腾讯云 2C2G / Ubuntu 24.04.4 / 50G | 同规格，swap 1.9G |
| Web | nginx :80 → `/opt/usst/app/dist` | 同路径 |
| API | uvicorn `127.0.0.1:8000`，systemd `usst-api` | 同路径、同 unit 名 |
| 反代 | `/api/`、`/timetable/` | 同 |
| 旧机 | 正常服务 | **降级为纯转发**：`/api/`、`/timetable/`、`/apk/` → 新机；其余 `301` 到新 IP |

旧机的转发配置备份：`/opt/usst/backup/nginx-pre-migration-20261022.conf`。
回滚只需把该文件还原到 `/etc/nginx/sites-available/usst` 再 `nginx -t && systemctl reload nginx`（旧机 `usst-api` 仍在运行、旧库未动）。

---

## 三、迁移了什么（逐项核对）

| 资产 | 旧机路径 | 新机路径 | 结果 |
|---|---|---|---|
| 账号/同步库 | `app/data/libao_account.db` | 同 | users 20 / tokens 109 / sync_state 12 / week_plans 6 |
| 梨宝记忆库 | `app/data/libao_memory.db` | 同 | sessions 23 / messages 98 / facts 11 / profiles 2 |
| 导入课表 | `app/data/course_records.json` | 同 | 11 条课程（全局文件，不按用户隔离） |
| 后端密钥 | `app/server/.env` | 同（`chmod 600`） | 3 个键：`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` |
| 代码 | `app/server`、`app/scripts` | 同 | 349 MB / 380 文件，与旧机逐一 md5 对齐 |
| 前端产物 | `app/dist` | 同 | 139 MB（含 14 个历史 APK） |
| 模型缓存 | `/home/ubuntu/.workbuddy/cache/fastembed` | 同 | 182 MB / 13 文件 |
| venv | `/opt/usst/venv` | 同（**重建**） | Python 3.12.3，`pip install -r server/requirements.txt pdfplumber` |
| 每日快照 | `/opt/usst/backup/2026*-0417` | 同 | 7 天的 `app-server-data.tgz` 已搬齐；新机 21:36 自建一份 |
| 运维配置 | nginx / systemd / crontab / snapshot.sh | 同 | 已按新 IP 重写，cron 每日 04:17 |

**有意未搬**：旧机 `backup/dist_pre_*` 15 份（约 1.8 GB 历史前端上线备份，可由仓库重建）。

---

## 四、验收证据（实测，不是推断）

| 检查 | 结果 |
|---|---|
| `GET /api/health` | `{"ok":true,"llm":true,"model":"deepseek-chat"}` |
| 公网 `/`、`/m.html` | 200 / 200 |
| `gigity` 登录 | 200，userId=7，icsToken 正常 |
| `GET /api/sync/state` | `found=true`，`updatedAt=2026-10-08T03:44:33Z`（原数据） |
| `GET /api/sync/plan?weekNo=8` | 200 |
| `GET /courses` | 11 条 |
| `GET /api/sync/plan.ics` | `BEGIN:VCALENDAR`，38 个 VEVENT |
| `GET /api/search` | 200，返回文章 |
| `POST /api/chat` | LLM 合成，命中食堂营业时间 |
| CORS（Origin=新 IP） | `access-control-allow-origin: http://43.142.141.186` |
| APK 下载 | 200，9,110,276 B |
| 旧 IP 打 `/api/health`、登录、ICS | 全部经旧机转发到新机，正常 |
| `npm run typecheck` | 0 错 |
| `npm run test:ui` | 459 pass / 0 fail |

---

## 五、代码改动（commit `cee3631`）

只动了 4 个源文件 + 3 个文档，**没有碰引擎、`types.ts`、`features/week`**：

| 文件 | 改动 |
|---|---|
| `src/lib/apiBase.ts:20` | `INLINE_API_FALLBACK` 旧 IP → `http://43.142.141.186` |
| `server/version.json` | 0.4.9 → **0.4.10**，versionCode 16，apkUrl 指新机 |
| `package.json` | `version` 0.4.10（版本号单一来源） |
| `mobile/android/app/build.gradle` | versionCode 16 / versionName 0.4.10 |
| `docs/server-asset-inventory-2026-10-22.md` | 新增：完整盘点 + 执行记录 + 回滚 |
| `AGENTS.md` | 顶部加新地址提示 |
| `BLOCKERS.md` | 两条迁移留痕 |

`node scripts/release_version.mjs` 四处一致校验通过。

---

## 六、客户端 0.4.10

- **为什么必须重出**：APK 是包内资源模式，页面离线可用，但 API 地址编译在 JS 里。旧包只认 `101.35.253.143`。
- **怎么重出的**：以线上 0.4.9 的 `dist-mobile` 为基线，**只替换共享 chunk 里的 IP 常量**，并清理 38 个无引用的旧哈希产物；功能代码与 0.4.9 完全一致。没有重新编译业务代码，避免把 10-11 维护批的未部署改动带进客户端。
- **产物**：`dist/apk/lightpath-0.4.10.apk`，9.1 MB，versionCode 16。
- **签名**：SHA-256 `7b742acd6c54664812a83b9f1c62df7fa2ce1d91ee481bfa3b5c15942e656568`，与 0.4.9 **同一个证书** → 可直接覆盖安装，App 数据保留。
- **分发**：新机 `/apk/lightpath-0.4.10.apk`。旧包在 10-25 前可通过应用内「检查更新」拿到它（旧机把 `/api/version` 转发到新机）。

---

## 七、新机运维口径（接手前必读）

```bash
# 登录（私钥向 CY 索取；root 不接受该私钥）
ssh -i SLGS.pem ubuntu@43.142.141.186

# 服务
sudo systemctl status usst-api      # 目录 /opt/usst/app，User=ubuntu
sudo systemctl restart usst-api
sudo systemctl reload nginx         # 站点 /etc/nginx/sites-available/usst
crontab -l                          # 17 4 * * * /opt/usst/backup/snapshot.sh

# 日常排查
sudo journalctl -u usst-api -n 80 --no-pager
curl -s http://127.0.0.1:8000/api/health
```

几个**踩过的坑**，别再踩：

1. **模型缓存在 `~/.workbuddy/cache/fastembed`**，不是 `/opt/usst/app/model_cache`。`scripts/rag.py:25` 用 `FASTEMBED_CACHE_PATH` 指向前者；丢了它、又开着 `HF_HUB_OFFLINE=1`，`/api/search` 直接 500（报 `Could not load model BAAI/bge-small-zh-v1.5`）。
2. **`server/requirements.txt` 不含 `pdfplumber`**，但 `server/timetable_parser/` 依赖它。重建 venv 时必须显式装，否则课表导入 500。
3. **`data/` 要整目录同步**。只传 `usst_articles.db` 会在启动时报 `FileNotFoundError: data/campus_vocab.json`。
4. **systemd 的 `LIBAO_CORS_ORIGINS` 里必须包含新 IP**，否则网页能开、接口全被 CORS 拦。
5. **caddy 原本占 80**（Hermes 入口），已 `disable --now`，别把它启回来。

---

## 八、已知风险与未完成项

| # | 事项 | 影响 | 建议 |
|---|---|---|---|
| 1 | **线上代码仍是 10-08 版**，10-11 维护批（memory WAL、登录限速、请求体 413、身份闸）未部署 | 线上没有这些加固 | 下一批单独做，先在预发验证再上；本次为降低迁移风险刻意没带 |
| 2 | 旧 APK 只认旧 IP | 10-25 后登录/同步全挂 | 尽快分发 0.4.10；旧机转发只兜底到到期 |
| 3 | `gigity/123456` 弱口令、7 个探针账号仍在库里 | 安全债 | 演示前改口令；探针账号可清 |
| 4 | 新机 `data_pins.json` 仍是旧值 524/519/1889（与 `usst_articles.db` 实际的 520/515/1873 不一致），`health_kb.db` 仍是 35 条（本地 36 条） | 跑 `gate:data` 会报漂移；检索行为与本地差 1 条 | 按「整库迁移」原样保留；要对齐仓库时再单独换这两个文件 |
| 5 | 备份只有本机（7 天快照） | 机器挂则备份同归于尽 | 按维护计划 P1-1 加异地副本/Litestream |
| 6 | `/opt/usst/backup/dist_pre_*` 1.8 GB 未搬 | 旧机到期即丢 | 可由仓库重建，无需搬 |
| 7 | 新机 `dist/` 里还有未被引用的旧哈希 chunk（含旧 IP 字符串） | 不影响运行（没有入口引用） | 要洁癖可在下次 build 后整体替换 `dist/` |
| 8 | 本次 commit 只在本地 `beta-v2`，**未 push** | 远端没有这笔提交 | 按仓库纪律由 CY 决定何时 push |
| 9 | 没有域名/TLS，仍是裸 HTTP | 无法 HTTPS、无法免备案 | 维护计划 P0-2 已登记，决赛后做 |

---

## 九、给 RAY 的复核建议

如果只看三处，建议按这个顺序：

1. **数据**：用 `gigity` 登录（口令问 CY），看 `/api/sync/state` 是否 `found=true`、`updatedAt` 是否为 10-08，确认不是空库。
2. **客户端**：`curl -sI http://43.142.141.186/apk/lightpath-0.4.10.apk`；装到安卓机后确认登录、今日页、梨宝、课表导入四条链路。
3. **代码**：`git show cee3631 --stat`，确认只动了 IP/版本/文档，没有碰引擎和 `types.ts`。

开发时的两个硬约束（沿用原纪律）：

- 不要在任何地方再写死服务器地址；唯一解析点是 `src/lib/apiBase.ts`。
- 改前端后如果要出 APK，顺序是 `npm run build` → `python scripts/prep_mobile_dist.py` → `npx cap sync android` → `gradlew assembleRelease`，版本号四处同步后用 `node scripts/release_version.mjs` 校验。

---

## 十、相关文档

| 文件 | 内容 |
|---|---|
| `docs/server-asset-inventory-2026-10-22.md` | 完整盘点、逐项资产、迁移执行记录、验收、回滚（本报告的上游） |
| `BLOCKERS.md` 2026-10-22 两条 | 迁移留痕与待决事项 |
| `AGENTS.md` 顶部 | 新地址提示 |
| `docs/mobile-line-alignment-2026-10-03.md` | 移动端线历史口径（其中的旧 IP 属历史记录） |

---

*报告完。需要补充任何一项的原始命令输出，我可以从旧机/新机现场再取。*
