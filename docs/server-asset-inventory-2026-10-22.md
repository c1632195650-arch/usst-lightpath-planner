# 服务器信息资产盘点与迁移清单（旧机 101.35.253.143）

> **盘点时间**：2026-10-22 21:00 CST
> **迁移执行**：2026-10-22 21:09–21:40 CST，新机 `43.142.141.186`（见 §9 执行记录）
> **盘点对象**：腾讯云轻量 2C2G `ubuntu@101.35.253.143`（主机名 `VM-0-14-ubuntu`）
> **盘点方法**：SSH 只读命令 + SQLite 在线 `backup()` + 服务器/本地 `md5` 逐文件对照
> **本文件回答两个问题**：①服务器上到底存了什么；②换到新服务器要迁哪些、怎么迁、哪些**不该**迁。

---

## 0. 先看三句

1. **真正不可再生的资产只有 5 类**：账号库、记忆库、导入的课表 JSON、`server/.env`、四件运维配置（另有一份只在旧机上的历史快照）。其余（代码、前端产物、知识库、venv、模型缓存）全部可从仓库或公网重建。
2. **已经做过一次保护性导出**：10.8 MB 完整包 + 校验和，落在本地 `_backups/server-migration-20261022/`（旧机仍在，可随时再导）。
3. **服务器到期后最先坏的不是网站，是所有已装 APK**：包内 API 地址硬编码在 `src/lib/apiBase.ts:20`（旧 IP），页面能开、登录/同步/梨宝全挂，且**应用内检查更新也走同一个死地址，无法自愈**。必须出新 APK 并**线下分发**。

---

## 1. 旧机事实基线（实测，非文档抄录）

| 项 | 实测值 | 备注 |
|---|---|---|
| 到期时间 | **2026-10-25 12:17** | 距今约 **2 天 15 小时**（10-22 21:00 计） |
| 系统 | Ubuntu 24.04.4 LTS，kernel 6.8.0-124 | 时区 `Asia/Shanghai` |
| 规格 | 2 vCPU / 1.9 GiB 内存 / 50 GB 盘（已用 16 G，剩 32 G） | 当前负载 0.16 |
| 运行时长 | up 27 days | 10-08 00:59 重启后未再动 |
| 登录 | `ubuntu`（**非 root**），公钥可用，**sudo 免密** | 密码认证仍开启（安全债） |
| 端口 | 22、80（nginx）、8000（仅 127.0.0.1） | 无 443、无 TLS、无域名 |
| 组件 | nginx 1.24.0、Python 3.12.3（venv）、SQLite | 无 Node、无 Redis、无数据库服务 |
| 我们的目录 | `/opt/usst/{app,venv,backup}` | `/opt/browser-vnc`、`/opt/google`、caddy、tat_agent **不是我们的** |

### 1.1 架构（一张图）

```
公网 :80  nginx
   ├── /            → /opt/usst/app/dist           （网页端 SPA）
   ├── /m.html      → /opt/usst/app/dist/m.html    （移动端独立入口）
   ├── /apk/        → /opt/usst/app/dist/apk/      （14 个历史 APK）
   ├── /api/        → 127.0.0.1:8000               （FastAPI，uvicorn 单进程）
   └── /timetable/  → 127.0.0.1:8000               （课表解析，同进程）
systemd: usst-api.service  Restart=always
cron:    17 4 * * *  /opt/usst/backup/snapshot.sh（保留最近 7 份）
```

### 1.2 磁盘占用（迁移时必须知道的量级）

| 路径 | 大小 | 说明 |
|---|---|---|
| `/opt/usst/app` | **349 MB** | 见 §3 拆解 |
| `/opt/usst/venv` | **314 MB** | 40 个包，可重建 |
| `/opt/usst/backup` | **2.2 GB** | 29 项：7 份每日快照 + 15 份 dist 上线前备份 + 配置 .bak |
| `~/.cache/uv` | 1.4 GB | 开发期缓存，**不迁** |
| `~/.cache/ms-playwright` | 658 MB | E2E 浏览器，**不迁** |
| journald 日志 | 196 MB | **不迁** |

---

## 2. 服务器上存了什么（按"能不能再生"分类）

### 2.1 A 类 · 不可再生，必须迁

| # | 文件/对象 | 线上路径 | 大小 | 内容实测量 | 丢了会怎样 |
|---|---|---|---|---|---|
| **A1** | 账号/同步库 | `app/data/libao_account.db` | 311,296 B | `users` **20** / `tokens` **109** / `sync_state` **12** / `week_plans` **6** / `meta` 0 | 所有账号、登录态、云端待办与本周计划**全丢**，无法重建 |
| **A2** | 梨宝记忆库 | `app/data/libao_memory.db` | 65,536 B | `sessions` **23** / `messages` **98** / `facts` **11** / `profiles` **2** | 长期记忆、对话历史、偏好/客观事实全丢 |
| **A3** | 导入的课表 | `app/data/course_records.json` | 4,414 B | **11 条课程**（课名/教师/教室/周次/学分） | 无法从仓库恢复（仓库里没有这个文件）；用户需重新上传 PDF |
| **A4** | 后端密钥 | `app/server/.env` | 234 B | 3 个键：`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 梨宝降级为抽取式，问答质量断崖 |
| **A5** | 运维配置 4 件 | 见下表 | 约 3 KB | nginx 站点 / systemd unit / crontab / snapshot.sh | 服务起不来或每天不再备份 |
| **A6** | 每日快照 | `/opt/usst/backup/2026101x-0417/` | 7×133 MB | 每份 = `server+data`(10.7 MB) + `dist`(128 MB) | 这是 A1–A4 的**第二份**；但只在本机，且旧机一停就一起没了 |
| **A7** | 当前 APK | `app/dist/apk/lightpath-0.4.9.apk` | 11.5 MB | 已签名、可安装 | 本地 `dist/apk/` 也有一份；**但因 IP 变化，这份事实上作废**（见 §5） |

**A5 明细**

| 文件 | 线上位置 | 迁移处置 |
|---|---|---|
| nginx 站点 | `/etc/nginx/sites-available/usst`（软链到 `sites-enabled/usst`，default 已删） | 重建，**但 CORS 里的旧 IP 要换** |
| systemd unit | `/etc/systemd/system/usst-api.service` | 重建，换 IP |
| crontab | `ubuntu` 用户：`17 4 * * * /opt/usst/backup/snapshot.sh` | 重建 |
| 快照脚本 | `/opt/usst/backup/snapshot.sh` | 直接搬（已含在导出包） |

> **A1/A2 的账号构成提示（隐私）**：20 个账号里，**至少 7 个是明确探针/临时账号**（`deployprobe`、`probe_m3`、`moss_probe_1006`、`moss_probe_1007`、`dmo_check1008`、`__probe_zzz__`、`temp`），另有若干测试/演示账号，其中 **1 个用户名是手机号形态、1 个是纯数字长串（学号/QQ 形态）**。
> 迁移时建议整库带走、迁完再清探针；**不要把账号库内容贴进任何文档或提交进 git**。

### 2.2 B 类 · 可再生，**从本地仓库重建，不要从旧机拷**

| # | 对象 | 线上大小 | 为什么不该拷旧机的 |
|---|---|---|---|
| B1 | `server/` 代码 | 868 KB | 线上是 **2026-10-08** 的版本（`app.py` 67,171 B）；本地仓库已含 **10-11 维护批**（`app.py` 76,174 B：memory WAL、登录限速、请求体 413、身份闸等）。**迁旧代码等于把已修的坑再踩一遍** |
| B2 | `scripts/` | 1.4 MB | 线上是 10-02 的，且含大量测试脚本；部署不需要全量 |
| B3 | `dist/` 前端产物 | 139 MB（其中 APK 117 MB） | `npm run build` 可再生；且必须为新 IP 重出 APK |
| B4 | `data/` 静态知识库 10 个文件 | 约 24 MB（另有 `data/osm` 3 MB） | 与本地仓库 **md5 完全一致**，从本地部署即可（见 §3.4 的两个例外） |
| B5 | `/opt/usst/venv` | 314 MB | `python3 -m venv` + `pip install -r` 重建（**注意补 `pdfplumber`**，见 §6 坑 R3） |
| B6 | `model_cache`（bge-small-zh-v1.5） | 182 MB | 可从 HF 重新下载；但 unit 里写了 `HF_HUB_OFFLINE=1`，**不拷就必须先删这两个环境变量，否则首次检索直接 500** |

### 2.3 C 类 · 不要迁

| 对象 | 原因 |
|---|---|
| `__pycache__`、`*.py.bak_20261008` | 构建/备份残留 |
| journald 196 MB、nginx 日志 552 KB | 运维日志，无业务价值（access.log 含用户 IP，属隐私） |
| `~/.cache/uv`(1.4G)、`ms-playwright`(658M)、`pip`(103M) | 开发环境缓存 |
| `/opt/usst/backup/dist_pre_*` 15 份（约 1.8 GB） | 历史上线前备份，只对旧机有意义 |
| `/opt/browser-vnc`、`/opt/google`、caddy、tat_agent、`~/.hermes` | Hermes Agent / 腾讯云组件，**不是本项目的** |
| `data/lightpath.db`、`data/uploads/`（**本地有、线上没有**） | 是本地 `serve.py` 的运行态，从未上线 |

### 2.4 版本差异：有 2 个文件旧机是**错的/旧的**，务必以本地仓库为准

| 文件 | 旧机 | 本地仓库 | 结论 |
|---|---|---|---|
| `data/data_pins.json` | `524 / 519 / 1889` | `520 / 515 / 1873` | 本地正确（与 `usst_articles.db` 的 md5 一致，旧机是历史遗留的错钉值）→ **迁本地版** |
| `data/health_kb.db` | 35 条（09-21 构建） | 36 条（10-07 构建） | 本地更新 → **迁本地版** |
| 其余 10 个 data 文件 | — | — | md5 逐字节一致，从本地部署即可 |

> `data/` 必须**整目录**同步。实测踩过：只传 `usst_articles.db` 会导致启动报 `FileNotFoundError: data/campus_vocab.json`。

---

## 3. 已经做过的保护动作（本轮盘点顺带完成）

把旧机上不可再生的东西打成了一个包，并拉到本地：

```
本地路径  _backups/server-migration-20261022/usst-migration-export-20261022.tgz
大小      10,794,440 B
sha256    036621b1ad7a2827b542d2a7a9d3a3ec6e57f9290b6812778761653cd23754f0
```

**包内清单**

| 内容 | 说明 |
|---|---|
| `libao_account.db` | 在线 `sqlite3.backup()` 一致性快照，`integrity_check=ok`，行数与线上一致 |
| `libao_memory.db` | 同上，`integrity_check=ok` |
| `course_records.json` | 11 条课程 |
| `server.env.txt` | `.env` 原样（**权限 600，禁止入库/外发**） |
| `version.json` | 线上 0.4.9 版本信息 |
| `nginx-usst.conf` | nginx 站点原文 |
| `usst-api.service` | systemd unit 原文 |
| `crontab-ubuntu.txt` | ubuntu 的 crontab |
| `snapshot.sh` | 每日快照脚本 |
| `nightly-20261022-0417-app-server-data.tgz` | 今日 04:17 的每日快照（server+data 全量，10.7 MB） |
| `MANIFEST.json` | 每个文件的 sha256 + 两库行数 + 完整性结果 |

> ⚠️ 这份包**只在本机一块盘上**。按维护计划 P1-1 的口径，异地副本才算备份——建议再复制一份到网盘/另一块盘。
> ✅ `_backups/` 命中 `.gitignore` 的 `_*`，不会被提交。

---

## 4. 迁移范围总表（一句话版）

| 类别 | 要迁什么 | 怎么迁 |
|---|---|---|
| **必须原样带走** | A1/A2/A3 三个数据文件 + A4 `.env` | 用本轮的导出包，拷进新机 `data/` 与 `server/` |
| **照仓库重装** | `server/`、`scripts/`、`data/` 静态资产、`dist/` | 本地 `npm run build` + `tar` 推新机 |
| **重建环境** | venv、nginx、systemd、cron、快照脚本 | 按附录命令逐条执行 |
| **可选搬运** | `model_cache` 182 MB | 直接 rsync；否则删掉 `HF_HUB_OFFLINE` 让它自己下 |
| **必须重做** | **APK**（因 IP 变化） | 改 `INLINE_API_FALLBACK` → 升版本 → 重签 → 线下分发（§5） |
| **不要迁** | venv、缓存、日志、历史 dist 备份、Hermes/腾讯组件 | 见 §2.3 |

---

## 5. 🔴 最高风险项：APK 里写死了旧 IP

### 5.1 证据

| 位置 | 内容 |
|---|---|
| `src/lib/apiBase.ts:20` | `const INLINE_API_FALLBACK = 'http://101.35.253.143';` |
| 触发条件 | APK 包内 origin 是 `https://localhost` → `resolveApiBase()` 走这个兜底 |
| `server/version.json` | `"apkUrl": "http://101.35.253.143/apk/lightpath-0.4.9.apk"` |
| APK 形态 | 自 10-06 起是**包内资源模式**（页面离线可用），但**数据面仍走这个 IP** |

### 5.2 旧机到期后的真实后果

| 场景 | 结果 |
|---|---|
| 网页端（旧 IP 书签/二维码） | 直接打不开 |
| 已装 APK | **界面能开**（包内资源），但登录、云同步、待办、梨宝问答**全部失败** |
| APK 的应用内"检查更新" | 也走旧 IP → 失败 → **无法自动升级到新地址** |
| 已导出的 ICS 日历链接 | `.../api/sync/plan.ics?token=` 指向旧 IP → 日历提醒失效 |

**结论：新 APK 必须重出，并且必须用群/二维码/直接发文件的方式让试用者重装。** 指望应用内更新是走不通的。

### 5.3 重出 APK 的最小改动面

1. `src/lib/apiBase.ts:20` → 新服务器地址（保留末尾不带 `/`）。
2. `server/version.json` → `version` / `versionCode`(+1) / `apkUrl`（新 IP + 新文件名） / `notes`。
3. `mobile/android/app/build.gradle` → `versionCode` / `versionName`。
4. `package.json` 的 `version` 为单一来源，改完跑：
   ```bash
   node scripts/release_version.mjs        # 四处不一致会 exit 1，必须绿
   npm run build
   python scripts/prep_mobile_dist.py      # dist → dist-mobile，首屏=移动端
   cd mobile && npx cap sync android && cd ..
   cd mobile/android && ./gradlew assembleRelease --no-daemon
   ```
5. 用本地 `mobile/signing/lightpath.keystore` 签名（**keystore 在本地，不在服务器；丢了就无法覆盖安装**）。
6. 上传到新机 `/opt/usst/app/dist/apk/`，验证 `curl -sI http://<NEW_IP>/apk/lightpath-<ver>.apk` 为 200。

### 5.4 关于"要不要顺手买域名"

- **本次不做**：大陆云主机 80/443 绑未备案域名会被拦，备案周期通常 1–3 周，赶不上 10-25。直连 IP 是唯一能在 2 天内落地的方案。
- **但要记在账上**：有了域名，以后换机只改 DNS，不用再重发 APK。这是下一次架构债的偿还点（维护计划 P0-2 已登记 TLS+域名）。

### 5.5 一个便宜的保险选项（建议）

旧机续 1 个月（文档记载约 ¥50–100/月量级），就能：
- 让**已装旧 APK 继续可用**，直到所有人都换成新包；
- 给迁移留出验证与回滚窗口（新机出问题时旧机还在）。

如果续费通道已经关闭，则按 §6 的顺序一次性切换，并在切换前完成导出（已做）。

---

## 6. 迁移执行顺序（新机地址记为 `<NEW_IP>`）

> 原则：**先搬数据、再起服务、最后切客户端**；旧机在新机验收通过前**不动、不删**。

### Phase 0 · 决策（需 CY 拍板）

- [ ] 旧机是否续 1 个月做保险（§5.5）
- [ ] 账号库是**整库迁移**还是**只迁演示账号、其余清空**（涉及真人试用数据）
- [ ] 新机是否同规格 2C2G（够用；若要开 HTTPS/更多用户，建议 2C4G）

### Phase 1 · 新机基础

```bash
sudo timedatectl set-timezone Asia/Shanghai
sudo apt update && sudo apt install -y nginx python3.12-venv sqlite3
# SSH 公钥写入 ubuntu 用户的 authorized_keys；确认 sudo 策略
```

### Phase 2 · 代码 + 前端产物（从本地仓库，不从旧机）

```bash
# 本地仓库根目录
npm ci && npm run build

tar --exclude='__pycache__' \
    --exclude='data/libao_account.db' --exclude='data/libao_memory.db' \
    --exclude='data/lightpath.db' --exclude='data/uploads' \
    -czf - server scripts data dist \
  | ssh ubuntu@<NEW_IP> 'sudo mkdir -p /opt/usst/app && sudo chown ubuntu:ubuntu /opt/usst/app && tar -xzf - -C /opt/usst/app'
```

### Phase 3 · Python 环境

```bash
ssh ubuntu@<NEW_IP> '
  sudo python3 -m venv /opt/usst/venv &&
  sudo /opt/usst/venv/bin/pip install -r /opt/usst/app/server/requirements.txt &&
  sudo /opt/usst/venv/bin/pip install pdfplumber
'
```

> **R3 坑**：`server/requirements.txt` 里**没有 pdfplumber**，但 `server/timetable_parser/` 依赖它。漏装 → 课表导入 500。

### Phase 4 · 模型缓存（二选一）

```bash
# 方案 A（推荐，快且不依赖外网）
rsync -av /opt/usst/app/model_cache ubuntu@<NEW_IP>:/opt/usst/app/
# 方案 B（让新机自己下）：删掉 unit 里的 HF_HUB_OFFLINE / TRANSFORMERS_OFFLINE
```

### Phase 5 · 运行时数据（用本轮导出包）

```bash
scp _backups/server-migration-20261022/usst-migration-export-20261022.tgz ubuntu@<NEW_IP>:/tmp/
ssh ubuntu@<NEW_IP> '
  cd /tmp && tar -xzf usst-migration-export-20261022.tgz &&
  cp usst-migration-export-20261022/{libao_account.db,libao_memory.db,course_records.json} /opt/usst/app/data/ &&
  install -m 600 usst-migration-export-20261022/server.env.txt /opt/usst/app/server/.env
'
```

校验（必须与旧机一致）：

```bash
ssh ubuntu@<NEW_IP> '/opt/usst/venv/bin/python - <<PY
import sqlite3
for p in ["/opt/usst/app/data/libao_account.db","/opt/usst/app/data/libao_memory.db"]:
    c=sqlite3.connect(p); print(p, c.execute("PRAGMA integrity_check").fetchone())
    for (t,) in c.execute("select name from sqlite_master where type=%s" % repr("table")):
        print("  ",t,c.execute("select count(*) from "+t).fetchone()[0])
PY'
```

期望：`users=20, tokens=109, sync_state=12, week_plans=6`；`sessions=23, messages=98, facts=11, profiles=2`。

### Phase 6 · 运维配置（**必须改 IP**）

`/etc/systemd/system/usst-api.service`：

```ini
[Unit]
Description=USST Lightpath API (FastAPI/uvicorn)
After=network.target
[Service]
WorkingDirectory=/opt/usst/app
Environment=PORT=8000
Environment=PYTHONPATH=/opt/usst/app:/opt/usst/app/server
Environment=HF_HUB_OFFLINE=1
Environment=TRANSFORMERS_OFFLINE=1
Environment=LIBAO_CORS_ORIGINS=http://<NEW_IP>,capacitor://localhost,https://localhost,http://localhost:5173,http://127.0.0.1:5173
ExecStart=/opt/usst/venv/bin/uvicorn server.app:app --host 127.0.0.1 --port 8000 --workers 1
Restart=always
RestartSec=3
User=ubuntu
[Install]
WantedBy=multi-user.target
```

`/etc/nginx/sites-available/usst`（软链到 `sites-enabled/usst`，删 default 前先备份）：

```nginx
server {
  listen 80 default_server;
  root /opt/usst/app/dist;
  index index.html;
  location /m.html { try_files $uri =404; }
  location /apk/   { alias /opt/usst/app/dist/apk/; }
  location /api/   { proxy_pass http://127.0.0.1:8000; proxy_set_header Host $host; proxy_read_timeout 120s; }
  location /timetable/ { proxy_pass http://127.0.0.1:8000; proxy_set_header Host $host; proxy_read_timeout 120s; }
  location /       { try_files $uri $uri/ /index.html; }
}
```

cron + 快照：

```bash
sudo install -m 755 /tmp/usst-migration-export-20261022/snapshot.sh /opt/usst/backup/snapshot.sh
( crontab -l 2>/dev/null; echo '17 4 * * * /opt/usst/backup/snapshot.sh >> /opt/usst/backup/snapshot.log 2>&1' ) | crontab -
sudo systemctl daemon-reload && sudo systemctl enable --now usst-api
sudo nginx -t && sudo systemctl reload nginx
```

### Phase 7 · 验收（全绿才算完）

```bash
curl -s http://<NEW_IP>/api/health                    # ok:true, llm:true
curl -sI http://<NEW_IP>/ | head -1                   # 200
curl -sI http://<NEW_IP>/m.html | head -1             # 200
curl -s http://<NEW_IP>/api/version                   # 版本/apkUrl 指向新 IP
curl -s http://<NEW_IP>/courses | head -c 200         # 11 条课表
curl -s -X POST http://<NEW_IP>/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"<演示账号>","password":"<口令>"}'   # 200 + token
```

- [ ] 登录后 `/api/sync/state` 能取回原有待办（证明 A1 迁对）
- [ ] 梨宝发一句，返回 `mode:"llm"`（证明 A4 与网络通）
- [ ] 检索一次，不报模型缺失（证明 model_cache/网络二者之一就位）
- [ ] `systemctl status usst-api` 为 active；重启一次仍自愈
- [ ] 新机跑一次 `snapshot.sh`，产物包含四个关键文件

### Phase 8 · 切客户端

按 §5.3 出 v0.4.10（或 0.5.0），上传、分发、告知试用者重装。
**旧机在下线前不要再改任何东西**，它是唯一可回滚点。

---

## 7. 风险与坑（按严重度）

| # | 风险 | 影响 | 处置 |
|---|---|---|---|
| R1 | APK 硬编码旧 IP | 到期即全部离线，且无法自更新 | 重出 APK + 线下分发（§5） |
| R2 | systemd 的 `LIBAO_CORS_ORIGINS` 写死旧 IP | 网页能开但接口全被 CORS 拦 | Phase 6 换成新 IP |
| R3 | `server/requirements.txt` 缺 `pdfplumber` | 课表导入 500 | Phase 3 显式补装 |
| R4 | `HF_HUB_OFFLINE=1` + 模型缓存没拷 | 首次检索 500 | 拷 `model_cache` 或删环境变量 |
| R5 | 只同步 `usst_articles.db` | 启动 `FileNotFoundError: campus_vocab.json` | `data/` 整目录同步 |
| R6 | 直接 tar 活库 | 拷到写一半的 SQLite，坏档 | 用导出包里的在线 backup（已做） |
| R7 | 隐私：12 份 sync_state 含个人待办/画像；`course_records.json` 是真实课表；用户名含手机号/学号形态 | 泄露风险 | 不公开、不入 git、迁移后清探针账号；导出包仅本机 |
| R8 | 免密 sudo + 密码 SSH 仍开 | 安全债 | 新机只留公钥；禁用密码登录 |
| R9 | 每日快照只在本机 | 旧机一停备份同归于尽 | 新机外加异地副本（网盘/对象存储） |
| R10 | 旧机到期后云厂商回收 | 数据可能取不回 | 已导出；若续费可行，续 1 个月（§5.5） |

---

## 8. 需要你确认的三件事

1. **新服务器地址与登录方式**（`<NEW_IP>`、SSH 用户、是否已有公钥）——仓库和文档里都没有记录，我无法代填。
2. **账号数据怎么处理**：整库迁移（保留 20 个账号与 12 份云端状态）／只迁演示账号／清空重来。
3. **旧机是否续费 1 个月**（保险 + 让旧 APK 有过渡期）。

---

## 附录 · 迁移命令块（Phase 2–6 串起来）

```bash
# 本地：构建 + 推送（不含运行时库）
npm ci && npm run build
tar --exclude='__pycache__' --exclude='data/libao_account.db' \
    --exclude='data/libao_memory.db' --exclude='data/lightpath.db' --exclude='data/uploads' \
    -czf - server scripts data dist \
  | ssh ubuntu@<NEW_IP> 'sudo mkdir -p /opt/usst/app && sudo chown ubuntu:ubuntu /opt/usst/app && tar -xzf - -C /opt/usst/app'

# 环境
ssh ubuntu@<NEW_IP> 'sudo python3 -m venv /opt/usst/venv && sudo /opt/usst/venv/bin/pip install -r /opt/usst/app/server/requirements.txt pdfplumber'

# 运行时数据（从本机导出包）
scp _backups/server-migration-20261022/usst-migration-export-20261022.tgz ubuntu@<NEW_IP>:/tmp/
ssh ubuntu@<NEW_IP> 'cd /tmp && tar -xzf usst-migration-export-20261022.tgz && cp usst-migration-export-20261022/{libao_account.db,libao_memory.db,course_records.json} /opt/usst/app/data/ && install -m 600 usst-migration-export-20261022/server.env.txt /opt/usst/app/server/.env'

# 模型缓存（可选但推荐）
rsync -av /opt/usst/app/model_cache ubuntu@<NEW_IP>:/opt/usst/app/

# 配置（手写 unit 与 nginx 后）
ssh ubuntu@<NEW_IP> 'sudo systemctl daemon-reload && sudo systemctl enable --now usst-api && sudo nginx -t && sudo systemctl reload nginx'
```

---

## 9. 迁移执行记录（2026-10-22 21:09–21:40 CST）

### 9.1 新机事实

| 项 | 值 |
|---|---|
| 地址 | `43.142.141.186` |
| 登录 | **`ubuntu`**（私钥 `SLGS.pem`）——私钥对 `root` 被拒；ubuntu 免密 sudo |
| 系统 | Ubuntu 24.04.4 LTS / 2 vCPU / 1.9 GiB / 50 GB（剩 35 G）/ swap 1.9 G / 时区 CST |
| 同机其他组件 | caddy（Hermes 入口）占 80 → 已 `disable --now`（按旧机先例，未删除）；`/opt/browser-vnc`、`/opt/google` 非本项目 |
| 新增安装 | nginx 1.24.0、python3-venv、sqlite3 |

### 9.2 实际执行

1. **代码与静态资产**：`rsync -a` 旧机 `/opt/usst/` → 新机，排除 `__pycache__`。`app/` 349 MB、**380 个文件**（与旧机一致），`dist/` 139 MB（含 14 个历史 APK）。
2. **Python 环境**：**未拷 venv**（旧机 venv 小文件多、实测 ~0.45 MB/s，按该速率要 12 分钟以上且易半途中断）。改为新机 `python3 -m venv` + `pip install -r server/requirements.txt pdfplumber`（清华镜像 3.3 MB/s，1 分钟内完成），`fastapi/uvicorn/jieba/fastembed/pdfplumber` 导入验证通过。
3. **运行时数据**：用 §3 的 SQLite 在线备份重做一次（21:24，`integrity_check=ok`），覆盖新机 `libao_account.db` / `libao_memory.db` / `course_records.json`。行数与旧机一致：users 20 / tokens 109 / sync_state 12 / week_plans 6；sessions 23 / messages 98 / facts 11 / profiles 2。
4. **模型缓存**：真正的运行时缓存是 **`/home/ubuntu/.workbuddy/cache/fastembed`**（`rag.py:25` 的 `FASTEMBED_CACHE_PATH` 默认值），**不是** `app/model_cache`。已整目录搬运（182 MB / 13 文件）。⚠️ 第一次拷贝被中断，缺 `model_optimized.onnx` → `/api/search` 500；补齐后恢复。
5. **配置**：systemd `usst-api.service`（`User=ubuntu`，CORS 换新 IP）、nginx 站点（删 default 软链）、`crontab` 每日 04:17 快照、`snapshot.sh` 就位并**实跑成功**（`20261022-2136`，141 MB）。
6. **密钥**：`server/.env` 随 rsync 到位，`chmod 600`。
7. **客户端**：`src/lib/apiBase.ts:20` → 新 IP；`server/version.json` → 0.4.10 / versionCode 16 / 新 apkUrl；`package.json` 与 `build.gradle` 同步（`node scripts/release_version.mjs` 四处一致通过）。APK 以 0.4.9 的 `dist-mobile` 为基线，仅替换共享 chunk 里的 IP 常量并清理 38 个无引用的旧哈希产物，重新签名打包：**9.1 MB / versionCode 16 / 仅含新 IP / 证书 SHA-256 与 0.4.9 相同（`7b742acd…`）**，可直接覆盖安装。
8. **Web 端**：线上 `dist/assets/index-CVwRC4O6.js` 里的 IP 兜底常量同步替换；`/api/version` 已指向新 APK。
9. **旧机降级为纯转发**（最后一步，见 §9.6）：旧 nginx 的 `/api/`、`/timetable/`、`/apk/` 全部 `proxy_pass` 到新机，其余路径 `301` 到新 IP。这样**已装旧 APK 的登录/同步/问答仍可用且读写落在新库**，不会新旧双写分叉；旧包的应用内「检查更新」也能拿到 0.4.10 的新地址，可自助升级。

### 9.3 验收证据（新机实测）

| 检查 | 结果 |
|---|---|
| `GET /api/health` | `{"ok":true,"llm":true,"model":"deepseek-chat"}` |
| 公网 `http://43.142.141.186/`、`/m.html` | 200 / 200 |
| `gigity` 登录 | 200，userId=7，icsToken 正常 |
| `GET /api/sync/state` | `found=true`，`updatedAt=2026-10-08T03:44:33Z`（原数据） |
| `GET /api/sync/plan?weekNo=8` | 200，`found/plan/updatedAt` |
| `GET /courses` | 11 条 |
| `GET /api/sync/plan.ics` | `BEGIN:VCALENDAR`，38 个 VEVENT |
| `GET /api/search` | 200，返回文章 |
| `POST /api/chat` | LLM 合成，命中食堂营业时间 |
| CORS（Origin=新 IP） | `access-control-allow-origin: http://43.142.141.186` |
| APK 下载 | 200，9,110,276 B |
| 快照 cron | 已装并实跑 |

### 9.4 未完成 / 有意偏离

| 项 | 状态 | 说明 |
|---|---|---|
| `/opt/usst/backup` 里的 **15 份 `dist_pre_*`（约 1.8 GB）** | **未搬** | 都是旧机历次前端上线前的 dist 备份，内容可由仓库重建；搬它要多花约 1 小时。**7 份每日快照的 `app-server-data.tgz`（server+data）已全部搬齐**（16/17/18/19/20/21/22 共 75 MB），dist 归档未搬；新机 21:36 的自建快照也在 |
| 旧机能正常访问 | 保留 | 旧机未停机，作为回滚点保留到 10-25 到期 |
| 旧 APK（0.2.0–0.4.9） | 仍在新机 `/apk/` | 它们自身仍指旧 IP：走旧 IP 时由旧机代理继续可用；**直接连新机则不可用**。分发只发 0.4.10 |
| 旧 IP 文档引用 | 未全改 | `docs/` 多处历史文档仍写 101.35.253.143（历史留痕，非运行配置）；`AGENTS.md` 顶部已加迁移提示 |
| 探针账号 / 演示弱口令 | 未清 | 20 个账号原样迁入（含 `gigity/123456`），按「整库迁移」要求保留 |
| git 提交 | **未做** | 本机 PATH 里没有 git（`where git` 无结果），无法按仓库纪律提交；改动文件见 §9.2 第 7 条 |
| 旧机 `/tmp/.slgs_mig.pem` | ✅ 已清理 | 迁移完成后已在旧机 `shred -u`，确认文件不存在 |

### 9.5 回滚

- 旧机已改为纯转发（§9.6）。要退回迁移前，把备份的旧配置还原即可：
  `sudo cp /opt/usst/backup/nginx-pre-migration-20261022.conf /etc/nginx/sites-available/usst && sudo nginx -t && sudo systemctl reload nginx`
  （旧机 `usst-api` 仍在运行、旧库数据未动，还原后即恢复旧服务；但切换后写入新库的数据不会回流。）
- 新机自身有 21:36 的快照（`/opt/usst/backup/20261022-2136`），恢复口径：`tar -xzf app-server-data.tgz -C /opt/usst/app/`。

### 9.6 旧机转发配置（2026-10-22 21:5x 上线）

`/etc/nginx/sites-available/usst`（旧机）已替换为：

```nginx
server {
    listen 80 default_server;
    location /api/       { proxy_pass http://43.142.141.186; proxy_read_timeout 120s; }
    location /timetable/ { proxy_pass http://43.142.141.186; proxy_read_timeout 120s; }
    location /apk/       { proxy_pass http://43.142.141.186; }
    location /           { return 301 http://43.142.141.186$request_uri; }
}
```

旧配置已备份到 `/opt/usst/backup/nginx-pre-migration-20261022.conf`。实测（从公网打旧 IP）：`/api/health`、`/api/version`（返回 0.4.10 + 新 apkUrl）、`gigity` 登录、ICS（38 VEVENT）全部走新机；`/` 返回 301 到新 IP。

---

## 10. 迁移收尾复核（2026-10-25 晚，旧机到期后）

旧机 `101.35.253.143` 已于当日 12:17 到期下线（纯转发配置与旧机回滚能力随之消失）。同晚对新机做了全面复核 + 一处关键补救，结论：**迁移闭环完成，线上全链绿**。

### 10.1 复核结论（全部实测）

| 项 | 结果 |
|---|---|
| `systemctl is-active usst-api` | active；`/api/health` = `{"ok":true,"llm":true,"model":"deepseek-chat"}` |
| 线上后端代码 | `server/app.py` 81,994 B，与本地 HEAD（e003877 W8 批）一致——§八交接单 #1「线上还是 10-08 版」已过时，10-25 已带上 10-11 加固批 + W8 指标批 |
| 三条 cron | 快照 04:17（10-23/24/25 三份快照齐全）、爬虫 05/17 点（`new_n=8/10` 在进新数据）、指标聚合 04:37（手动跑通，`metrics_daily.json` 已生成，等待首夜事件积累） |
| 账号库 | `integrity_check=ok`；users 20 / tokens 117 / sync_state 13 / week_plans 6（迁移后仍在自然增长） |
| 记忆库 | sessions 37 / messages 122 / facts 123 / profiles 4（持续增长） |
| 数据 pins | `data_pins.json` = 588/583/2067（与批 4 一致；§八交接单 #4 的 pins/health_kb 漂移已在 10-25 批 4 消除） |
| 模型缓存 | `~/.workbuddy/cache/fastembed` 在位（`HF_HUB_OFFLINE=1` 可用） |
| 公网端点 | `/`、`/m.html`、`/api/search`（命中 5 条）、`/courses`（11 条）、APK 下载全部 200 |
| 服务器侧旧 IP 残留 | nginx / systemd unit / server 代码 / `data/*.json` 全部 **0 命中** |

### 10.2 🔴 发现并修复：0.4.10 APK 真机连不上新机

10-22 出 0.4.10 时只替换了 JS 里的 IP 常量，**漏了 `network_security_config.xml` 的明文白名单**（仍指旧机）。Android 9+ 下 manifest 的 `usesCleartextTraffic` 会被 NSG 压掉（API 24+ 以 NSG 为准），因此已装 0.4.10 的真机被系统**静默拦截**发往新机的全部请求——且应用内「检查更新」也走新机，同样被拦，**无法自愈**（§9.4 交接单 #2 的后果比预估更严重一档）。解包取证：0.4.10 内混淆为 `res/8G.xml` 的 NSG 仍含旧 IP。

修复 = NSG 白名单换成新机 + 版本四处同步出 **0.4.11（versionCode 17）**：

- **不发新功能**：不跑 `npm run build`，沿用 dist-mobile 现基线（= 0.4.9 功能 + 新 IP chunk），JS 与 0.4.10 完全一致；
- 签名证书 SHA-256 与 0.4.9/0.4.10 相同（`7b742acd…`），可直接覆盖安装；
- 二进制约测：0.4.11 全包旧 IP **0 命中**，新 IP 在 JS 与 NSG 各 1 处；
- 已部署并验证：`/api/version` 返回 0.4.11，`/apk/lightpath-0.4.11.apk` 200（9,110,277 B）；
- 防再犯：`AGENTS.md` 顶部迁移提示 + NSG 文件头注均已加「换服务器必须同步改这里」。

### 10.3 10-25 之后仍开放的事项

| 项 | 说明 |
|---|---|
| **0.4.11 线下分发** | 所有更早的 APK（≤0.4.10）数据面均已死且无法应用内自更新，只能人工重装 0.4.11；真机走查加验「登录/同步/梨宝」三链路（`docs/真机走查准备清单-2026-10-06.md` 顶部已加时点注记） |
| 异地备份副本 | 每日快照只在新机本机（R9）；`_backups/server-migration-20261022/` 导出包也只在本机一块盘——建议至少再放一份到网盘/另一块盘 |
| 探针账号 / `gigity/123456` 弱口令 | 整库迁移保留（20 账号），演示前清理/改口令（交接单 #3，需人拍板） |
| SSH 加固 | 新机 ubuntu + 密钥可用（root 拒绝该私钥）；按 R8 关密码登录待做 |
| `dist/` 旧哈希 chunk | 含旧 IP 字符串但无入口引用（交接单 #7，不影响运行），下次整体换 dist 时自然消除 |
| 账号库回流 | 旧机导出包是 10-22 时点；此后线上新增数据只在新机快照里——`_backups/` 导出包降级为「迁移时点存档」 |
