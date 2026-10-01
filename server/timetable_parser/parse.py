# timetable_parser/parse.py
# 主流程:把课表 PDF 解析成"一门课一条记录"的完整列表

from .course_text import split_courses
from .pdf_table import collect_day_blocks, iter_pages_tables


def parse_pdf(pdf_path):
    """主入口:给定 PDF 路径,返回课程记录列表(每条已带'星期')。
    自动识别表头、逐页收集内容、拼接跨页被截断的格子。
    识别不到课表格式时抛 ValueError。"""
    tables = [table for _, _, table in iter_pages_tables(pdf_path)]
    if not tables:
        raise ValueError("这个 PDF 里没有表格,可能不是可解析的课表")

    blocks, daycols = collect_day_blocks(tables)
    if not daycols:
        raise ValueError("没找到含 星期一~星期日 的表头,请确认上传的是周课表 PDF")

    records = []
    for b in blocks:
        for course in split_courses(b["text"]):
            if not course.get("课名"):
                continue
            course["星期"] = b["day"]
            records.append(course)
    return records
