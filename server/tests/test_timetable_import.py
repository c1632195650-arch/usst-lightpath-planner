# -*- coding: utf-8 -*-
"""
F7-2 · D1 课表多格式导入测试（纯 Python 断言，环境无 pytest 且禁装依赖）
================================================================================
只测 server/timetable_parser/wakeup.py（WakeUp JSON）与 ics.py（日历 VEVENT+RRULE）
的纯函数解析，不拉起 FastAPI/app（app 重依赖，端点行为由人工验收）。
参照形状来自 course_text.split_courses 的**真实实现产物**（不是抄写字段名），
保证 WakeUp/ICS 与既有 PDF 导入的 course_records 逐字段同形。

运行：.venv/Scripts/python.exe server/tests/test_timetable_import.py
RV（反向验证）由执行会话人工做一次：改坏解析器里的周次映射 → 对应用例必须变红
→ 还原（实测记录见交付报告）。
"""
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, ".."))

from timetable_parser.course_text import expand_weeks, split_courses  # noqa: E402
from timetable_parser.ics import parse_ics  # noqa: E402
from timetable_parser.wakeup import parse_wakeup, weeks_to_text  # noqa: E402

FIXTURES = os.path.join(_HERE, "fixtures")


def _load_wakeup_fixture():
    with open(os.path.join(FIXTURES, "wakeup_sample.json"), encoding="utf-8") as fh:
        return json.load(fh)


def _load_ics_fixture():
    with open(os.path.join(FIXTURES, "timetable_sample.ics"), encoding="utf-8") as fh:
        return fh.read()


def _pdf_reference_record():
    """用既有 PDF 解析器的真实实现造一条参照记录（parse_pdf 只是在其上补"星期"）。"""
    cell = ("高等数学(下)★(1-2节)1-8周,10-17周/校区:军工路/场地:一教101/教师:张三"
            "/考核方式:考试/课程学时组成:讲授/周学时:2/总学时:32/学分:2")
    ref = split_courses(cell)[0]
    ref["星期"] = "星期一"  # parse_pdf 里补的字段，这里照抄
    return ref


# ---------- 参照形状（import_pdf 产物） ----------

def test_pdf_reference_is_our_contract():
    ref = _pdf_reference_record()
    assert ref["课名"] == "高等数学(下)"
    assert ref["节次"] == "1-2节"
    assert ref["周次"] == list(range(1, 9)) + list(range(10, 18))
    assert set(ref) == {"课名", "类型", "节次", "周次原文", "周次", "校区", "教室", "教师",
                        "考核方式", "学时组成", "周学时", "总学时", "学分", "星期"}


def test_wakeup_shape_matches_pdf_records():
    ref_keys = set(_pdf_reference_record())
    for rec in parse_wakeup(json.dumps(_load_wakeup_fixture(), ensure_ascii=False)):
        assert set(rec) == ref_keys, f"WakeUp 记录键集与 PDF 产物不一致：{sorted(set(rec) ^ ref_keys)}"
        assert isinstance(rec["周次"], list) and all(isinstance(w, int) for w in rec["周次"])
        for k in ref_keys - {"周次"}:
            assert isinstance(rec[k], str), f"字段 {k} 应为字符串"


def test_ics_shape_matches_pdf_records():
    ref_keys = set(_pdf_reference_record())
    for rec in parse_ics(_load_ics_fixture()):
        assert set(rec) == ref_keys | {"time"}, "ICS 记录应比 PDF 产物只多一个 time 时段字段"
        assert isinstance(rec["周次"], list) and all(isinstance(w, int) for w in rec["周次"])
        assert rec["time"] and "->" not in rec["time"]


# ---------- WakeUp 解析正确性 ----------

def test_wakeup_fixture_parse_and_first_record():
    records = parse_wakeup(json.dumps(_load_wakeup_fixture(), ensure_ascii=False))
    assert len(records) == 6, f"应解析出 6 条（第 7 条无名/星期非法被跳过），实际 {len(records)}"
    r0 = records[0]
    assert r0["课名"] == "高等数学(下)"
    assert r0["星期"] == "星期一"
    assert r0["节次"] == "1-2节"
    assert r0["周次"] == list(range(1, 17))
    assert r0["周次原文"] == "1-16周"
    assert r0["教室"] == "一教201"
    assert r0["教师"] == "王建国"
    assert r0["类型"] == "" and r0["学分"] == "" and r0["校区"] == ""


def test_wakeup_parity_and_weeklist_mapping():
    records = parse_wakeup(json.dumps(_load_wakeup_fixture(), ensure_ascii=False))
    r1 = records[1]  # type=1 单周
    assert r1["星期"] == "星期二" and r1["节次"] == "3-4节"
    assert r1["周次"] == list(range(1, 17, 2)), f"单周映射坏了：{r1['周次']}"
    assert r1["周次原文"] == "1-15周(单周)"
    r2 = records[2]  # weekList 显式列表 + step 推节次
    assert r2["周次"] == [1, 3, 5, 7, 9, 11, 13, 15]
    assert r2["周次原文"] == "1周,3周,5周,7周,9周,11周,13周,15周"
    assert r2["节次"] == "6-7节"
    r3 = records[3]  # type=2 双周，5-12 → 6,8,10,12
    assert r3["周次"] == [6, 8, 10, 12], f"双周映射坏了：{r3['周次']}"
    assert r3["周次原文"] == "6-12周(双周)"
    assert r3["节次"] == "11-14节"
    r5 = records[5]  # weekListString 范围写法 + 空教师/教室安全默认
    assert r5["周次"] == [9, 10] and r5["周次原文"] == "9-10周"
    assert r5["教师"] == "" and r5["教室"] == "" and r5["星期"] == "星期六"


def test_wakeup_bad_inputs_return_error_or_empty():
    # 识别不出格式（非 JSON / 根不是对象 / 没有 items 数组）→ 报错形态（端点转"解析失败"）
    for bad in ("不是 JSON", "123", '{"foo": 1}'):
        try:
            parse_wakeup(bad)
            raise AssertionError(f"坏输入应抛 ValueError：{bad!r}")
        except ValueError:
            pass
    # 空 items / 根是数组但条目全废 → 空列表（不炸）
    assert parse_wakeup('{"items": []}') == []
    assert parse_wakeup('[{"no": "items"}]') == []  # 根数组也认，坏条目跳过
    assert parse_wakeup('{"items": [null, "x", 3]}') == []  # 非对象条目跳过
    # 星期非法 / 节次非法 / 周次区间倒挂 → 条目级跳过，不中断
    one = '{"items": [{"courseName": "甲", "day": "9", "startNode": 1, "endNode": 2, "startWeek": 1, "endWeek": 3}]}'
    assert parse_wakeup(one) == []
    two = '{"items": [{"courseName": "乙", "day": "1", "startNode": 0, "endNode": 2, "startWeek": 1, "endWeek": 3}]}'
    assert parse_wakeup(two) == []
    mixed = ('{"items": ['
             '{"courseName": "好课", "day": "1", "startNode": 1, "endNode": 2, "startWeek": 2, "endWeek": 1},'
             '{"courseName": "乙", "day": "1", "startNode": 1, "endNode": 2, "startWeek": 1, "endWeek": 3}]}')
    records = parse_wakeup(mixed)
    assert len(records) == 2, "倒挂周次=属性级坏数据：保留记录、不影响别的条目"
    assert records[0]["课名"] == "好课" and records[0]["周次"] == []
    assert records[1]["课名"] == "乙" and records[1]["周次"] == [1, 2, 3]
    # 周次区间倒挂（startWeek>endWeek）→ 周次留空但记录保留（属性缺失给安全默认）
    flipped = '{"items": [{"courseName": "丙", "day": "1", "startNode": 1, "endNode": 2, "startWeek": 5, "endWeek": 3}]}'
    rec = parse_wakeup(flipped)
    assert len(rec) == 1 and rec[0]["周次"] == [] and rec[0]["周次原文"] == ""


def test_weeks_to_text_roundtrip():
    for nums in ([1, 2, 3, 8], [9], list(range(1, 17)), [1, 3, 5], [2, 4, 6, 10, 11, 12]):
        text = weeks_to_text(nums)
        assert expand_weeks(text) == sorted(set(nums)), f"{nums} → {text} 反解析不一致"


# ---------- ICS 解析正确性 ----------

def test_ics_fixture_parse_all_four():
    records = parse_ics(_load_ics_fixture())
    assert len(records) == 4, f"应解析出 4 条，实际 {len(records)}"
    r0 = records[0]
    assert r0["课名"] == "高等数学(下)"
    assert r0["星期"] == "星期一"
    assert r0["节次"] == ""  # 不硬造节次
    assert r0["time"] == "08:00-09:35"
    assert r0["周次"] == list(range(1, 17)) and r0["周次原文"] == "1-16周"  # COUNT=16
    assert r0["教师"] == "王建国" and r0["教室"] == "一教201"


def test_ics_rrule_interval_and_organizer():
    records = parse_ics(_load_ics_fixture())
    r1 = records[1]  # INTERVAL=2;COUNT=8 → 单周循环；教师取 ORGANIZER CN
    assert r1["课名"] == "大学英语(四)" and r1["星期"] == "星期二"
    assert r1["time"] == "09:50-11:35"
    assert r1["周次"] == [1, 3, 5, 7, 9, 11, 13, 15], f"INTERVAL=2 展开坏了：{r1['周次']}"
    assert r1["教师"] == "李文静"


def test_ics_rrule_until():
    records = parse_ics(_load_ics_fixture())
    r2 = records[2]  # UNTIL=20260415 → 第 1~7 周（3/4 起每周三）
    assert r2["课名"] == "数据结构" and r2["星期"] == "星期三"
    assert r2["time"] == "14:00-15:45"
    assert r2["周次"] == list(range(1, 8)) and r2["周次原文"] == "1-7周"


def test_ics_byday_and_folded_description():
    records = parse_ics(_load_ics_fixture())
    r3 = records[3]  # DTSTART 周四但 BYDAY=TU；首周周二在 DTSTART 前 → 从第 2 周起
    assert r3["课名"] == "形势与政策"
    assert r3["星期"] == "星期二", f"BYDAY 应覆盖 DTSTART 的星期：{r3['星期']}"
    assert r3["周次"] == [2, 3, 4, 5], f"BYDAY 首周截断坏了：{r3['周次']}"
    assert r3["周次原文"] == "2-5周"
    assert r3["time"] == "18:30-20:10"
    assert r3["教师"] == "陈红", "折行 unfolding 坏了：续行上的教师名丢了"


def test_ics_crlf_and_quoted_params():
    raw = ("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:折行课\r\n"
           "DTSTART;TZID=Asia/Shanghai:20260302T080000\r\n"
           "DTEND;TZID=Asia/Shanghai:20260302T093500\r\n"
           "DESCRIPTION:教师:\r\n  张三丰\r\n"
           "ATTENDEE;CN=\"带:冒号\":mailto:a@b.c\r\n"
           "END:VEVENT\r\nEND:VCALENDAR\r\n")
    records = parse_ics(raw)
    assert len(records) == 1
    assert records[0]["教师"] == "张三丰", "CRLF 折行 unfolding 失败"
    assert records[0]["星期"] == "星期一" and records[0]["time"] == "08:00-09:35"


def test_ics_bad_inputs_return_error_or_empty():
    for bad in ("随便一段文字", "BEGIN:VCALENDAR\r\nEND:VCALENDAR"):
        try:
            parse_ics(bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"没有 VEVENT 的输入应抛 ValueError：{bad!r}")
    # 有事件但缺课名/起止时间 → 全跳过，返回空列表（端点转"未解析到任何课程"）
    empty = ("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:没时间的课\r\nEND:VEVENT\r\n"
             "BEGIN:VEVENT\r\nDTSTART:20260302T080000\r\nDTEND:20260302T093500\r\nEND:VEVENT\r\nEND:VCALENDAR")
    assert parse_ics(empty) == []
    # 全天事件（VALUE=DATE）没有时段 → 跳过
    allday = ("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:开学典礼\r\n"
              "DTSTART;VALUE=DATE:20260302\r\nDTEND;VALUE=DATE:20260303\r\nEND:VEVENT\r\nEND:VCALENDAR")
    assert parse_ics(allday) == []


TESTS = [v for k, v in sorted(globals().items()) if k.startswith("test_")]

if __name__ == "__main__":
    failed = 0
    for t in TESTS:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e or 'assertion failed'}")
    if failed:
        print(f"{failed}/{len(TESTS)} FAILED")
        sys.exit(1)
    print(f"ALL PASS ({len(TESTS)} tests)")
