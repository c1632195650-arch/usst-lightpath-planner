import os, subprocess, sys, json, re
sys.stdout.reconfigure(encoding="utf-8")
os.chdir(r"D:\WORKBUDDY DATA\学术部\usst-planner")
GIT = r"C:\Users\CY\.workbuddy\binaries\PortableGit\versions\1.2.0\cmd\git.exe"
GH = r"C:\Program Files\GitHub CLI\gh.exe"
REMOTE = "https://github.com/c1632195650-arch/usst-lightpath-planner.git"
PARENT = "e37f57e"

env = dict(os.environ, GIT_TERMINAL_PROMPT="0", APPDATA=r"C:\Users\CY\AppData\Roaming")
env.pop("HTTPS_PROXY", None); env.pop("HTTP_PROXY", None)

def g(*args, **kw):
    r = subprocess.run([GIT] + list(args), capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=env, **kw)
    return r.returncode, (r.stdout or ""), (r.stderr or "")

g("config", "user.name", "光溯开发组")
g("config", "user.email", "usst.lightpath@example.com")
g("add", "-A")
rc, out, err = g("diff", "--cached", "--name-status", PARENT)
print("=== 变更 ===")
print(out.strip())
dele = [l for l in out.splitlines() if l.startswith("D")]
print("=== 删除项 ===")
print(dele or "无")
# 删除项必须都是临时文件（下划线开头）
bad = [d for d in dele if not os.path.basename(d.split("\t")[-1]).startswith("_")]
if bad:
    print("❌ 出现非临时文件的删除，中止：", bad)
    sys.exit(1)

MSG = """feat(planner): 周调度器 —— 课表之外的时间怎么填（规则引擎 + 真实转场）

【背景】buildPhases 解决「这个学期什么时候该松该紧」，这一步解决「这一周具体怎么排」。
排程引擎到此闭环：课表 → 有效课程(按周次) → 阶段策略 → 时间块 + 转场 + 问题清单。

【新增 src/lib/planner/templates.ts】活动模块库（可组合 / 填充式 / 可自定义）
- 食堂 10 个（含营业时段，来自 campus_map.json 的 hours）、自习点 8 个、运动 4 个、休息/生活 5 个
- 「填充式」：每个模块给一组时长档位（30/45/60/90…），空档多大就挑多长的一档，
  而不是把 60 分钟写死
- 每条带 windows（营业时段）→ 排程因此能回答「17:30 路过五食堂还开着吗」这类通用日历答不出的问题
- autoPlace：取快递/洗澡这类「偶尔才做」的只进模块库、不每天自动排
- trigger：由画像驱动（运动只在 exercise_trigger=self_plan 时自动排；夜宵只在 night_supply=convenience 时排）
- openAt()/windowLabelAt()：按时段判断能否使用
- customTemplate(UserTask)：用户的「时间 + 地点 + 事件」三要素 → 可排程模块

【新增 src/lib/planner/schedule.ts】周调度器（A1 规则引擎，纯函数）
- 输入：课表 + weekNo + PhasePolicy + 画像场景 + 用户自定义模块 + 注入的转场时间
- 输出：WeekPlan{blocks, stats, issues} + notes
- 有效课程：effectiveCourses/effectiveSlots/slotsOn（第 9 周党史已结束、模电实验还没开始，
  每周的有效课表都不同 —— 周次过滤是排程的第一公民）
- 三餐：按「从哪儿来 × 要到哪儿去」选食堂（见下），落点两头都留走路时间
- 活动模块：按优先级填空档，每类每天限量（运动 1 / 生活 1 / 午休 1），一天活动总时长 ≤120 分钟
- 自习：按 PhasePolicy 分块（单块 ≤ maxBlockMin、留白 blankRatio 是下限、晚间/周末策略生效）
- 转场：相邻块挂 TransferHint{minutes, slackMin, tight}；只对**硬约束**（课程/用餐/用户锁定块）
  报 warn/error —— 自习块晚 5 分钟无所谓，刷一屏警告只会让人无视警告
- 确定性：同输入必得同输出（块 id 也确定），便于 diff 与「确认后锁定」

【关键修正：一个「假排程」的坑】
第一版把块直接放在空档起点，结果排出一串首尾相接的块，
转场检查立刻报「0 分钟余量、会迟到 10 分钟」——那是排不出来的排程。
现在：**任何由引擎自己放上去的块，都要给上一块留出走路时间 + 5 分钟缓冲，
并给下一个块留出「走过去」的时间**。实测值向上取整（4.6 分 → 5 分），
避免排出 07:34.5999 这种鬼时间。

【空间参与决策（复用已建成的 OSM 路网）】
- 食堂按「从哪儿来」选：画像 meal_radius=near 时按转场时间挑最近的，far 时按口味优先
- 食堂按「要到哪儿去」选：下一件事在**另一个校区**且在 3 小时内，就排在那边的食堂
  → 实测：周二/周四 18:00 在南校卓越楼有晚课，晚餐自动排到南校思餐厅，
    走到卓越楼 4.4 分钟（余 6）；若不这样做，从北校吃完再跨区只剩 0 分钟余量
- 3 小时窗口是刻意的：中午不该因为「晚上要去南校」就跑去南校吃午饭

【新增 src/lib/planner/transfer.ts】把后端实测转场接进纯函数引擎
- 引擎是同步的、网络是异步的 → 两遍跑：第一遍收集「需要问哪些路」，批量问后端，
  填充缓存后第二遍才产出给用户的结果（避免把引擎改成 async 污染整条纯函数链）
- collectTransferPairs()：只收集「相邻且地点不同」的点对（去重）
- 拿不到实测值时退回跨校区估算并标 reliable:false，不猜同校区的步行分钟

【后端新增接口（server/app.py）】
- GET  /api/route?from=&to=&mode=           两点步行路径
- POST /api/route/batch {pairs:[[a,b],...]}  批量（排程一次要问十几对，逐条太慢）
- 查不到返回 null 而不是报错 —— 前端据此退回估算值

【数据修正 data/campus_map.json】把真实课表里对不上的上课地点补上
- 「实训中心」补别名「工程实训中心」「工程训练中心」（金工实习上课地点）
- 新增 POI「公共实验楼」（物理实验 / 模电实验上课地点），OSM 无此名，
  位置未核实 → verified:false + 登记 needs_check
- POI 146 → 147

【测试】新增 scripts/scheduler.test.ts，34 项；连同 buildPhases 共 **48/48 通过**
  覆盖：周次过滤（第 4 周 vs 第 12 周课不同）｜课时表换算（3-5 节 = 09:45-11:55）｜
  三餐不压课且会顺延｜画像真的改变结果（就近选食堂 / 运动触发 / 夜宵触发）｜
  自习服从策略（单块上限、晚间、周末、留白）｜转场余量与「来不及」告警｜
  同楼不标转场｜用户自定义模块（锁定 + 浮动 + 按周生效）｜确定性｜冲突检测

【实测（用 2026-2027-1 真实课表跑第 4 / 12 周）】
- 第 4 周：上课 23.3h / 自习 7.75h / 留白 52.8h，只有 2 条 info（篮球课没地点 + 自习低于目标）
- 第 12 周：物理实验(7-15 周) 已加入、党史(3-10 周) 已消失 —— 周次过滤生效
- 零 error / 零 warn（上一版的 4 条误报全部消除）
"""

open("_cmsg.txt", "w", encoding="utf-8").write(MSG)

rc, out, _ = g("write-tree")
tree = out.strip()
rc, out, err = g("commit-tree", tree, "-p", PARENT, "-F", "_cmsg.txt")
commit = out.strip()
print("\nCOMMIT =", commit)
if not commit:
    print("提交失败:", err[:400]); sys.exit(1)

# 推送（绕过凭据管理器：代理可能挂着，直连或走代理都试）
tok = subprocess.run([GH, "auth", "token"], capture_output=True, text=True,
                     encoding="utf-8", errors="replace", env=env).stdout.strip()
if not tok:
    print("拿不到 gh token"); sys.exit(1)
url = REMOTE.replace("https://", f"https://{tok}@")
for label, extra in [("直连", ["-c", "http.proxy=", "-c", "https.proxy=", "-c", "credential.helper="]),
                     ("走代理", ["-c", "http.proxy=http://127.0.0.1:7890", "-c", "https.proxy=http://127.0.0.1:7890", "-c", "credential.helper="])]:
    r = subprocess.run([GIT] + extra + ["push", url, f"{commit}:refs/heads/main", f"{commit}:refs/heads/dev"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, timeout=420)
    tail = re.sub(r"https://[^@]+@", "https://[TOKEN]@", (r.stdout or "") + (r.stderr or ""))[-300:]
    print(f"\n[{label}] rc={r.returncode}\n{tail}")
    if r.returncode == 0:
        print(f"\n✅ 推送成功 {PARENT} → {commit[:7]}")
        break

os.remove("_cmsg.txt")
