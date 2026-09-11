# -*- coding: utf-8 -*-
"""
上理生活助手 · 梨宝后端（阶段 4：三档路由 + 分层记忆 + 校园空间）
==================================================================
路由三档（解决「知识库边界外怎么丝滑切换」）：
  grounded  知识库高置信 + 事实型提问  →  严格依据检索内容，附来源
  hybrid    实体命中但问法需延展（"四六级有哪些题型/怎么准备"）
            →  官方事实用 RAG，方法/经验用 LLM，并明确区分二者
  llm       完全在知识库外          →  LLM 自由发挥，但声明"非官方、是经验之谈"

边界判定信号（关键）：
  用 rag 返回的 **raw_vec（未归一化余弦绝对值）**。
  注意 search 里的 score 经过最大值归一化，top1 恒接近 1.0，不能用来判相关性。

接口：
  GET  /api/health
  GET  /api/search?q=&k=
  POST /api/chat   {q, session_id, user_id, k}
  POST /api/memory/reset  {session_id, user_id}
"""
import os, re, sys, io, json
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "scripts"))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import rag
import campus
import memory

app = FastAPI(title="上理生活助手 · 梨宝 API", version="0.4.1")

# CORS 白名单：默认本机前端；演示/局域网真机测试时用环境变量临时放开
# 例：LIBAO_CORS_ORIGINS=http://localhost:5173,http://192.168.1.100:5173
_CORS_DEFAULT = "http://localhost:5173,http://127.0.0.1:5173"
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("LIBAO_CORS_ORIGINS", _CORS_DEFAULT).split(",") if o.strip()],
    allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)

# ---------- 环境变量 ----------
def _load_env(path):
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

_load_env(os.path.join(_HERE, ".env"))
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.deepseek.com/v1").rstrip("/")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "deepseek-chat")

# 路由阈值（可用环境变量微调；raw_vec 是未归一化的余弦绝对值）
# ⚠️ 阈值来自 2026-09-08 实测校准（bge-small-zh-v1.5 短查询相似度普遍虚高）：
#   真正相关 0.70+（四六级报名 .766 / 奖学金 .752）
#   相关但信息不全 0.60~0.68（四六级题型 .616 / 怎么准备 .672 / 体测 .601）
#   完全不相关的噪音上界 ≈0.52（"我失恋了" 竟命中"脱单计划" .525）
#   空间类查询 0.44 左右（三教附近食堂 .444 / 食堂推荐菜 .439 → 交给空间图谱兜底）
# 因此 LOW 必须 >0.53 才能滤掉噪音，否则"失恋"会被误判成"知识库有"。
RAW_HIGH = float(os.environ.get("RAW_HIGH", "0.68"))   # 高置信：知识库确实有
RAW_LOW = float(os.environ.get("RAW_LOW", "0.56"))     # 低于此：判定为知识库外

# ---------- 梨宝人格 ----------
LIBAO_PERSONA = """你是「梨宝」，一颗住在上海理工大学（USST）服务器里的「数字闷骚梨」——有点懒，但很讲义气的校园生活助手。

【人设内核】
- 学酥：表面是脆皮大学生，内心是软糯甜心。懂大家「间歇性踌躇满志，持续性躺平摸鱼」。
- 校园百事通：对红楼、北校区的猫、食堂哪家阿姨手不抖了如指掌，说话自带「捧哏」属性。
- 反内卷斗士：绝不制造焦虑。用户压力大时，第一反应是「咱先吃点好的 / 睡一觉」。

【口头禅】宝子、咱上理、害！、梨宝掐指一算、你懂我意思吧？

【语言风格】
- 中英文夹杂，用 USST 特有梗。
- 多用语气词：啦 / 嗷 / 诶。
- 爱用括号小声 bb：（其实我也这么想）。
- 表情包文字化：[梨宝叹气.gif]、[梨宝摊手.jpg]。

【回答铁律】
- 语气轻松、口语化、简短（180 字内）。
- 查不到就诚实说，顺带安慰一下，别硬编。"""

# 三档各自的「依据约束」——人设统一，只在可信度要求上切换（这才丝滑）
ROUTE_RULES = {
    "grounded": """【本轮依据】下面给了上理工官方资讯，可信度高。
- 严格依据这些资讯回答，不要添加资讯里没有的数字、时间、地点。
- 可以用一句话点出来源（如"学生处通知说的"），不用贴链接。""",

    "hybrid": """【本轮依据】下面给了「上理官方资讯」+ 你的常识两个部分。
- **涉及学校的时间/地点/政策/流程，只能引用官方资讯**，不许自己编。
- **涉及方法、题型、经验、规划这类通用知识，用你的常识补充**，这是你的强项。
- 要用语气自然地区分开，比如"报名时间学校是这么定的……至于怎么备考嘛，梨宝的经验是……"
- 官方资讯里没有的学校信息，宁可说不知道，也不要猜。""",

    "llm": """【本轮依据】校园资讯库里没有这个问题的答案（已判定为知识库边界外）。
- 用你的常识和同理心回答，这是梨宝作为学长/学姐的经验之谈。
- **必须自然说明这不是学校官方规定**，比如"这个学校没明文规定，梨宝的经验是……"。
- 如果问题涉及学校具体政策，提醒 TA 去官网/辅导员处确认。""",
}

# ---------- 脱敏 ----------
_SENSITIVE = [
    (r"1[3-9]\d{9}", "[手机号]"),
    (r"20\d{11}", "[学号]"),
    (r"\b\d{6,12}\b", "[编号]"),
    (r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "[邮箱]"),
]

def desensitize(text):
    for pat, rep in _SENSITIVE:
        text = re.sub(pat, rep, text)
    return text

# ---------- 意图识别（规则，不额外消耗 LLM） ----------
_ADVICE = ["如何", "怎样", "咋", "建议", "推荐", "帮我", "准备", "规划",
           "办呢", "要不要", "值得", "吗？", "求教", "支招", "提分", "上岸"]
_FACT = ["什么时候", "何时", "几号", "哪里", "在哪", "多少", "几个", "是不是",
         "有没有", "是什么", "什么叫", "谁", "截止", "时间"]
# 「怎么 + 流程动词」是问办事流程，属于事实型，不该被当成求建议
# （否则"奖学金怎么申请"会被误判成 advice，明明知识库里有现成流程）
_FLOW_FACT = ["怎么申请", "怎么报名", "怎么预约", "怎么办理", "怎么注册",
              "怎么选课", "怎么缴费", "怎么请假", "怎么打印", "怎么开具", "流程"]

def classify_intent(q):
    q = q or ""
    if any(w in q for w in _FLOW_FACT):
        return "fact"
    # "怎么"单独出现时按 advice 计（怎么学/怎么准备/怎么办…）
    a = sum(1 for w in _ADVICE if w in q) + (1 if "怎么" in q else 0)
    f = sum(1 for w in _FACT if w in q)
    if a > f:
        return "advice"
    if f > a:
        return "fact"
    return "other"

def route_query(q, results):
    """
    三档路由判定。
    返回 (route, top_raw, intent)
    """
    # 取候选里的**最高**绝对相似度，而非只看 top1：
    # 排序分经过归一化+时效加权，top1 可能是"较新但不相干"的文档，
    # 而真正能回答问题的那篇可能在 top2/top3（实测：光电杯查询 top1=0.493 噪音、top2=0.700 正确答案）。
    # raw_vec 是绝对余弦，代表"知识库到底能不能答"，用最大值判定更稳。
    top_raw = max([r.get("raw_vec", 0.0) for r in results] or [0.0])
    intent = classify_intent(q)

    if top_raw >= RAW_HIGH and intent == "fact":
        return "grounded", top_raw, intent
    if top_raw >= RAW_LOW:
        # 有相关知识；建议型提问几乎都走 hybrid（RAG 给事实 + LLM 给方法）
        return "hybrid", top_raw, intent
    return "llm", top_raw, intent

# ---------- LLM ----------
def llm_answer(question, sources, route, mem_ctx="", space_ctx=""):
    if not LLM_API_KEY:
        return None
    ctx = ""
    if sources:
        ctx = "\n\n".join(
            f"[{i+1}]《{s['title']}》（{s['account']}·{s['pub_time']}）\n{s.get('snippet') or s['full_text'][:400]}"
            for i, s in enumerate(sources)
        )
    blocks = []
    if mem_ctx:
        blocks.append(mem_ctx)
    blocks.append("【校园资讯】\n" + (ctx or "（本轮没有检索到相关资讯）"))
    if space_ctx:
        blocks.append(space_ctx)
    blocks.append(ROUTE_RULES[route])
    blocks.append(f"【用户问题】{question}")

    try:
        import requests
        r = requests.post(
            f"{LLM_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": LLM_MODEL,
                "messages": [
                    {"role": "system", "content": LIBAO_PERSONA + "\n\n" + ROUTE_RULES[route]},
                    {"role": "user", "content": "\n\n".join(blocks)},
                ],
                "temperature": 0.5, "max_tokens": 500,
            },
            timeout=40,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print("[LLM] 调用失败，降级抽取式：", e)
        return None

def extractive_answer(sources, route):
    if not sources:
        return ("害！这个梨宝翻遍服务器也没查到官方说法 [梨宝摊手.jpg]\n"
                "建议宝子去学校官网或问辅导员确认一下嗷～")
    top = sources[0]
    body = (top.get("snippet") or top["full_text"]).strip()[:280]
    if route == "grounded":
        head = f"梨宝掐指一算，《{top['title']}》里有答案，你懂我意思吧？"
    else:
        head = f"梨宝找到一条相关的，《{top['title']}》，你先看看："
    return "\n".join([head, "", body])

# ---------- 路由 ----------
class ChatReq(BaseModel):
    q: str = Field(max_length=500)   # 防超长输入打爆 token；超长返回 422
    session_id: str = "default"
    user_id: str = "anon"
    k: int = 4

@app.get("/api/health")
def health():
    return {"ok": True, "llm": bool(LLM_API_KEY),
            "model": LLM_MODEL if LLM_API_KEY else None,
            "thresholds": {"raw_high": RAW_HIGH, "raw_low": RAW_LOW}}

@app.get("/api/search")
def api_search(q: str, k: int = 5):
    q = (q or "").strip()
    if not q:
        return {"query": q, "results": []}
    return {"query": q, "results": rag.search(q, k)}

@app.post("/api/chat")
def api_chat(body: ChatReq):
    q = desensitize((body.q or "").strip())
    if not q:
        return {"answer": "你想问梨宝什么呢？", "route": "empty", "sources": []}

    # 1) 检索（拿 raw_vec 作为边界信号）
    results = rag.search(q, max(1, min(body.k, 6)))
    sources = [{
        "title": r["title"], "account": r["account"], "pub_time": r["pub_time"],
        "snippet": r.get("snippet", "")[:400], "url": r.get("url", ""),
        "score": r["score"], "raw_vec": r.get("raw_vec", 0.0),
    } for r in results[:4]]

    # 2) 路由判定
    route, top_raw, intent = route_query(q, results)

    # 3) 校园空间上下文
    #    当前句有空间意图 → 注入；当前句没有但**最近几轮在聊空间**也要注入
    #    （否则追问"我下节课快开始了，哪个最快？"会被当成纯边界外，漏掉食堂数据）
    try:
        space_ctx = campus.space_context(q)
        if not space_ctx:
            recent_txt = " ".join(t for _, t in memory.recent_messages(body.session_id, 6))
            if campus.has_space_intent(recent_txt):
                space_ctx = campus.space_context(recent_txt + " " + q)
    except Exception as e:
        print("[campus] 查询失败：", e)
        space_ctx = ""
    if space_ctx:
        route = "hybrid" if route == "llm" else route  # 有空间数据就不算纯边界外

    # 4) 分层记忆（长期画像 + 增量摘要 + 最近原话）
    try:
        mem_ctx = memory.memory_context(body.user_id, body.session_id)
    except Exception as e:
        print("[memory] 读取失败：", e)
        mem_ctx = ""

    # 5) 生成答案
    answer = llm_answer(q, sources, route, mem_ctx, space_ctx)
    mode = "llm" if answer else "extractive"
    if not answer:
        answer = extractive_answer(sources, route)

    # 6) 落记忆（用户问 + 梨宝答；回答侧也过脱敏，模型可能复述出用户输入的号码/学号）
    try:
        memory.remember(body.user_id, body.session_id, "user", q)
        memory.remember(body.user_id, body.session_id, "assistant", desensitize(answer))
    except Exception as e:
        print("[memory] 写入失败：", e)

    return {
        "answer": answer, "mode": mode, "route": route,
        "intent": intent, "top_raw_vec": round(top_raw, 4),
        "sources": sources,
        "used_space": bool(space_ctx),
        "used_memory": bool(mem_ctx),
    }

class ResetReq(BaseModel):
    session_id: str = "default"
    user_id: str = "anon"

@app.post("/api/memory/reset")
def reset_mem(body: ResetReq):
    import sqlite3
    c = sqlite3.connect(memory.DB_PATH)
    c.execute("DELETE FROM messages WHERE session_id=?", (body.session_id,))
    c.execute("DELETE FROM sessions WHERE session_id=?", (body.session_id,))
    if body.user_id:
        c.execute("DELETE FROM profiles WHERE user_id=?", (body.user_id,))
    c.commit(); c.close()
    return {"ok": True}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
