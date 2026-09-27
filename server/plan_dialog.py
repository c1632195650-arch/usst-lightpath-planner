# -*- coding: utf-8 -*-
"""
梨宝 · 排程对话理解端点（S 批 S3 · /api/plan/understand）
==========================================================
P3 的病灶：`libaoIntent.ts` 的 LlmExtractor 接口和 mergeSlots（规则字段不被
LLM 覆盖）早就写好了，但从未接线 —— 意图判定 100% 靠词表/正则，「我周五下午
要在学生会面试」这种无关键词陈述句全靠正则硬扛。

本端点把 LLM 理解接上（LLM 优先、规则兜底是前端纪律①，这里只负责「听懂」）：

  scene=intent   新句子判动作：是否要动日程 + intent 枚举 + 槽位 patch
  scene=answer   追问应答抽槽：把用户回复按 asked 清单定位成「槽位 → 原话片段」
                 （片段仍由前端规则抽取器结构化 —— LLM 只做语义定位，可审计）

响应契约（HTTP 恒 200，失败一律 {ok:false}，前端视作「走规则兜底」不算错误）：
  { ok: true, action?, intent?, patch?, answers?, confidence }
  { ok: false, reason }

环境变量沿用 app.py 同一套：LLM_BASE_URL / LLM_API_KEY / LLM_MODEL。
Key 只从环境变量读（app.py 已 _load_env server/.env），任何 Key 不进仓库/日志。
"""
import json
import os
import re
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import requests
from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import List, Literal, Optional

_HERE = os.path.dirname(os.path.abspath(__file__))
# 独立跑（python -m server.plan_dialog / 评测脚本直连）时也 能拿到 Key
if not os.environ.get("LLM_API_KEY"):
    try:
        with open(os.path.join(_HERE, ".env"), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())
    except OSError:
        pass

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.deepseek.com/v1").rstrip("/")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "deepseek-chat")

UNDERSTAND_TIMEOUT = float(os.environ.get("PLAN_UNDERSTAND_TIMEOUT", "8"))
UNDERSTAND_MAX_TOKENS = 300

router = APIRouter()

INTENTS = ("create", "replace", "reschedule", "cancel", "query", "add_deadline", "hold")

# 槽位定义表（system prompt 用）。口径与 src/features/libao/libaoIntent.ts 一致：
# 抽不到就缺省，禁止编造；不确定给低 confidence（纪律②「抽不到就说抽不到」）。
_SLOT_SPEC = """槽位定义（只输出 JSON，抽不到的槽位直接省略，禁止编造）：
- title: 事情的名字（如「数学建模备赛」「学生会面试」「高数复习」）
- when_text: 时间原话片段，照抄用户的话（如「十月中旬」「周五下午」「明天」）
- month / day: 明确说到几月几日时给数字（month 1-12, day 1-31）
- relativeDays: 相对天数（今天=0 明天=1 后天=2 大后天=3）
- relativeWeeks: 相对周数（这周=0 下周=1）
- weekday: 星期几（周一=1 … 周日=7）
- perWeekCount: 每周几次（「每天」=7；「隔天/每两天」≈每周3-4次，按 4 记）
- durationMin: 单次时长（分钟）（「每次2小时」=120；「6点到7点」这种回答时长的说法=60）
- totalHours: 总投入（小时）（「一共20小时」=20）
- place: 地点（如「图书馆」）
- window_text: 时段窗原话（如「晚上」「下午」「18点之后」）
- targetHint: 要动的既有事项名（改期/取消/替换的对象）"""

_SYSTEM_BASE = (
    "你是日程排程助手「梨宝」的理解层。用户的话可能是要安排日程，也可能只是闲聊或提问。"
    + _SLOT_SPEC
    + "\n规则：你是**第一理解层**，独立判断这句话的意思；规则层（关键词/正则）先跑过一遍，"
    "但它的词表不可能穷尽口语 —— 它的输出仅供参考，可能不全也可能抽错，你可以给出它没抽到"
    "或需要修正的槽位。禁止编造用户没说的内容；不确定就必须给低 confidence（<0.5）；只输出 JSON，不要输出别的。"
)


class UnderstandReq(BaseModel):
    scene: Literal["intent", "answer"]
    q: str = Field(min_length=1, max_length=500)
    asked: Optional[List[str]] = None          # scene=answer：已问槽位（"slot: 话术" 形式）
    slots: Optional[dict] = None               # scene=intent：规则层已抽到的槽位（LLM 只补空）
    today: Optional[str] = None                # ISO，供相对时间语义锚定
    history: Optional[List[str]] = None        # 最近 ≤4 条「角色:文本」，防指代断裂


def _num(v):
    """LLM 给的数字一律防御性转换；非法 → None（宁缺勿错）。"""
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
        return int(f) if f == int(f) else f
    except (TypeError, ValueError):
        return None


def _clamp(v, lo, hi):
    if v is None:
        return None
    return int(max(lo, min(hi, v)))


def _clean_patch(patch):
    """patch 白名单 + 数值防御：LLM 输出不可信，只放行认得的槽位与合法数值。"""
    if not isinstance(patch, dict):
        return {}
    out = {}
    for k in ("title", "when_text", "place", "window_text", "targetHint"):
        v = patch.get(k)
        if isinstance(v, str) and v.strip():
            out[k] = v.strip()[:60]
    n = _num(patch.get("month"))
    if n is not None and 1 <= n <= 12:
        out["month"] = int(n)
    n = _num(patch.get("day"))
    if n is not None and 1 <= n <= 31:
        out["day"] = int(n)
    n = _num(patch.get("relativeDays"))
    if n is not None and 0 <= n <= 60:
        out["relativeDays"] = int(n)
    n = _num(patch.get("relativeWeeks"))
    if n is not None and 0 <= n <= 12:
        out["relativeWeeks"] = int(n)
    n = _num(patch.get("weekday"))
    if n is not None and 1 <= n <= 7:
        out["weekday"] = int(n)
    n = _num(patch.get("perWeekCount"))
    if n is not None and 1 <= n <= 7:
        out["perWeekCount"] = int(n)
    n = _num(patch.get("durationMin"))
    if n is not None and 5 <= n <= 12 * 60:
        out["durationMin"] = int(n)
    n = _num(patch.get("totalHours"))
    if n is not None and 0 < n <= 2000:
        out["totalHours"] = n
    return out


def _clean_answers(answers, asked_keys):
    """answers 白名单 = 全部槽位键（T 批：asked 只是提示，用户答了别的槽位也要收）；
    值必须是原话片段（≤80 字）。"""
    if not isinstance(answers, dict):
        return {}
    allowed = ("title", "when", "effort", "target")
    out = {}
    for k in allowed:
        v = answers.get(k)
        if isinstance(v, str) and v.strip():
            out[k] = v.strip()[:80]
    return out


def _chat(system, user):
    """DeepSeek 调用。8s 超时；任何异常上抛由调用方转 ok:false。"""
    r = requests.post(
        f"{LLM_BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"},
        json={
            "model": LLM_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.1,
            "max_tokens": UNDERSTAND_MAX_TOKENS,
            "response_format": {"type": "json_object"},
        },
        timeout=UNDERSTAND_TIMEOUT,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def _parse_json(content):
    """宽容解析：剥 ```json 围栏 / 抠第一个 {...}。失败抛 ValueError。"""
    text = (content or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, flags=re.S)
        if m:
            return json.loads(m.group(0))
        raise


@router.post("/api/plan/understand")
def plan_understand(req: UnderstandReq):
    t0 = time.time()
    if not LLM_API_KEY:
        return {"ok": False, "reason": "no_key"}
    try:
        asked_keys = []
        asked_lines = []
        for item in (req.asked or [])[:4]:
            if isinstance(item, str) and ":" in item:
                k, text = item.split(":", 1)
                k = k.strip()
                if k in ("title", "when", "effort", "target"):
                    asked_keys.append(k)
                    asked_lines.append(f"- {k}: {text.strip()[:80]}")

        if req.scene == "intent":
            user = json.dumps({
                "今天": req.today,
                "规则层已抽到的槽位（仅供参考，可能不全或抽错）": req.slots or {},
                "最近对话（可能有指代，排程会话刚被打断时靠它接续）": (req.history or [])[-4:],
                "用户的话": req.q,
                "任务": "判断这句话是否要动日程（action）。要动日程包括：要排/要加/要改/要取消/要替换某件事、要记截止日、要把某段时间留空别排、以及问自己日程忙闲（query）。"
                    "注意：用户只报时间/时段（如「周二晚上；6点到7点」）而最近对话里正有一件待定安排时，这是在**续答**，算 action=true。"
                    "纯问信息、求建议、闲聊 → action=false。",
                "输出格式": '{"action": true/false, "intent": "create|replace|reschedule|cancel|query|add_deadline|hold", "patch": {槽位...}, "confidence": 0到1}（patch 只放抽到的槽位，抽不到就省略该键）',
            }, ensure_ascii=False)
            data = _parse_json(_chat(_SYSTEM_BASE, user))
            patch = _clean_patch(data.get("patch") or {})
            intent = data.get("intent")
            if intent not in INTENTS:
                intent = None
            conf = _num(data.get("confidence"))
            return {
                "ok": True,
                "action": bool(data.get("action")),
                "intent": intent,
                "patch": patch,
                "confidence": float(conf) if conf is not None else 0.5,
                "elapsed_ms": int((time.time() - t0) * 1000),
            }

        # scene=answer：把回复按 asked 定位成「槽位 → 原话片段」
        if not asked_keys:
            return {"ok": False, "reason": "no_asked"}
        user = json.dumps({
            "问过的问题（槽位: 话术）": asked_lines,
            "最近对话（可能有指代）": (req.history or [])[-4:],
            "用户的回答": req.q,
            "任务": "把回答拆到对应的槽位，值为**原话片段**（照抄，不要改写）。注意：问过的问题是**提示**，"
                "不是过滤器 —— 回答里出现的**任何**槽位信息都要归位，即使不是被问的那一项"
                "（比如问的是投入多少、用户答了「周二晚上」，时间也要输出到 when）。"
                "「还没定/待定/到时候再说」这类回答也是有效回答，照抄归到对应槽位。"
                "回答里可能用分号/编号分隔多段，按位置或语义对应。完全与槽位无关的内容不要输出。",
            "输出格式": '{"answers": {"槽位": "原话片段", ...}, "confidence": 0到1}（answers 键只能取 title/when/effort/target）',
        }, ensure_ascii=False)
        data = _parse_json(_chat(_SYSTEM_BASE, user))
        answers = _clean_answers(data.get("answers") or {}, asked_keys)
        conf = _num(data.get("confidence"))
        return {
            "ok": True,
            "answers": answers,
            "confidence": float(conf) if conf is not None else 0.5,
            "elapsed_ms": int((time.time() - t0) * 1000),
        }
    except requests.Timeout:
        return {"ok": False, "reason": "timeout"}
    except Exception as e:  # 任何失败都不算错误 —— 前端走规则兜底
        return {"ok": False, "reason": f"{type(e).__name__}: {e}"[:160]}


if __name__ == "__main__":
    # 冒烟：python server/plan_dialog.py「我周五下午要在学生会面试」
    import uvicorn
    print("本模块是路由库，由 server/app.py include_router 挂载；直跑只做自检。")
    print("LLM_API_KEY 已配置：" + ("是" if LLM_API_KEY else "否（端点将恒回 ok:false/no_key）"))
