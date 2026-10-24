# timetable_parser/wakeup.py
# F7-2/D1（2026-10-24）：WakeUp 课程表 App 导出 JSON → course_records 统一形状。
#
# 只用标准库（json/re）。输出与 parse_pdf 的产物逐字段同形：
#   {课名, 类型, 节次, 周次原文, 周次[…], 校区, 教室, 教师,
#    考核方式, 学时组成, 周学时, 总学时, 学分, 星期}
# WakeUp/ICS 没有的属性（类型/校区/学时/学分等）如实留空串，不硬造。
#
# 本文件同时托管 F7-2 两个解析器共用的两个小工具（new_record / weeks_to_text），
# ics.py 从这里 import，保证两边产出的记录骨架零漂移。
#
# WakeUp 社区通用 schema（按宽容映射，谁存在用谁，取第一个非空）：
#   课名  courseName / courseNameString / name / course / title
#   教师  teacher / teacherName / teacherString
#   教室  classRoom / classRoomString / classroom / room / roomString / place
#   星期  day / dayOfWeek / weekDay / weekday   （1~7，周一=1；也认"周一/星期一"）
#   节次  startNode / startSection / startNodeInt  +  endNode / endSection / endNodeInt
#         （end 缺省时用 step / nodeCount 推，再缺省视为单节）
#   周次  weekList / weeks / week（数组）或 weekListString / weekText（"1-8,10-16" 串）
#         或 startWeek + endWeek（+ type：0=每周 1=单周 2=双周）
# 结构性字段缺失（无课名/星期非法/节次非法）→ 该条跳过，绝不中断整份导入；
# 属性字段缺失（教师/教室）→ 安全默认空串。

import json

from .constants import DAY_ALIAS
from .course_text import expand_weeks

# 一周的标准星期名（与 constants.DAY_ALIAS 的值一致，下标 = 周一=0）
DAY_NAMES = ("星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日")

# 节次/周次的合理上限（防御异常数据撑爆循环；真课表一天不会超过 30 节、一学期不会超过 30 周）
_MAX_NODE = 30
_MAX_WEEK = 30

_NAME_KEYS = ("courseName", "courseNameString", "name", "course", "title")
_TEACHER_KEYS = ("teacher", "teacherName", "teacherString")
_ROOM_KEYS = ("classRoom", "classRoomString", "classroom", "room", "roomString", "place")
_DAY_KEYS = ("day", "dayOfWeek", "weekDay", "weekday")
_START_KEYS = ("startNode", "startSection", "startNodeInt")
_END_KEYS = ("endNode", "endSection", "endNodeInt")
_STEP_KEYS = ("step", "nodeCount")
_WEEKS_LIST_KEYS = ("weekList", "weeks", "week")
_WEEKS_STR_KEYS = ("weekListString", "weekText", "weeksText")


def new_record():
    """course_records 空记录骨架：键名与键序均照抄 course_text.split_courses 的产物，
    保证 WakeUp/ICS 与 PDF 导入的记录逐字段同形（星期由各解析器在最后补上）。"""
    return {
        "课名": "", "类型": "",
        "节次": "", "周次原文": "", "周次": [],
        "校区": "", "教室": "", "教师": "",
        "考核方式": "", "学时组成": "", "周学时": "", "总学时": "", "学分": "",
    }


def weeks_to_text(nums):
    """周次数字列表 → PDF 同款『周次原文』风格："1-8周,10-17周" / "9周"。
    连续周压成区间，孤立周单列；反向可被 course_text.expand_weeks 重解析。"""
    if not nums:
        return ""
    ns = sorted({int(n) for n in nums})
    parts = []
    a = b = ns[0]
    for n in ns[1:]:
        if n == b + 1:
            b = n
        else:
            parts.append(f"{a}-{b}周" if a != b else f"{a}周")
            a = b = n
    parts.append(f"{a}-{b}周" if a != b else f"{a}周")
    return ",".join(parts)


def to_int(v):
    """宽容转整数：认 1 / 1.0 / "1" / " 2 "；不认就 None（布尔不算数）。"""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v) if v.is_integer() else None
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        try:
            return int(s)
        except ValueError:
            try:
                f = float(s)
                return int(f) if f.is_integer() else None
            except ValueError:
                return None
    return None


def _pick(item, keys):
    """按别名顺序取第一个非空字段值。"""
    for k in keys:
        v = item.get(k)
        if v is not None and str(v).strip() != "":
            return v
    return None


def _parse_day(v):
    """WakeUp 的 day（1~7 或"周一"等别名）→ 标准星期名；认不出返回空串。"""
    if v is None:
        return ""
    s = str(v).strip()
    if s in DAY_ALIAS:
        return DAY_ALIAS[s]
    n = to_int(s)
    if n is not None and 1 <= n <= 7:
        return DAY_NAMES[n - 1]
    return ""


def _parse_weeks(item):
    """ WakeUp 条目 → (周次数字列表, 周次原文)。
    优先显式周列表/周字符串；否则 startWeek+endWeek(+type 单双周)。
    两种来源都缺 → ([], "")（与 PDF 坏格子留空周次的行为一致）。"""
    for k in _WEEKS_LIST_KEYS + _WEEKS_STR_KEYS:
        if k in item and item[k] not in (None, "", []):
            v = item[k]
            if isinstance(v, list):
                nums = [t for t in (to_int(x) for x in v) if t is not None]
            else:
                try:
                    nums = expand_weeks(v)
                except Exception:
                    nums = []
            nums = [n for n in nums if 1 <= n <= _MAX_WEEK]
            if nums:
                return sorted(set(nums)), weeks_to_text(nums)
    sw = to_int(item.get("startWeek"))
    ew = to_int(item.get("endWeek"))
    if sw is not None and ew is not None and 1 <= sw <= ew <= _MAX_WEEK:
        wtype = str(item.get("type", "0")).strip()
        lo, hi, step = sw, ew, 1
        if wtype == "1":  # 单周：只留奇数周
            if lo % 2 == 0:
                lo += 1
            step = 2
        elif wtype == "2":  # 双周：只留偶数周
            if lo % 2 == 1:
                lo += 1
            step = 2
        nums = list(range(lo, hi + 1, step))
        if not nums:
            return [], ""
        text = f"{nums[0]}-{nums[-1]}周" if len(nums) > 1 else f"{nums[0]}周"
        if wtype == "1":
            text += "(单周)"
        elif wtype == "2":
            text += "(双周)"
        return nums, text
    return [], ""


def parse_wakeup(text):
    """WakeUp 课程表导出 JSON 文本 → 课程记录列表（与 parse_pdf 产物逐字段同形）。
    不是 WakeUp JSON（没有 items 数组）时抛 ValueError；单条坏数据跳过不中断。"""
    data = json.loads(text)
    if isinstance(data, dict):
        items = data.get("items")
    elif isinstance(data, list):
        items = data  # 有些导出工具直接给课程数组
    else:
        items = None
    if not isinstance(items, list):
        raise ValueError("不是 WakeUp 课程表 JSON（没有找到 items 课程数组）")

    records = []
    for it in items:
        if not isinstance(it, dict):
            continue
        name = str(_pick(it, _NAME_KEYS) or "").strip()
        if not name:
            continue  # 没有课名的条目无法入库
        day = _parse_day(_pick(it, _DAY_KEYS))
        if not day:
            continue  # 星期非法 = 没法排进周课表，跳过
        start = to_int(_pick(it, _START_KEYS))
        if start is None or not 1 <= start <= _MAX_NODE:
            continue  # 起始节次缺失/非法，跳过（不硬造节次）
        end = to_int(_pick(it, _END_KEYS))
        if end is None:
            step = to_int(_pick(it, _STEP_KEYS))
            end = start + step - 1 if (step is not None and step >= 1) else start
        if end < start or end > _MAX_NODE:
            continue
        weeks, weeks_text = _parse_weeks(it)

        record = new_record()
        record["课名"] = name
        record["节次"] = f"{start}-{end}节" if end != start else f"{start}节"
        record["周次原文"] = weeks_text
        record["周次"] = weeks
        record["教室"] = str(_pick(it, _ROOM_KEYS) or "").strip()
        record["教师"] = str(_pick(it, _TEACHER_KEYS) or "").strip()
        record["星期"] = day
        records.append(record)
    return records
