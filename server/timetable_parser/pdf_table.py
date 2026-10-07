# timetable_parser/pdf_table.py
# 负责从 PDF 里取出"表头星期列"与"内容格子块",并处理跨页截断(依赖 pdfplumber)

import pdfplumber

from .constants import DAY_ALIAS, MIN_DAY_COLUMNS


def iter_pages_tables(pdf_path):
    """逐页逐表产出 (页号, 表序号, 表数据);页号从 1 开始"""
    with pdfplumber.open(pdf_path) as pdf:
        for page_index, page in enumerate(pdf.pages, start=1):
            tables = page.extract_tables() or []
            for table_index, table in enumerate(tables, start=1):
                yield page_index, table_index, table


def find_day_columns(rows):
    """在若干行里找表头:某一行同时出现 星期一~星期日,返回 {列号: 标准星期名}"""
    for row in rows:
        mapping = {}
        for ci, cell in enumerate(row or []):
            t = str(cell).strip() if cell is not None else ""
            if t in DAY_ALIAS:
                mapping[ci] = DAY_ALIAS[t]
        if "星期一" in mapping.values() and len(mapping) >= MIN_DAY_COLUMNS:
            return mapping
    return None


def collect_day_blocks(tables):
    """给定所有表格,返回内容格子块列表 [{col, day, text}]。
    规则:带节次号的格子是新内容;没有节次号但有星期内容的行,视为上一格被截断的尾巴并拼接。"""
    daycols = None
    blocks = []
    last = {}  # 列号 -> blocks 下标(该列最近一格,用于跨页拼接)

    for table in tables:
        if daycols is None:
            daycols = find_day_columns(table)
        for row in table:
            if not row:
                continue
            col1 = str(row[1]).strip() if len(row) > 1 and row[1] is not None else ""
            day_texts = {}
            headerish = col1 == "节次"
            if daycols:
                for ci, day in daycols.items():
                    cell = row[ci] if ci < len(row) else None
                    if cell is None:
                        continue
                    txt = str(cell)
                    if txt.strip() == "":
                        continue
                    if txt.strip() in DAY_ALIAS:  # 表头重复出现时跳过
                        headerish = True
                        continue
                    day_texts[ci] = txt
            if headerish:
                if daycols is None:
                    daycols = find_day_columns(table)  # 本行可能正是表头
                continue
            if not day_texts:
                continue
            is_start = col1.isdigit()  # 有节次号 = 新的一行内容
            for ci, txt in day_texts.items():
                if is_start or ci not in last:
                    blocks.append({"col": ci, "day": daycols[ci], "text": txt})
                    last[ci] = len(blocks) - 1
                else:
                    blocks[last[ci]]["text"] += txt  # 拼回被截断的尾巴
    return blocks, daycols
