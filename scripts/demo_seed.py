# -*- coding: utf-8 -*-
"""
光溯 · 决赛演示种子数据（demo_seed.py）
==========================================
目的：一跳命令把演示账号 <demo_gd> 填成「申报书 v4 承诺的全部演示前提」：
  ① 云端账号 + ICS 令牌（移动端/订阅演示）
  ② 云端 AppState：画像（提前一点的人）+ 课表（含跨校区课）+ 学期阶段
     + planState（锁定的辅导员例会 + 上周透支滚动状态 → 本周自动降档）
  ③ 梨宝记忆库：长期画像 + 已生效偏好事实 + 一条【待确认】客观事实
     （记忆面板现场点「确认」的演示）+ 最近对话原文（「上周说过想晨跑」）
用法：
  .venv/Scripts/python.exe scripts/demo_seed.py            # 幂等执行
  .venv/Scripts/python.exe demo_seed.py --force-schedule   # 连课表一起覆盖
     ⚠️ 若你已从 PDF 导入真实课表，不要加 --force-schedule（脚本默认不覆盖）。
红线：全程 TestClient 进程内调用，不开端口、不碰 8000/8765；演示数据无真实个人信息。
"""
import json
import os
import sqlite3
import sys
import datetime as _dt

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, os.path.join(_ROOT, "server"))

USERNAME = "demo_gd"
PASSWORD = "gd-demo-2026"
NOW = _dt.datetime.now().isoformat(timespec="seconds")
FORCE_SCHEDULE = "--force-schedule" in sys.argv


def main():
    # ---- 进程内 TestClient（不出网、不开端口、不杀别人的 8000） ----
    from fastapi.testclient import TestClient
    import app as appmod

    c = TestClient(appmod.app)

    # ---- 1) 账号（幂等：注册失败即登录） ----
    r = c.post("/api/auth/register", json={"username": USERNAME, "password": PASSWORD})
    if r.status_code == 409:
        r = c.post("/api/auth/login", json={"username": USERNAME, "password": PASSWORD})
    r.raise_for_status()
    auth = r.json()
    uid, token, ics = auth["userId"], auth["token"], auth.get("icsToken", "")
    print(f"[1] 账号 OK：userId={uid}  icsToken={ics[:8]}…")
    hdr = {"Authorization": f"Bearer {token}"}

    # ---- 2) 云端 AppState ----
    persona_axes = {"EXP": 30, "PLAN": 80, "SOC": 45, "RES": 60, "ACH": 75, "HEA": 55, "RAT": 70, "BOLD": 40}
    arch_planner = {
        "id": "planner", "name": "提前一点的人", "tagline": "把明天先摆好，再安心睡",
        "desc": "你做事喜欢先有个轮廓，心里才踏实。梨宝会顺着这一点，把要紧的事排前一些，也给留白留位置。",
        "axes": persona_axes,
    }
    persona = {
        "version": "demo-seed-1", "scoreVersion": "v1",
        "axes": persona_axes,
        "traits": {"E": 45, "C": 72, "ES": 58, "O": 55, "A": 65},
        "motives": {"ACH": 80, "SOC": 40, "HEA": 62, "EXP": 55, "STA": 50},
        "scenarios": {
            "meal_radius": "far", "planning": "planned", "event_breadth": "narrow",
            "social_radius": "close", "night_supply": "none", "exercise_trigger": "self_plan",
            "study_place": "library", "info_channel": "self_search",
        },
        "archetype": {"primary": arch_planner, "secondary": None, "distance": 0},
        "confidence": {"PLAN": "high", "ACH": "high", "HEA": "mid"},
        "quality": "ok", "updatedAt": NOW,
    }
    courses = [
        {"id": "c-math", "name": "高等数学 A2", "teacher": "王老师", "credit": 4, "category": "公共基础",
         "campus": "JG516", "building": "一教", "room": "一教 302",
         "slots": [{"dayOfWeek": 1, "startPeriod": 1, "endPeriod": 2, "weeks": []},
                   {"dayOfWeek": 3, "startPeriod": 3, "endPeriod": 4, "weeks": []}], "examDate": None},
        {"id": "c-phys", "name": "大学物理", "teacher": "李老师", "credit": 3, "category": "公共基础",
         "campus": "JG516", "building": "物理楼", "room": "物理楼 105",
         "slots": [{"dayOfWeek": 2, "startPeriod": 3, "endPeriod": 4, "weeks": []}], "examDate": None},
        {"id": "c-dcn", "name": "数据通信与网络", "teacher": "张老师", "credit": 3, "category": "专业核心",
         "campus": "JG1100", "building": "基础学院教学楼", "room": "1100 教 204",
         "slots": [{"dayOfWeek": 4, "startPeriod": 6, "endPeriod": 7, "weeks": []}], "examDate": None},
        {"id": "c-eng", "name": "大学英语", "teacher": "刘老师", "credit": 2, "category": "公共基础",
         "campus": "JG516", "building": "外语楼", "room": "外语楼 210",
         "slots": [{"dayOfWeek": 5, "startPeriod": 1, "endPeriod": 2, "weeks": []}], "examDate": None},
    ]
    schedule = {
        "semesterName": "2026-2027学年 第一学期", "semesterType": "autumn",
        "termStart": "2026-09-14", "totalWeeks": 16,
        "courses": courses, "source": "demo",
    }
    semester_plan = {
        "semesterName": "2026-2027学年 第一学期", "totalWeeks": 16,
        "phases": [
            {"kind": "adapt", "name": "适应期", "fromWeek": 1, "toWeek": 2,
             "policy": {"dailyStudyMin": 60, "maxBlockMin": 60, "blankRatio": 0.2, "eveningAllowed": False,
                        "weekendWork": False, "studyPlaces": ["图书馆"]},
             "reasons": ["开学前两周以熟悉节奏为主", "画像显示你需要先有轮廓才踏实"]},
            {"kind": "normal", "name": "常规期", "fromWeek": 3, "toWeek": 12,
             "policy": {"dailyStudyMin": 120, "maxBlockMin": 90, "blankRatio": 0.12, "eveningAllowed": True,
                        "weekendWork": False, "studyPlaces": ["图书馆", "一教自习室"]},
             "reasons": ["常规教学周", "光电杯作品在本阶段推进（截止第 5 周）"]},
            {"kind": "sprint", "name": "冲刺期", "fromWeek": 13, "toWeek": 15,
             "policy": {"dailyStudyMin": 150, "maxBlockMin": 90, "blankRatio": 0.08, "eveningAllowed": True,
                        "weekendWork": True, "studyPlaces": ["图书馆", "一教自习室"]},
             "reasons": ["期末前自动上抬", "T-21/14/7/3 加权生效"]},
            {"kind": "exam", "name": "考试周", "fromWeek": 16, "toWeek": 16,
             "policy": {"dailyStudyMin": 60, "maxBlockMin": 45, "blankRatio": 0.25, "eveningAllowed": False,
                        "weekendWork": False, "studyPlaces": ["图书馆"]},
             "reasons": ["考试周以复习与休息平衡为主"]},
        ],
        "personaVersion": "demo-seed-1", "generatedAt": NOW,
    }
    plan_state = {
        "version": 1, "lastPlanWeek": 4,
        "locks": {"demo-meeting": "hard"},
        "lockedPlacements": {"demo-meeting": {"dayOfWeek": 3, "startMin": 840, "endMin": 900,
                                              "place": "一教 201", "title": "辅导员例会"}},
        "churnMin": 30, "updatedAt": NOW,
        "rolling": {   # 上周透支：高负荷 + 多日可行性打折 → 本周自动降档（D1 镜头）
            "recentLoad": [520, 610, 660, 705],
            "upcoming": [{"id": "gd-cup", "title": "光电杯作品材料", "dueAtWeek": 5, "urgency": 0.9}],
            "loadByDow": [0, 150, 160, 185, 150, 120, 90, 60],
            "feasibleByDow": [0.75, 0.70, 0.72, 0.68, 0.80, 0.90, 0.95],
            "throughWeek": 3,
        },
        "rollingBase": None,
    }
    state = {
        "version": 4, "onboarded": True,
        "persona": persona, "answers": None,
        "schedule": schedule, "semesterPlan": semester_plan,
        "selectedDays": [], "lifeMode": None,
        "planState": plan_state,
    }

    # 云端已有课表（你导入的真实课表）→ 默认保留，只补画像/planState
    cur = c.get("/api/sync/state", headers=hdr).json()
    if cur.get("found") and cur.get("state") and isinstance(cur["state"].get("schedule"), dict) \
            and cur["state"]["schedule"].get("courses") and not FORCE_SCHEDULE:
        kept = cur["state"]["schedule"]
        print(f"[2] 检测到云端已有课表（{kept.get('semesterName','?')}，{len(kept['courses'])} 门课）→ 保留，只更新画像/学期阶段/planState")
        state["schedule"] = kept
    else:
        print("[2] 云端无课表 → 写入演示课表（含周三后跨校区课：军工路本部 → 1100 基础学院，25 分钟转场）")

    r = c.put("/api/sync/state", headers=hdr,
              json={"state": state, "schemaVer": 2,
                    "clientUpdatedAt": _dt.datetime.now(_dt.timezone.utc).isoformat()})
    r.raise_for_status()
    print(f"[2] 云端 AppState OK：accepted={r.json().get('accepted')}  updatedAt={r.json().get('updatedAt','')[:19]}")

    # ---- 3) 本周计划副本（ICS 素材；含跨校区通勤块 + 锁定例会） ----
    def block(bid, kind, dow, s, e, title, place=None, room=None, locked=False, src="user"):
        b = {"id": bid, "kind": kind, "dayOfWeek": dow, "startMin": s, "endMin": e, "title": title,
             "source": src}
        if place: b["place"] = place
        if room: b["room"] = room
        if locked:
            b["locked"] = True; b["lockLevel"] = "hard"
        return b

    week_plan = {
        "weekNo": 4,
        "blocks": [
            block("w4-c1", "course", 1, 480, 570, "高等数学 A2", "一教 302", src="course"),
            block("w4-c2", "course", 2, 660, 750, "大学物理", "物理楼 105", src="course"),
            block("w4-c3", "course", 3, 600, 690, "高等数学 A2", "一教 302", src="course"),
            block("w4-tf", "commute", 4, 750, 775, "跨校区转场 → 1100 基础学院（约 25 分钟）"),
            block("w4-c4", "course", 4, 780, 870, "数据通信与网络", "1100 教 204", src="course"),
            block("w4-c5", "course", 5, 480, 570, "大学英语", "外语楼 210", src="course"),
            block("w4-m1", "activity", 3, 840, 900, "辅导员例会", "一教 201", locked=True),
            block("w4-s1", "study", 1, 900, 1020, "光电杯作品材料（截止第 5 周）", "图书馆"),
            block("w4-s2", "study", 2, 900, 1020, "数据通信复习", "图书馆"),
            block("w4-r1", "activity", 6, 420, 480, "晨跑 ×3（本周第 1 次）"),
        ],
        "stats": {"courseMin": 540, "studyMin": 240, "blankMin": 3600, "blockCount": 9},
        "issues": [],
    }
    r = c.put("/api/sync/plan", params={"weekNo": 4}, headers=hdr, json={"plan": week_plan})
    r.raise_for_status()
    print(f"[3] 本周计划副本（ICS 素材）OK：weekNo=4，{len(week_plan['blocks'])} 块")

    # ---- 4) 梨宝记忆库（user_id = acct-<userId>，与前端 identity 规则一致） ----
    mem_uid = f"acct-{uid}"
    db = os.path.join(_ROOT, "data", "libao_memory.db")
    conn = sqlite3.connect(db)
    conn.execute("""CREATE TABLE IF NOT EXISTS profiles(
        user_id TEXT PRIMARY KEY, profile TEXT, updated_at TEXT)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS sessions(
        session_id TEXT PRIMARY KEY, user_id TEXT, summary TEXT,
        turn_count INTEGER DEFAULT 0, last_summarized_turn INTEGER DEFAULT 0,
        updated_at TEXT)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS messages(
        id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT,
        content TEXT, created_at TEXT)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS facts(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, kind TEXT,
        key TEXT, value TEXT, status TEXT, source TEXT,
        created_at TEXT, decided_at TEXT)""")
    week_ago = (_dt.datetime.now() - _dt.timedelta(days=7)).isoformat(timespec="seconds")

    profile = {
        "grade": "大二", "college": "光电信息与计算机工程学院", "major": "光电信息科学与工程",
        "courses": ["高等数学", "大学物理", "数据通信与网络", "大学英语"],
        # 决赛记忆剧本（案例一）：偏好里羽毛球在前且写明「比晨跑上瘾」——
        # 用户说「我明天想去锻炼」时，梨宝应直接猜羽毛球/打球，而不是反问跑步还是打球。
        "preferences": {"喜欢": "打羽毛球（最近和室友每周三晚上约球，比晨跑上瘾），偶尔也晨跑", "忌口": "香菜"},
        "goals": ["准备光电杯作品", "每周三次晨跑"],
        "habits": "倾向夜型作息，正在调整；周三晚上固定打球",
    }
    conn.execute("INSERT INTO profiles(user_id, profile, updated_at) VALUES(?,?,?) "
                 "ON CONFLICT(user_id) DO UPDATE SET profile=excluded.profile, updated_at=excluded.updated_at",
                 (mem_uid, json.dumps(profile, ensure_ascii=False), NOW))

    sid = "s-demo-gd"
    conn.execute("INSERT INTO sessions(session_id, user_id, summary, turn_count, last_summarized_turn, updated_at) "
                 "VALUES(?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET summary=excluded.summary, updated_at=excluded.updated_at",
                 (sid, mem_uid, "用户是大二光电学院学生，正在准备光电杯作品；提出想每周三次晨跑并已排入计划，但最近更爱打羽毛球（每周三和室友约球）；忌口香菜；上周打赢球后搓了一顿大餐。", 12, 12, NOW))
    conn.execute("DELETE FROM messages WHERE session_id=?", (sid,))
    # 决赛记忆剧本（按时间序追加；recent_messages 取最近 6 条 → 「羽毛球×2 + 大餐×2」
    # 加「顶不住×2」会进 LLM 上下文，晨跑首轮被自然挤出到摘要层）：
    #   案例一（记忆改变猜测）：说了「更爱羽毛球」→ 之后说「想去锻炼」应直接猜打球；
    #   案例二（记忆 + 健康库）：说了「昨天搓大餐」→ 之后再说吃大餐，仍会排/同意，
    #     但应引用健康库口径（偶尔一顿没问题、别连着暴饮暴食）。
    for role, content, ts in [
        ("user", "这学期想每周三次晨跑，还要准备光电杯作品", week_ago),
        ("assistant", "好的，已经排进周计划：周二/四/六早上晨跑，光电杯材料每天晚自习留 60 分钟，截止前一周自动加量。", week_ago),
        ("user", "上周有点顶不住，好多没做完", week_ago),
        ("assistant", "收到，本周我把强度降下来了：只降不升，先把节奏找回来。", week_ago),
        ("user", "最近晨跑有点腻了，跟室友打羽毛球上瘾了，每周三晚上都去", week_ago),
        ("assistant", "好呀，记住啦：你最近更爱羽毛球，周三晚上给你留出约球时间，晨跑有空再去就行。", week_ago),
        ("user", "昨天羽毛球赢了两局，晚上还搓了一顿大餐犒劳自己", week_ago),
        ("assistant", "赢球值得庆祝！偶尔一顿大餐没问题，别连着来就好。", week_ago),
    ]:
        conn.execute("INSERT INTO messages(session_id, role, content, created_at) VALUES(?,?,?,?)",
                     (sid, role, content, ts))
    # 已生效偏好（自动并入画像，可撤销）——留三条 applied 供记忆面板展示
    conn.execute("DELETE FROM facts WHERE user_id=? AND source LIKE 'demo-seed%'", (mem_uid,))
    for kind, key, value, status in [
        ("preference", "like", "打羽毛球（每周三晚上和室友约球，最近比晨跑上瘾）", "applied"),
        ("preference", "like", "晨跑", "applied"),
        ("preference", "dislike", "香菜", "applied"),
        ("fact", "exam", "高等数学期中安排在第 11 周", "pending"),   # 现场点「确认」的演示位
    ]:
        conn.execute("INSERT INTO facts(user_id, kind, key, value, status, source, created_at, decided_at) "
                     "VALUES(?,?,?,?,?,?,?,?)",
                     (mem_uid, kind, key, value, status, "demo-seed（演示预置）", NOW,
                      NOW if status == "applied" else None))
    conn.commit(); conn.close()
    print(f"[4] 记忆库 OK：profile/会话摘要/最近对话已写入 {mem_uid}；含 3 条【已生效】偏好 + 1 条【待确认】事实")
    print(f"    记忆剧本：① 说「我明天想去锻炼」→ 应直接猜羽毛球（偏好已记）；② 说「今天又想搓顿大餐」")
    print(f"    → 仍会同意/排上，但应引用健康库口径（偶尔一顿没问题、别连着）。")

    # ---- 5) 汇总 ----
    print("=" * 56)
    print("演示账号就绪：demo_gd / gd-demo-2026")
    print(f"  web 端登录后即可演示：画像原型=提前一点的人；周计划第 4 周；")
    print(f"  周四 数据通信 在 1100 基础学院（跨校区转场 25 分钟）；周三辅导员例会已锁定；")
    print(f"  滚动状态=上周透支 → 本周自动降档（D1 镜头）。")
    print(f"  记忆面板：3 条已生效偏好（羽毛球/晨跑/忌口）+ 1 条待确认事实（现场点确认）。")
    print(f"  ICS 订阅链接可用 /api/sync/plan.ics?token=<icsToken>。")
    print("=" * 56)
    print("提醒：课表 PDF 导入走 8765 解析服务（见 RUNBOOK §③），导入后重跑本脚本")
    print("     （不加 --force-schedule）即可把画像/锁/滚动状态合并到你的真实课表上。")


if __name__ == "__main__":
    main()
