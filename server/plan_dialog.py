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
  scene=dialog   D 批 D2：排程模式下的对话管理器——读前端递来的对话状态（topic/missStreak），
                 从 8 个 act 白名单里选下一步动作；前端 validateDialogAct 再验一层，
                 candidate_idx 必须真的在候选清单里（防编造）

响应契约（HTTP 恒 200，失败一律 {ok:false}，前端视作「走规则兜底」不算错误）：
  { ok: true, action?, intent?, patch?, answers?, act?, args?, reply_note?, confidence }
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
# D 批 D2：dialog 场景要输出 act+args+话术，预算单独放宽（per-scene 拆分）
DIALOG_MAX_TOKENS = 400

router = APIRouter()

INTENTS = ("create", "replace", "reschedule", "cancel", "query", "add_deadline", "hold")

# D 批 D2：dialog 场景的 act 白名单（与前端 dialogManager.ts 的 DIALOG_ACTS 同源）
DIALOG_ACTS = (
    "ask_slot", "pick_candidate", "confirm_draft", "discard_topic",
    "resume_topic", "new_intent", "negotiate_block", "chit_chat",
)
ASKABLE_SLOTS = ("title", "when", "effort", "target")
NEGOTIATE_OPTIONS = ("swap_block", "move_next_week", "reduce_scope", "give_time")
PICK_KINDS = ("cancel", "reschedule", "replace")

# 槽位定义表（system prompt 用）。口径与 src/features/libao/libaoIntent.ts 一致：
# 抽不到就缺省，禁止编造；不确定给低 confidence（纪律②「抽不到就说抽不到」）。
_SLOT_SPEC = """槽位定义（只输出 JSON，抽不到的槽位直接省略，禁止编造）：
- title: 事情的名字（如「数学建模备赛」「学生会面试」「高数复习」）
- when_text: 时间原话片段，照抄用户的话（如「十月中旬」「周五下午」「明天」）
- month / day: 明确说到几月几日时给数字（month 1-12, day 1-31）
- relativeDays: 相对天数（今天=0 明天=1 后天=2 大后天=3）
- relativeWeeks: 相对周数（这周=0 下周=1）
- weekday: 星期几（周一=1 … 周日=7）
- weekNo: 学期周次（「第10周」=10；「第10周周五」= weekNo 10 + weekday 5）
- perWeekCount: 每周几次（「每天」=7；「隔天/每两天」≈每周3-4次，按 4 记）
- durationMin: 单次时长（分钟）（「每次2小时」=120；「6点到7点」这种回答时长的说法=60；
  **裸时长优先归单次**：「出去玩一小时」「排90分钟」=60/90 —— 只有带「一共/总共/要花/投入」才是总投入）
- totalHours: 总投入（小时）（必须带总量词才记：「一共20小时」=20；裸「10小时」不得记这里）
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

# D 批 D2：dialog 场景的对话管理器骨架。act 表逐条 + 状态读法 + 防编造三约束
# + 「决策权在用户」—— confirm 只在用户明确同意时输出（L4 边界）。
_SYSTEM_DIALOG = """你是排程助手「梨宝」的**对话管理器**：用户正处于排程会话里，前端把当前对话状态（topic）递给你，你只做一件事——为这句话选下一个动作（act），不执行、不编造。

act 白名单（只能从中选一个）：
- ask_slot        还缺信息 → args.slot 取 title/when/effort/target 之一，追问它
- pick_candidate  用户在候选里挑定了一个 → args.candidate_idx 取候选清单里的 idx（整数）
- confirm_draft   用户明确同意当前草稿 → 无 args
- discard_topic   用户明确不要了/放弃 → 无 args
- resume_topic    用户要回到之前没排成的那件事 → 无 args
- new_intent      用户提出（或改口为）一个新的排程诉求 → args.intent 取 create/replace/reschedule/cancel/query/add_deadline/hold 之一，args.patch 放听到的槽位
- negotiate_block 排程被既有块挡住，用户在协商 → args.option 取 swap_block/move_next_week/reduce_scope/give_time 之一
- chit_chat       闲聊或校园问答（与排程无关）→ 无 args；**此时议题保留，不要丢弃 topic**

D7 协商方案：blocked 状态的 blocking.options 列出**引擎干跑过、真排得上**的编号方案（id+label）。
用户按编号/说法选中其中一个 → new_intent + args.replan_id 取该方案的 id（**照抄，不要改写**），
不要自己编 patch。

状态读法：
- topic.phase：collect=等用户补信息；picking=候选清单在等用户挑；draft=草稿在等确认；blocked=排不进去（blocking.blocks 列出挡路的既有块）
- candidates / blocking.blocks 里的 **idx 与 title 是唯一可信引用**：用户说「第一个/周三那个」就对到清单上
- **相对日期指代必须换算**：候选/阻塞块的 hint 带「周X(M.D)」日期，用户的「今天/明天/后天/周几」
  先按「今天」（payload 里已附星期）换算成具体 M.D，再到 hint 里对号 —— 对上了就是 pick_candidate，
  不许因为「清单里没出现『明天』两个字」就说找不到
- prior_failed_title 存在 = 之前有一件没排成的事，用户说「还是刚才那个」→ resume_topic

防编造三约束（违反任何一条都会被系统拦截、整轮作废）：
1. candidate_idx 只能取候选清单里**真实存在**的 idx；清单对不上就 ask_slot 重列，绝不猜编号
2. title/引用一律照抄清单或用户原话，不要改写、不要发明
3. 拿不准就选 ask_slot 或 chit_chat，并把 confidence 给低（<0.5）

决策权在用户：confirm_draft **只在用户明确同意**（好/行/可以/就这么排这类整句认可）时输出；
犹豫、反问、讨价还价都不是同意。

易混边界（按此判定，不要猜）：
- 用户说的**编号/指代在候选清单里找不到**（「第四个」但只有 2 个候选、「上周的」不在本周清单）
  → 一律 ask_slot（重列候选），绝不硬凑清单里的 idx
- 用户对当前草稿**犹豫**（「再想想」「让我想想」「好不好嘛」）→ ask_slot（重列草稿要点），
  不是 confirm 也不是 discard
- 「先别管这个，回到/继续刚才那件没排成的事」「就按之前说的办」→ resume_topic
- 「把X替换成Y」「把操场跑步替换掉」是**明确的新诉求** → new_intent（intent=replace）；
  negotiate_block 只用于开放式协商（「那怎么办」「换个方案吧」）且 phase=blocked
- 没有草稿在场（phase 不是 draft）时，用户说「好/对/按你说的办」**没有可确认的对象**
  → ask_slot 问清楚，绝不 confirm_draft
- chit_chat 只用于与当前排程议题**完全无关**的问答/闲聊；与议题有关的含糊回答用 ask_slot

只输出 JSON，不要输出别的。"""


class UnderstandReq(BaseModel):
    scene: Literal["intent", "answer", "dialog"]
    q: str = Field(min_length=1, max_length=500)
    asked: Optional[List[str]] = None          # scene=answer：已问槽位（"slot: 话术" 形式）
    slots: Optional[dict] = None               # scene=intent：规则层已抽到的槽位（LLM 只补空）
    today: Optional[str] = None                # ISO，供相对时间语义锚定
    history: Optional[List[str]] = None        # 最近 ≤4 条「角色:文本」，防指代断裂
    state: Optional[dict] = None               # scene=dialog：{topic, missStreak}（前端白名单序列化）


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
    n = _num(patch.get("weekNo"))
    if n is not None and 1 <= n <= 30:
        out["weekNo"] = int(n)
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


def _chat(system, user, max_tokens: int = UNDERSTAND_MAX_TOKENS):
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
            "max_tokens": max_tokens,
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


def _clean_dialog(data, state):
    """dialog 场景响应白名单：act 枚举 + args 防御 + 与 state 对账（防编造）。

    返回 None = 整轮不可信（调用方回 ok:false，前端走规则兜底）。
    candidate_idx 的存在性校验在这里做（后端第一层），前端 validateDialogAct 再验一层。
    """
    if not isinstance(data, dict):
        return None
    act = data.get("act")
    if act not in DIALOG_ACTS:
        return None
    args = data.get("args") or {}
    if not isinstance(args, dict):
        args = {}
    out_args = {}

    topic = (state or {}).get("topic") if isinstance(state, dict) else None
    candidates = (topic or {}).get("candidates") if isinstance(topic, dict) else None
    cand_idx_set = None
    if isinstance(candidates, list):
        cand_idx_set = {c.get("idx") for c in candidates if isinstance(c, dict)}

    # 状态对账（D2 补强）：act 与对话状态不符 = 模型没读懂状态 → 整轮作废。
    # （前端 validateDialogAct 同款规则；后端先拦一道，省一次无效执行。）
    if act == "confirm_draft" and not (
        isinstance(topic, dict) and topic.get("phase") == "draft" and topic.get("draft_key") is not None
    ):
        return None
    if act == "resume_topic" and not (isinstance(topic, dict) and topic.get("prior_failed_title")):
        return None
    if act == "negotiate_block" and not (isinstance(topic, dict) and topic.get("blocking")):
        return None
    if act == "pick_candidate" and isinstance(topic, dict) and topic.get("phase") != "picking":
        return None

    if act == "ask_slot":
        slot = args.get("slot")
        if slot not in ASKABLE_SLOTS:
            return None
        out_args["slot"] = slot
    elif act == "pick_candidate":
        idx = _num(args.get("candidate_idx"))
        if idx is not None:
            idx = int(idx)
            # 防编造：state 里带候选清单就必须对得上；没带清单则留给前端验
            if cand_idx_set is not None and idx not in cand_idx_set:
                return None
            out_args["candidate_idx"] = idx
        tt = args.get("target_text")
        if isinstance(tt, str) and tt.strip():
            out_args["target_text"] = tt.strip()[:60]
        if not out_args:
            return None
        pk = args.get("pick_kind")
        if pk in PICK_KINDS:
            out_args["pick_kind"] = pk
    elif act == "negotiate_block":
        opt = args.get("option")
        if opt not in NEGOTIATE_OPTIONS:
            return None
        out_args["option"] = opt
    elif act == "new_intent":
        intent = args.get("intent")
        if intent not in INTENTS:
            return None
        out_args["intent"] = intent
        patch = _clean_patch(args.get("patch") or {})
        if patch:
            out_args["patch"] = patch
        # D7：用户选中协商方案（blocking.options 里的 id，LLM 照抄）
        rid = args.get("replan_id")
        if isinstance(rid, str) and rid.strip():
            out_args["replan_id"] = rid.strip()[:60]
    # confirm_draft / discard_topic / resume_topic / chit_chat：无 args

    note = data.get("reply_note")
    note = note.strip()[:80] if isinstance(note, str) else ""
    conf = _num(data.get("confidence"))
    conf = float(conf) if conf is not None else 0.5
    return {
        "act": act,
        "args": out_args,
        "reply_note": note,
        "confidence": max(0.0, min(1.0, conf)),
    }


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

        # ── D 批 D2：dialog —— 排程会话的对话管理器（act 白名单 + 防编造） ──
        # 放在 answer 之前：dialog 不带 asked，先走会被 no_asked 守卫拦死。
        if req.scene == "dialog":
            # 防御性收敛状态与历史：历史 ≤6 条 × 80 字，状态体 ≤4KB（前端已白名单，这里兜底）
            hist = []
            for h in (req.history or [])[-6:]:
                if isinstance(h, str) and h.strip():
                    hist.append(h.strip()[:80])
            state = req.state if isinstance(req.state, dict) else {}
            try:
                if len(json.dumps(state, ensure_ascii=False).encode("utf-8")) > 4096:
                    state = {"topic": None, "missStreak": state.get("missStreak", 0)}
            except (TypeError, ValueError):
                state = {"topic": None, "missStreak": 0}
            today = req.today or ""
            _WD = "一二三四五六日"
            try:
                from datetime import date as _date
                _d = _date.fromisoformat(today)
                today = f"{today}（星期{_WD[_d.weekday()]}）"
            except ValueError:
                pass
            user = json.dumps({
                "今天": today,
                "当前对话状态": state,
                "最近对话": hist,
                "用户的话": req.q,
                "任务": "按 system 里的 act 白名单，为这句话选下一个动作。reply_note 用一句 ≤80 字的话说明你要做什么（梨宝口吻）。",
                "输出格式": '{"act": "...", "args": {...}, "reply_note": "≤80字", "confidence": 0到1}',
            }, ensure_ascii=False)
            data = _parse_json(_chat(_SYSTEM_DIALOG, user, max_tokens=DIALOG_MAX_TOKENS))
            cleaned = _clean_dialog(data, state)
            if cleaned is None:
                # 模型输出不可信（act 出白名单 / 编造 idx / args 非法）→ 整轮作废，前端走规则兜底
                return {"ok": False, "reason": "dialog_act_rejected",
                        "elapsed_ms": int((time.time() - t0) * 1000)}
            return {"ok": True, **cleaned, "elapsed_ms": int((time.time() - t0) * 1000)}

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
