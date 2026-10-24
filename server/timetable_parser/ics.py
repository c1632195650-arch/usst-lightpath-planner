# timetable_parser/ics.py
# F7-2/D1（2026-10-24）：日历 .ics（VEVENT + RRULE 简化解析）→ course_records 统一形状。
#
# 只用标准库（re/datetime），RFC 5545 取课程表场景够用的子集：
#   - 折行 unfolding（CRLF/LF + 空格/制表符 = 续行）手写；
#   - VEVENT 里取 SUMMARY→课名、LOCATION→教室、DESCRIPTION 的"教师:×××"
#     （认全/半角冒号）或 ORGANIZER 的 CN 参数→教师；
#   - DTSTART/DTEND → 时段。课表引擎吃"节次"，但 ICS 只有墙上时间，而仓库里
#     没有(也不该由解析器拍脑袋定)一套"几点几分=第几节"的对照表 ——
#     所以时间映射不了节次就**不硬造节次**：节次留空，时段如实放进额外
#     "time" 字段（"08:00-09:35"），前端/后续批次要做映射再加；
#   - RRULE 只展开 FREQ=WEEKLY（课程表即周循环）：INTERVAL=n（隔 n-1 周）、
#     BYDAY=MO,TU…（容忍 2MO 这类带序数前缀）、COUNT（按次截断）、
#     UNTIL（按日期截断，含当天）。周次从 DTSTART 所在周的周一起算（该周=第1周）；
#     首周里落在 DTSTART 之前的 BYDAY 天不算（首 occurrence 即 DTSTART 起）。
#   - 其余 FREQ（DAILY/MONTHLY…）不展开，只保留 DTSTART 首次；
#     EXDATE/RDATE/RECURRENCE-ID 等不认（简化边界，见批注）。
# 全天事件（VALUE=DATE / 无时刻）没有时段信息，不是课，跳过；
# 没有 SUMMARY 或缺 DTSTART/DTEND 的事件跳过；整份没有 VEVENT 抛 ValueError。

import re
from datetime import datetime, timedelta

from .wakeup import DAY_NAMES, new_record, to_int, weeks_to_text

# RFC 5545 星期代码 → python weekday（周一=0）
WEEKDAY_CODE = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}

# 展开的安全上限：第 30 周之后不再生成（真课表一学期不会超过 30 周）
_MAX_WEEK = 30

# DESCRIPTION 里的教师写法："教师:王建国" / "教师：王建国"（姓名不含空白时取整）
_TEACHER_IN_DESC = re.compile(r"教师[:：]\s*(\S+)")

_DT_FORMATS = ("%Y%m%dT%H%M%S", "%Y%m%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d")
_DATE_ONLY_FORMATS = ("%Y%m%d", "%Y-%m-%d")


def _unfold(text):
    """RFC 5545 折行还原：换行后的第一个空格/制表符是续行标记，连同行尾一起去掉。"""
    return re.sub(r"\r?\n[ \t]", "", text)


def _parse_line(line):
    """一行内容 'NAME;PARAM=VAL;PARAM=VAL:value' → (NAME大写, {param:val}, value)。
    按第一个不在双引号里的 ASCII 冒号切（参数值可能是 "a:b" 带引号串）。
    不含冒号的行不是合法内容行，返回 ('', {}, '')。"""
    in_quotes = False
    cut = -1
    for i, ch in enumerate(line):
        if ch == '"':
            in_quotes = not in_quotes
        elif ch == ":" and not in_quotes:
            cut = i
            break
    if cut < 0:
        return "", {}, ""
    head, value = line[:cut], line[cut + 1:]
    parts = head.split(";")
    params = {}
    for p in parts[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            params[k.strip().upper()] = v.strip().strip('"')
    return parts[0].strip().upper(), params, value


def _parse_dt(value, params):
    """DTSTART/DTEND 值 → (datetime, 'date'|'datetime')；认不出 → (None, None)。
    尾部 Z（UTC）剥掉按本墙钟读（简化：跨时区偏移可能挪天，课程表场景可接受，
    解析器不做时区换算，不引入第三方库）。"""
    v = value.strip().rstrip("Zz")
    date_only = params.get("VALUE", "").upper() == "DATE" or "T" not in v
    for fmt in _DT_FORMATS:
        try:
            return datetime.strptime(v, fmt), ("date" if fmt in _DATE_ONLY_FORMATS else "datetime")
        except ValueError:
            continue
    return None, None


def _parse_rrule(value):
    """"FREQ=WEEKLY;COUNT=16;BYDAY=MO,WE" → {"FREQ": "WEEKLY", ...}（键统一大写）。"""
    rule = {}
    for part in value.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            rule[k.strip().upper()] = v.strip()
    return rule


def _expand_occurrences(dtstart, rule):
    """按 RRULE 从 DTSTART 展开全部 occurrence 日期（简化 WEEKLY 语义，见文件头）。
    返回升序 date 列表，必含首 occurrence。"""
    freq = rule.get("FREQ", "").upper()
    if freq and freq != "WEEKLY":
        return [dtstart.date()]  # 非 WEEKLY 不展开，只保留首次（如实、不多给）

    interval = to_int(rule.get("INTERVAL"))
    interval = interval if (interval is not None and interval >= 1) else 1

    bydays = []
    for tok in str(rule.get("BYDAY", "")).split(","):
        code = tok.strip().upper()[-2:]  # 容忍 '2MO' 带序数前缀的写法
        if code in WEEKDAY_CODE:
            bydays.append(WEEKDAY_CODE[code])
    if not bydays:
        bydays = [dtstart.weekday()]

    count = to_int(rule.get("COUNT"))
    until = None
    if rule.get("UNTIL"):
        udt, _kind = _parse_dt(rule["UNTIL"], {})
        if udt is not None:
            until = udt.date()

    week1_monday = dtstart.date() - timedelta(days=dtstart.weekday())
    out = []
    made = 0
    week_index = 0
    while week_index * interval < _MAX_WEEK:
        monday = week1_monday + timedelta(weeks=week_index * interval)
        for wd in sorted(bydays):
            d = monday + timedelta(days=wd)
            if d < dtstart.date():
                continue  # 首周里 DTSTART 之前的同周天不算
            if until is not None and d > until:
                return out
            out.append(d)
            made += 1
            if count is not None and made >= count:
                return out
        week_index += 1
    return out


def _iter_vevents(lines):
    """按行游标切出 VEVENT 的内容行列表。BEGIN/END 配对，嵌套异常时以 END 为界。"""
    cur = None
    for line in lines:
        name, params, value = _parse_line(line)
        if name == "BEGIN" and value.strip().upper() == "VEVENT":
            cur = []
        elif name == "END" and value.strip().upper() == "VEVENT":
            if cur is not None:
                yield cur
            cur = None
        elif cur is not None and name:
            cur.append((name, params, value))


def parse_ics(text):
    """日历 ICS 文本 → 课程记录列表（course_records 形状 + 额外 "time" 时段字段）。
    整份没有 VEVENT 抛 ValueError；单条坏事件跳过不中断。"""
    lines = _unfold(text).splitlines()
    events = list(_iter_vevents(lines))
    if not events:
        raise ValueError("没有找到 VEVENT 事件，可能不是课表日历（.ics）文件")

    records = []
    for event in events:
        summary = location = teacher = ""
        desc_teacher = org_teacher = ""
        dtstart = dtend = None
        rule = {}
        for name, params, value in event:
            if name == "SUMMARY" and not summary:
                summary = value.replace("\\,", ",").replace("\\;", ";").replace("\\n", " ").strip()
            elif name == "LOCATION" and not location:
                location = value.replace("\\,", ",").replace("\\;", ";").strip()
            elif name == "DESCRIPTION" and not desc_teacher:
                m = _TEACHER_IN_DESC.search(value)
                if m:
                    desc_teacher = m.group(1).strip()
            elif name == "ORGANIZER" and not org_teacher:
                org_teacher = params.get("CN", "").strip()
            elif name == "DTSTART" and dtstart is None:
                dtstart, kind = _parse_dt(value, params)
                if kind == "date":
                    dtstart = None  # 全天事件没有时段，不是课
            elif name == "DTEND" and dtend is None:
                dtend, _kind = _parse_dt(value, params)
            elif name == "RRULE" and not rule:
                rule = _parse_rrule(value)
        if not summary or dtstart is None or dtend is None:
            continue  # 课名/起止时间缺一不可，跳过（不硬造）
        teacher = desc_teacher or org_teacher
        if dtend < dtstart:
            continue  # 结束早于开始 = 坏数据

        time_text = f"{dtstart:%H:%M}-{dtend:%H:%M}"
        week1_monday = dtstart.date() - timedelta(days=dtstart.weekday())
        by_day = {}  # weekday → 出现周号列表
        for d in _expand_occurrences(dtstart, rule):
            week_no = (d - week1_monday).days // 7 + 1
            by_day.setdefault(d.weekday(), []).append(week_no)
        if not by_day:
            continue

        for wd in sorted(by_day):
            weeks = sorted(set(by_day[wd]))
            record = new_record()
            record["课名"] = summary
            record["周次原文"] = weeks_to_text(weeks)
            record["周次"] = weeks
            record["教室"] = location
            record["教师"] = teacher
            record["星期"] = DAY_NAMES[wd]
            record["time"] = time_text  # ICS 只有墙上时间：映射不了节次就如实给时段
            records.append(record)
    return records
