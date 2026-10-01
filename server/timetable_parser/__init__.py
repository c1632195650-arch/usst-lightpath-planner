# timetable_parser/__init__.py
# 课表识别公共包:导入本包即得到 parse_pdf / split_courses / expand_weeks

from .course_text import expand_weeks, split_courses
from .parse import parse_pdf

__version__ = "1.0.0"

__all__ = ["parse_pdf", "split_courses", "expand_weeks", "__version__"]
