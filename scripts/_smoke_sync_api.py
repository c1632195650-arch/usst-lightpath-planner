# -*- coding: utf-8 -*-
"""冒烟：光溯移动端云同步 + ICS（M1 · TestClient 直打 /api/sync/*，不起端口）。

覆盖（对应验收矩阵 §10）：
  · 同步状态往返（PUT → GET 字段原样回来）
  · **LWW 反向断言**：旧时间戳再 PUT → accepted=false 且返回服务端副本
  · 非法时间戳 → 400；坏令牌 → 401
  · 周计划副本 PUT → GET 往返
  · **ICS 计数断言**：VCALENDAR 1 / VEVENT = 块数 / VALARM = 块数；坏 token → 404
  · /api/version 有文件 200、monkeypatch 指向不存在路径 404
数据库用 tempfile —— 绝不碰真实 data/libao_account.db。通过输出：SYNC ALL OK
"""
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))

fd, _tmp = tempfile.mkstemp(suffix=".db")
os.close(fd)
os.environ["LIBAO_ACCOUNT_DB"] = _tmp

import account
import sync
from fastapi import FastAPI
from fastapi.testclient import TestClient

app = FastAPI()
app.include_router(account.router)
app.include_router(sync.router)
c = TestClient(app)

NOW = datetime.now(timezone.utc)
NOW_ISO = NOW.isoformat()
OLD_ISO = (NOW - timedelta(minutes=5)).isoformat()

# ---------- 0) 注册 + 坏令牌反向 ----------
r = c.post("/api/auth/register", json={"username": "同步宝", "password": "probe123"})
uid, tok = r.json()["userId"], r.json()["token"]
H = {"Authorization": f"Bearer {tok}"}
r = c.get("/api/sync/state")
assert r.status_code == 401 and r.json()["error"] == "unauthorized", "无鉴权头必须 401：" + r.text
r = c.get("/api/sync/state", headers={"Authorization": "Bearer forged"})
assert r.status_code == 401, r.text

# ---------- 1) 空 state ----------
r = c.get("/api/sync/state", headers=H)
assert r.status_code == 200 and r.json()["found"] is False and r.json()["state"] is None, r.text

# ---------- 2) PUT state → 回来原样 ----------
demo_schedule = {
    "semesterName": "2026-2027-1", "semesterType": "autumn",
    "termStart": "2026-09-07", "totalWeeks": 20,
    "courses": [{
        "id": "c1", "name": "高等数学AI", "teacher": "王老师", "campus": "main",
        "slots": [{"dayOfWeek": 1, "startPeriod": 1, "endPeriod": 2,
                   "startMin": 480, "endMin": 570, "weeks": [1, 2, 3]}],
        "building": "一教", "room": "101",
    }],
    "source": "demo",
}
state_payload = {
    "schemaVer": 1, "termStart": "2026-09-07", "weekNo": 5,
    "schedule": demo_schedule,
    "planState": {"version": 1, "lastPlanWeek": 5, "locks": {}, "churnMin": 0,
                  "lockedPlacements": {}, "updatedAt": NOW_ISO, "rolling": None,
                  "rollingBase": None},
    "userOverrides": {"schemaVersion": 2, "tasks": [], "excluded": [], "moves": [],
                      "slots": [], "courseOverrides": [], "mealPlaces": {}, "assignments": []},
    "clientUpdatedAt": NOW_ISO,
}
r = c.put("/api/sync/state", json={"state": state_payload, "schemaVer": 1,
                                   "clientUpdatedAt": NOW_ISO}, headers=H)
assert r.status_code == 200 and r.json()["accepted"] is True, r.text
server_ts = r.json()["updatedAt"]

r = c.get("/api/sync/state", headers=H)
body = r.json()
assert body["found"] is True and body["schemaVer"] == 1, r.text
assert body["state"]["schedule"]["termStart"] == "2026-09-07", "课表应原样往返"
assert body["state"]["userOverrides"]["schemaVersion"] == 2, "覆盖层应原样往返"
assert body["state"]["planState"]["lastPlanWeek"] == 5, "planState 应原样往返"

# ---------- 3) LWW 反向：旧时间戳再 PUT → accepted=false + 服务端副本 ----------
tampered = dict(state_payload)
tampered["weekNo"] = 99  # 若误写入，这里会回来 99 —— 断言绝不许它发生
r = c.put("/api/sync/state", json={"state": tampered, "schemaVer": 1,
                                   "clientUpdatedAt": OLD_ISO}, headers=H)
assert r.status_code == 200 and r.json()["accepted"] is False, "旧时间戳必须被拒：" + r.text
assert r.json()["state"]["weekNo"] == 5, "应返回服务端当前副本（weekNo=5），不是 99"
r = c.get("/api/sync/state", headers=H)
assert r.json()["state"]["weekNo"] == 5, "被拒的写入不得落库"

# ---------- 4) 反向：坏时间戳 / 坏 schemaVer → 400 ----------
r = c.put("/api/sync/state", json={"state": state_payload, "schemaVer": 1,
                                   "clientUpdatedAt": "昨天"}, headers=H)
assert r.status_code == 400 and r.json()["error"] == "invalid_timestamp", r.text
r = c.put("/api/sync/state", json={"state": state_payload, "schemaVer": 2,
                                   "clientUpdatedAt": NOW_ISO}, headers=H)
assert r.status_code == 400 and r.json()["error"] == "unsupported_schema", r.text
r = c.put("/api/sync/state", json={"state": state_payload, "schemaVer": 1,
                                   "clientUpdatedAt": NOW_ISO}, headers={"Authorization": "Bearer forged"})
assert r.status_code == 401, "坏令牌 PUT 必须 401"

# ---------- 5) 周计划副本 PUT/GET 往返 ----------
demo_plan = {
    "weekNo": 5,
    "blocks": [
        {"id": "w5-d1-course-0", "kind": "course", "dayOfWeek": 1, "startMin": 480,
         "endMin": 570, "title": "高等数学AI", "place": "一教", "room": "101",
         "source": "course"},
        {"id": "w5-d1-study-lib-1", "kind": "study", "dayOfWeek": 1, "startMin": 780,
         "endMin": 870, "title": "高数作业", "place": "图书馆", "reason": "距上次排期最近",
         "source": "template"},
        {"id": "w5-d2-sport-1", "kind": "sport", "dayOfWeek": 2, "startMin": 1020,
         "endMin": 1080, "title": "跑步", "place": "田径场", "source": "template"},
    ],
    "stats": {"courseMin": 90, "studyMin": 90, "blankMin": 0, "blockCount": 3},
    "issues": [],
}
r = c.put("/api/sync/plan?weekNo=5", json={"plan": demo_plan}, headers=H)
assert r.status_code == 200 and "updatedAt" in r.json(), r.text
r = c.get("/api/sync/plan?weekNo=5", headers=H)
assert r.json()["found"] is True and len(r.json()["plan"]["blocks"]) == 3, r.text
r = c.get("/api/sync/plan?weekNo=6", headers=H)
assert r.json()["found"] is False, "没传过的周必须 found=false"
r = c.put("/api/sync/plan?weekNo=0", json={"plan": demo_plan}, headers=H)
assert r.status_code == 422, "weekNo 越界应被参数校验拦下"

# ---------- 6) ICS：计数断言（token 从库里取 —— 免鉴权头通道） ----------
import sqlite3

con = sqlite3.connect(_tmp)
ics_token = con.execute("SELECT ics_token FROM users WHERE id=?", (uid,)).fetchone()[0]
con.close()
r = c.get(f"/api/sync/plan.ics?token={ics_token}")
assert r.status_code == 200, r.text
assert r.headers["content-type"].startswith("text/calendar"), r.headers.get("content-type")
ics = r.text
assert ics.count("BEGIN:VCALENDAR") == 1, "VCALENDAR 必须 1 个"
n_events = ics.count("BEGIN:VEVENT")
n_alarms = ics.count("BEGIN:VALARM")
assert n_events == 3, f"VEVENT 应 3 个（块数），得到 {n_events}"
assert n_alarms == 3, f"VALARM 应 3 个（每块一个 -PT10M），得到 {n_alarms}"
assert "DTSTART:20261005T080000" in ics, f"termStart+4周+周一+480min 应为 20261005T080000"
assert "TRIGGER:-PT10M" in ics
assert "@lightpath" in ics
r = c.get("/api/sync/plan.ics?token=wrong-token-value")
assert r.status_code == 404 and r.json()["error"] == "not_found", "坏 token 必须 404"

# ---------- 7) ICS 反向：脏块被跳过，不毒化整个日历 ----------
bad_plan = {"weekNo": 4, "blocks": [{"garbage": True}, {"id": "x", "dayOfWeek": 9}]}
c.put("/api/sync/plan?weekNo=4", json={"plan": bad_plan}, headers=H)
r = c.get(f"/api/sync/plan.ics?token={ics_token}")
assert r.status_code == 200 and r.text.count("BEGIN:VEVENT") == 3, "脏块必须被跳过"

# ---------- 8) /api/version：有文件 200 + 缺文件 404 ----------
r = c.get("/api/version")
assert r.status_code == 200, f"version.json 已提交，应 200：{r.text}"
assert r.json()["version"] == "0.1.0" and "apkUrl" in r.json(), r.text
orig = sync._VERSION_FILE
sync._VERSION_FILE = os.path.join(_tmp, "no_such_version.json")
r = c.get("/api/version")
sync._VERSION_FILE = orig
assert r.status_code == 404 and r.json()["error"] == "version_unavailable", "缺文件必须 404"

# ---------- 9) ICS 折行自检（RFC 5545 §3.1：≤75 字节） ----------
long_title = "超" * 60
plan_long = {"weekNo": 5, "blocks": [dict(demo_plan["blocks"][0], title=long_title)]}
c.put("/api/sync/plan?weekNo=5", json={"plan": plan_long}, headers=H)
r = c.get(f"/api/sync/plan.ics?token={ics_token}")
for line in r.text.split("\r\n"):
    assert len(line.encode("utf-8")) <= 75, f"行超 75 字节：{len(line.encode('utf-8'))}B {line[:40]}"

os.remove(_tmp)
print("SYNC ALL OK")
