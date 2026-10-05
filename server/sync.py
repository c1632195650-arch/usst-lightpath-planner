# -*- coding: utf-8 -*-
"""
光溯移动端 · 云同步 / ICS 订阅 / 版本检查（M0 · /api/sync/* 与 /api/version）
============================================================================
职责边界（mobile-impl-plan §5.3）：
  · **权威状态 = SyncState**（课表/计划状态/覆盖层的原样 JSON）——服务端只透传不解释；
  · WeekPlan 副本**仅作 ICS 素材**：尊重 types.ts「不存整周计划、引擎随时重算」的既有
    决策，客户端本地重算视图，已算好的整周计划只是 PUT 上来喂日历订阅用；
  · 前向兼容：客户端对不认识的字段一律忽略；服务端不校验 payload 内部逻辑。

冲突规则（LWW，方案 §5.2）：
  · 比较双方 ISO-8601 UTC 时间戳 —— **解析成 datetime 比**，不是裸字符串比
    （`Z` 与 `+00:00` 后缀、毫秒位数不同都会让字符串序偏离时间序，实测会误判）；
  · client > server → 写入；否则不写，返回服务端当前副本（客户端提示「以云端为准」）；
  · 接受写入时 updated_at 取 max(client, 旧值)：既单调、又与客户端时钟同族 ——
    若改成「服务器收件时刻」，客户端时钟稍有偏差时连续两次同步会被误拒（debounce 1s）。

ICS 生成（§6.5）：
  · 只喂 week_plans 里 当前周±1 的副本（无 termStart 时退化为全部已存周）；
  · 日期 = termStart + (weekNo-1)*7 + (dayOfWeek-1) 天；startMin/endMin 为当日分钟偏移；
  · 浮动本地时间（无 TZID）—— 面向大陆单时区用户可接受，注释即声明；
  · 每块带 VALARM TRIGGER:-PT10M（ICS 订阅 = 唯一全机型免备案的系统级提醒通道）。

端点（签名表 §6.4；鉴权失败/参数错一律 JSONResponse {"error": code}，理由同 account.py）：
  GET  /api/sync/state                      Bearer → {found, state|null, schemaVer, updatedAt}
  PUT  /api/sync/state                      Bearer → {accepted, updatedAt, state?}
  GET  /api/sync/plan?weekNo=N              Bearer → {found, plan|null, updatedAt}
  PUT  /api/sync/plan?weekNo=N              Bearer → {updatedAt}
  GET  /api/sync/plan.ics?token=            query  → text/calendar | 404
  GET  /api/version                         无     → {version, apkUrl, notes} | 404
"""
import datetime as _dt
import hashlib
import json
import os

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict

from account import _conn, _err, _now_iso, _parse_iso, user_id_from_request

router = APIRouter()

_HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA_VER = 2
# 支持的最低客户端版本：v1 = schemaVer=2 之前的旧 App（契约扩展后必须仍能同步，
# 否则已发布的 0.2.0 APK 一夜全坏）。
MIN_SCHEMA_VER = 1
# 逐项 LWW 管的数组字段（新任务三 §5.3）：整数组覆盖会丢并发写入
# （手机勾待办 ∥ 网页加待办 → 一方被拒/被吞），按 id 并集 + updatedAt 新者胜。
MERGED_ARRAY_KEYS = ("todos", "goals")
# 旧客户端（schemaVer<2）不知道的字段：PUT 时云端原值保留（不覆盖、不清空）
PRESERVE_KEYS = ("todos", "goals", "persona")
ICS_WINDOW_WEEKS = 1  # 当前周 ±1

_VERSION_FILE = os.path.join(_HERE, "version.json")


class SyncStatePut(BaseModel):
    """PUT /api/sync/state 请求体。state 原样透传（服务端不解释 payload 内部字段）。"""
    model_config = ConfigDict(extra="forbid")
    state: dict
    schemaVer: int
    clientUpdatedAt: str


class SyncPlanPut(BaseModel):
    """PUT /api/sync/plan 请求体 —— WeekPlan 副本，仅作 ICS 素材，不校验内部逻辑。"""
    model_config = ConfigDict(extra="forbid")
    plan: dict


def _get_state_row(user_id: int):
    c = _conn()
    try:
        return c.execute(
            "SELECT schema_ver, payload, updated_at FROM sync_state WHERE user_id=?",
            (user_id,),
        ).fetchone()
    finally:
        c.close()


def _item_stamp(item: dict) -> str:
    """逐项 LWW 的时间戳：updatedAt 缺省退回 createdAt（与 TS memoTypes.todoStamp 同口径）。"""
    return str(item.get("updatedAt") or item.get("createdAt") or "")


def _item_newer(a: dict, b: dict) -> bool:
    """a 是否严格新于 b：能解析成时间按时间比，否则退回字符串比（与 TS stampNewer 同口径）。"""
    sa, sb = _item_stamp(a), _item_stamp(b)
    ta, tb = _parse_iso(sa), _parse_iso(sb)
    if ta is not None and tb is not None:
        return ta > tb
    if ta is not None:
        return sa != ""
    if tb is not None:
        return False
    return sa > sb


def _merge_array_by_id(incoming, stored):
    """待办/目标数组并集合并（schemaVer=2）：

    · 同 id → updatedAt 新者胜；平局 → 云端副本胜（以云端为准，stored 先入）；
    · 只在一侧有的 id → 保留（删除 = archived 归档，数组永不丢项）；
    · 无 id / 非 dict 的脏项丢弃（前向兼容：毒项不进库）。
    """
    merged: dict = {}
    for item in (stored or []) + (incoming or []):
        if not (isinstance(item, dict) and item.get("id")):
            continue
        cur = merged.get(str(item["id"]))
        if cur is None or _item_newer(item, cur):
            merged[str(item["id"])] = item
    return list(merged.values())


@router.get("/api/sync/state")
def api_sync_state_get(request: Request):
    user_id = user_id_from_request(request)
    if user_id is None:
        return _err(401, "unauthorized")
    row = _get_state_row(user_id)
    if not row:
        return {"found": False, "state": None, "schemaVer": SCHEMA_VER, "updatedAt": None}
    try:
        state = json.loads(row[1])
    except (ValueError, TypeError):
        state = None  # 库里是坏 JSON 时宁可报「没有状态」，也不把毒数据吐给客户端
    return {"found": state is not None, "state": state, "schemaVer": int(row[0]), "updatedAt": row[2]}


@router.put("/api/sync/state")
def api_sync_state_put(request: Request, body: SyncStatePut):
    user_id = user_id_from_request(request)
    if user_id is None:
        return _err(401, "unauthorized")
    # schemaVer 兼容（新任务三 §5.3）：v1 旧 App 仍接受；>2 的高版本不认识 → 400 不瞎猜
    if body.schemaVer > SCHEMA_VER or body.schemaVer < MIN_SCHEMA_VER:
        return _err(400, "unsupported_schema")
    client_ts = _parse_iso(body.clientUpdatedAt)
    if client_ts is None:
        return _err(400, "invalid_timestamp")
    if not isinstance(body.state, dict) or not body.state:
        return _err(400, "invalid_state")

    existing = _get_state_row(user_id)
    stored_payload = None
    if existing:
        server_ts = _parse_iso(existing[2])
        # 服务端时间戳解析不了（脏数据）→ 按「极旧」处理，让客户端能救回来
        if server_ts is not None and client_ts <= server_ts:
            # LWW：客户端旧 → 不写入，返回服务端副本（客户端提示「以云端为准」）
            try:
                state = json.loads(existing[1])
            except (ValueError, TypeError):
                state = None
            return {"accepted": False, "updatedAt": existing[2], "state": state}
        try:
            stored_payload = json.loads(existing[1])
        except (ValueError, TypeError):
            stored_payload = None
    if not isinstance(stored_payload, dict):
        stored_payload = {}

    if body.schemaVer < SCHEMA_VER:
        # 旧客户端（v1）：接受写入，但它不知道的新字段**保留云端原值**（不覆盖不清空）
        for k in PRESERVE_KEYS:
            if k in stored_payload:
                body.state[k] = stored_payload[k]
    else:
        # 新客户端（v2）：todos/goals 按 id 逐项 LWW 并集（防并发写入互相覆盖）
        for k in MERGED_ARRAY_KEYS:
            if k in stored_payload or k in body.state:
                body.state[k] = _merge_array_by_id(body.state.get(k), stored_payload.get(k))
        # persona：上行没带（null）而云端有 → 保留（web 端画像不该被手机写空）
        if stored_payload.get("persona") is not None and body.state.get("persona") is None:
            body.state["persona"] = stored_payload["persona"]

    new_ts = client_ts
    if existing:
        old_ts = _parse_iso(existing[2])
        if old_ts is not None and old_ts > new_ts:
            new_ts = old_ts  # 单调保险：绝不因时钟偏差往回走
    c = _conn()
    try:
        c.execute(
            "INSERT INTO sync_state(user_id, schema_ver, payload, updated_at) VALUES(?,?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET schema_ver=excluded.schema_ver, "
            "payload=excluded.payload, updated_at=excluded.updated_at",
            (user_id, body.schemaVer, json.dumps(body.state, ensure_ascii=False), new_ts.isoformat()),
        )
        c.commit()
    finally:
        c.close()
    return {"accepted": True, "updatedAt": new_ts.isoformat()}


@router.get("/api/sync/plan")
def api_sync_plan_get(request: Request, weekNo: int = Query(..., ge=1, le=60)):
    user_id = user_id_from_request(request)
    if user_id is None:
        return _err(401, "unauthorized")
    c = _conn()
    try:
        row = c.execute(
            "SELECT payload, updated_at FROM week_plans WHERE user_id=? AND week_no=?",
            (user_id, weekNo),
        ).fetchone()
    finally:
        c.close()
    if not row:
        return {"found": False, "plan": None, "updatedAt": None}
    try:
        plan = json.loads(row[0])
    except (ValueError, TypeError):
        plan = None
    return {"found": plan is not None, "plan": plan, "updatedAt": row[1]}


@router.put("/api/sync/plan")
def api_sync_plan_put(request: Request, body: SyncPlanPut, weekNo: int = Query(..., ge=1, le=60)):
    user_id = user_id_from_request(request)
    if user_id is None:
        return _err(401, "unauthorized")
    if not isinstance(body.plan, dict) or not body.plan:
        return _err(400, "invalid_plan")
    now = _now_iso()
    c = _conn()
    try:
        c.execute(
            "INSERT INTO week_plans(user_id, week_no, payload, updated_at) VALUES(?,?,?,?) "
            "ON CONFLICT(user_id, week_no) DO UPDATE SET payload=excluded.payload, "
            "updated_at=excluded.updated_at",
            (user_id, weekNo, json.dumps(body.plan, ensure_ascii=False), now),
        )
        c.commit()
    finally:
        c.close()
    return {"updatedAt": now}


# ---------------- ICS 生成（§6.5） ----------------

def _ics_escape(text: str) -> str:
    """RFC 5545 §3.3.11：反斜杠、分号、逗号、换行都要转义。"""
    return (
        str(text)
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def _ics_fold(line: str) -> list[str]:
    """RFC 5545 §3.1：一行 ≤75 字节，超出折成以空格开头的续行。

    按字符累加、按 UTF-8 字节数计长（中文一行 ≈ 25 字就到 75 字节了），
    续行前缀是单个空格。
    """
    limit = 73  # 首行 75 - 折行安全余量；续行 74（含前导空格）≤75
    out, buf, width = [], "", 0
    for ch in line:
        w = len(ch.encode("utf-8"))
        cap = limit if not out else limit - 1  # 续行要留一个字节给前导空格
        if buf and width + w > cap:
            out.append(buf)
            buf, width = "", 0
            continue
        buf += ch
        width += w
    if buf:
        out.append(buf)
    return [((" " + seg) if i else seg) for i, seg in enumerate(out)]


def _dt_line(prefix: str, date: "_dt.date", minutes: int) -> str:
    """`DTSTART:20261005T080000` —— 浮动本地时间（无 TZID，大陆单时区口径，方案已声明）。"""
    hh, mm = divmod(max(0, min(int(minutes), 24 * 60 - 1)), 60)
    return f"{prefix}:{date:%Y%m%d}T{hh:02d}{mm:02d}00"


def build_ics(term_start: str | None, plans: list[dict]) -> str:
    """plans: [{weekNo:int, plan:{blocks:[TimeBlock...]}}] —— WeekPlan 副本，服务端不校验内部逻辑。

    块字段缺失就跳过该块（容错：副本是客户端原样 PUT 的，版本差异要有容忍度）。
    """
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//USST Lightpath//CN",
        "CALSCALE:GREGORIAN",
        "X-WR-CALNAME:光溯 · 周计划",
    ]
    base = None
    if term_start:
        try:
            base = _dt.date.fromisoformat(str(term_start))
        except (ValueError, TypeError):
            base = None
    for item in plans:
        week_no = int(item.get("weekNo") or 0)
        blocks = ((item.get("plan") or {}).get("blocks")) or []
        for b in blocks:
            if not isinstance(b, dict):
                continue
            try:
                dow = int(b.get("dayOfWeek"))
                start_min = int(b.get("startMin"))
                end_min = int(b.get("endMin"))
            except (TypeError, ValueError):
                continue  # 关键字段缺/坏 → 跳过这一块，不让一条毒块毁掉整个日历
            if not (1 <= dow <= 7) or end_min <= start_min:
                continue
            title = str(b.get("title") or "").strip() or "（未命名）"
            emoji = str(b.get("emoji") or "").strip()
            place = str(b.get("place") or "").strip()
            summary = (f"{emoji}{title}" if emoji else title) + (f" · {place}" if place else "")
            desc_parts = [p for p in (str(b.get("room") or "").strip(),
                                      str(b.get("reason") or "").strip()) if p]
            uid = hashlib.sha1(f"{b.get('id', title)}@{week_no}".encode("utf-8")).hexdigest() + "@lightpath"
            if base is not None:
                day = base + _dt.timedelta(days=(week_no - 1) * 7 + (dow - 1))
                lines += [
                    "BEGIN:VEVENT",
                    f"UID:{uid}",
                    _dt_line("DTSTART", day, start_min),
                    _dt_line("DTEND", day, end_min),
                    f"SUMMARY:{_ics_escape(summary)}",
                ]
                if desc_parts:
                    lines.append(f"DESCRIPTION:{_ics_escape('｜'.join(desc_parts))}")
                lines += [
                    "BEGIN:VALARM",
                    "ACTION:DISPLAY",
                    f"DESCRIPTION:{_ics_escape(summary)}",
                    "TRIGGER:-PT10M",
                    "END:VALARM",
                    "END:VEVENT",
                ]
            else:
                # 没有 termStart 推不出具体日期 → 这块跳过（日历不能给错日期的块）
                continue
    lines.append("END:VCALENDAR")
    folded: list[str] = []
    for ln in lines:
        folded.extend(_ics_fold(ln) or [""])
    return "\r\n".join(folded) + "\r\n"


@router.get("/api/sync/plan.ics")
def api_sync_plan_ics(token: str = Query(..., min_length=8)):
    """免鉴权头（日历 App 填不了 Header）—— token 即凭据，泄露可重置（白天做重置接口）。"""
    c = _conn()
    try:
        user = c.execute("SELECT id FROM users WHERE ics_token=?", (token,)).fetchone()
        if not user:
            return _err(404, "not_found")
        user_id = int(user[0])
        state_row = c.execute(
            "SELECT payload FROM sync_state WHERE user_id=?", (user_id,)
        ).fetchone()
        plan_rows = c.execute(
            "SELECT week_no, payload FROM week_plans WHERE user_id=? ORDER BY week_no",
            (user_id,),
        ).fetchall()
    finally:
        c.close()

    term_start = None
    if state_row:
        try:
            term_start = (json.loads(state_row[0]) or {}).get("termStart")
        except (ValueError, TypeError):
            term_start = None

    plans = []
    if term_start:
        try:
            base = _dt.date.fromisoformat(str(term_start))
            cur_week = (_dt.date.today() - base).days // 7 + 1
            want = {cur_week - 1, cur_week, cur_week + 1}
        except (ValueError, TypeError):
            want = None
        if want:
            plans = [
                {"weekNo": wk, "plan": _safe_json(p)}
                for wk, p in plan_rows if int(wk) in want
            ]
    if not plans:  # 无 termStart 或窗口内没有副本 → 退化为全部已存周
        plans = [{"weekNo": wk, "plan": _safe_json(p)} for wk, p in plan_rows]

    ics = build_ics(term_start, plans)
    return Response(
        content=ics,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": 'inline; filename="lightpath.ics"'},
    )


def _safe_json(text):
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return {"blocks": []}


@router.get("/api/version")
def api_version():
    """读 server/version.json（部署时放置）。文件缺失/坏 JSON → 404 JSON，不 500。"""
    try:
        with open(_VERSION_FILE, encoding="utf-8") as f:
            meta = json.load(f)
        if not isinstance(meta, dict) or not meta.get("version"):
            raise ValueError("missing version")
        return {
            "version": str(meta["version"]),
            "apkUrl": str(meta.get("apkUrl", "")),
            "notes": str(meta.get("notes", "")),
        }
    except (OSError, ValueError):
        return _err(404, "version_unavailable")
