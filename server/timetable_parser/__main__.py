# timetable_parser/__main__.py
# 命令行入口:
#   python -m timetable_parser dump  <课表.pdf>           按 页-行-列 打印全部格子(检查点①)
#   python -m timetable_parser parse <课表.pdf> [out.json]  解析成一门课一条记录(检查点②)
#   python -m timetable_parser --help

import json
import sys

from .course_text import expand_weeks  # noqa: F401  (供命令行自检/调试)
from .parse import parse_pdf
from .pdf_table import iter_pages_tables

USAGE = """用法:
  python -m timetable_parser dump  <课表.pdf>                 # 打印 PDF 里所有表格格子
  python -m timetable_parser parse <课表.pdf> [输出.json]     # 解析为结构化课程记录
示例:
  python -m timetable_parser parse data/课表.pdf course_records.json
"""


def cmd_dump(pdf_path):
    """打印每个表格的全部格子(原样,含 None/空格)"""
    found = False
    for page_no, table_no, table in iter_pages_tables(pdf_path):
        found = True
        print(f"==== 第 {page_no} 页 的第 {table_no} 个表格 ====")
        for row_no, row in enumerate(table, start=1):
            for col_no, cell in enumerate(row, start=1):
                print(f"第 {page_no} 页 | 行 {row_no} | 列 {col_no} :")
                print(cell)
                print()
    if not found:
        raise ValueError("这个 PDF 里没有表格,可能不是可解析的课表")


def cmd_parse(pdf_path, out_path=None):
    records = parse_pdf(pdf_path)
    print(f"共解析出 {len(records)} 条课程记录:\n")
    for r in records:
        head = f"[{r['星期']}] 第{r['节次']}"
        if r["周次原文"]:
            head += f" | {r['周次原文']}"
        print(f"{head} | {r['课名']}({r['类型']}) | {r['教师']} | {r['教室']} | 学分{r['学分']}")
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(records, f, ensure_ascii=False, indent=2)
        print(f"\n已保存到 {out_path}")
    return records


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(USAGE)
        return 0
    cmd = argv[0]
    if cmd == "dump" and len(argv) == 2:
        cmd_dump(argv[1])
        return 0
    if cmd == "parse" and 2 <= len(argv) <= 3:
        cmd_parse(argv[1], argv[2] if len(argv) == 3 else None)
        return 0
    print(USAGE)
    return 1


if __name__ == "__main__":
    sys.exit(main())
