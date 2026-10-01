# timetable_parser/course_text.py
# 负责"一格文字 -> 一门一门课"的拆分与字段抽取(纯字符串处理,不依赖 PDF)

import re

from .constants import KIND_BY_MARK, MARKERS


def expand_weeks(raw):
    """把 '9'、'10-17'、'1-8,10-17' 这类周次文字变成数字列表"""
    nums = []
    for part in str(raw).replace("周", "").split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-")
            for w in range(int(a), int(b) + 1):
                nums.append(w)
        else:
            nums.append(int(part))
    nums.sort()
    return nums


def _first_marker(text):
    """返回 text 里第一个出现的标记字符及其位置;没有就返回 (-1, '')"""
    for m in re.finditer(r"[★○●◇◆]", text):
        return m.start(), m.group(0)
    return -1, ""


def _find_credit_end(body):
    """找到 '学分:数字' 的结束位置;找不到就返回整段结尾(健壮性兜底)"""
    m = re.search(r"学分:(\d+(?:\.\d+)?)", body)
    return m.end() if m else len(body)


def _clean_course_name(name):
    """清洗课名:去掉上一格残留的 '学分:数字' 尾巴,返回真名;认不出就返回空串"""
    if "/" in name or ":" in name:
        cuts = list(re.finditer(r"学分:\d+(?:\.\d+)?", name))
        if cuts:
            name = name[cuts[-1].end():].strip()
    if not name or "/" in name or ":" in name:
        return ""
    return name


def split_courses(cell_text):
    """把一个格子里的文字拆成一门一门课。坏掉的一条跳过,绝不中断整份导入。

    每门课的标准长相:
      课名★(节次)周次/校区/场地/教师/考核方式/课程学时组成/周学时/总学时/学分
    PDF 换行会乱切文字,先去掉所有换行再处理;学分是属性段的最后一项。
    """
    flat = str(cell_text).replace("\n", "")
    courses = []
    pos = 0
    while True:
        m, ch = _first_marker(flat[pos:])
        if m == -1:
            break
        marker_abs = pos + m
        name = _clean_course_name(flat[pos:marker_abs])
        if not name:  # 认不出课名,跳过这条,继续往后找
            pos = marker_abs + 1
            continue
        pos = marker_abs + 1  # 跳过标记,开始看属性

        m2, _ = _first_marker(flat[pos:])
        body_end = pos + m2 if m2 != -1 else len(flat)
        body = flat[pos:body_end]
        credit_end = _find_credit_end(body)
        attrs = body[:credit_end]
        pos = pos + credit_end  # 学分结束处 = 下一门课名字的起点

        record = {
            "课名": name,
            "类型": KIND_BY_MARK.get(ch, ch),
            "节次": "", "周次原文": "", "周次": [],
            "校区": "", "教室": "", "教师": "",
            "考核方式": "", "学时组成": "", "周学时": "", "总学时": "", "学分": "",
        }
        try:
            tokens = attrs.split("/")
            t0 = tokens[0] if tokens else ""
            ppm = re.search(r"\((\d+)(?:-(\d+))?节\)", t0)
            if ppm:
                sp = int(ppm.group(1))
                ep = int(ppm.group(2)) if ppm.group(2) else sp
                record["节次"] = f"{sp}-{ep}节" if sp != ep else f"{sp}节"
                weeks_raw = t0[ppm.end():]  # 节次括号后面紧跟周次(可能 1-8周,10-17周)
                if weeks_raw:
                    record["周次原文"] = weeks_raw
                record["周次"] = expand_weeks(weeks_raw)
            for token in tokens[1:]:
                if ":" in token:
                    key, value = token.split(":", 1)
                    if key == "校区":
                        record["校区"] = value
                    elif key == "场地":
                        record["教室"] = value
                    elif key == "教师":
                        record["教师"] = value
                    elif key == "考核方式":
                        record["考核方式"] = value
                    elif key == "课程学时组成":
                        record["学时组成"] = value
                    elif key == "周学时":
                        record["周学时"] = value
                    elif key == "总学时":
                        record["总学时"] = value
                    elif key == "学分":
                        record["学分"] = value
        except Exception:
            pass  # 单条字段解析出错就放弃字段,仍保留课名
        courses.append(record)
    return courses
