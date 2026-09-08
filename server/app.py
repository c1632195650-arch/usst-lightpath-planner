# -*- coding: utf-8 -*-
"""
上理生活助手 · 初代梨宝后端（阶段 3.1 + 3.3）
================================================
轻量 FastAPI 服务，桥接前端 React 与本地 RAG 检索（scripts/rag.py）：
  - GET  /api/health            健康检查
  - GET  /api/search?q=&k=      RAG 检索（FTS5 + 向量混合）
  - POST /api/chat             梨宝问答（脱敏 → RAG → 可降级 LLM 合成）

LLM（可选，OpenAI 兼容，DeepSeek/GLM 等）：通过环境变量配置，缺省则不调 LLM，
降级为「抽取式回答」（直接拼接检索到的原文片段），保证无 Key 也能完整可用。

环境变量：
  LLM_BASE_URL   默认 https://api.deepseek.com/v1
  LLM_API_KEY    缺省为空 → 走抽取式
  LLM_MODEL      默认 deepseek-chat
"""
import os, re, sys, io, json
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# 把 scripts/ 目录纳入 import 路径，复用 rag.py
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "scripts"))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import rag

app = FastAPI(title="上理生活助手 · 梨宝 API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- 加载 .env（手写解析，无需 python-dotenv） ----------
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

# ---------- 梨宝人格设定（system prompt） ----------
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
- 只依据下面给的校园资讯回答，绝不编造事实。
- 语气轻松、口语化、简短（150 字内）。
- 查不到就诚实说，顺带安慰一下，别硬编。"""

# ---------- 脱敏网关 ----------
_SENSITIVE = [
    (r"1[3-9]\d{9}", "[手机号]"),                 # 11 位手机号
    (r"20\d{11}", "[学号]"),                       # 13 位学号（20 开头）
    (r"\b\d{6,12}\b", "[编号]"),                   # 其他长数字编号
    (r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "[邮箱]"),
]

def desensitize(text: str) -> str:
    for pat, rep in _SENSITIVE:
        text = re.sub(pat, rep, text)
    return text

# ---------- LLM（可降级） ----------
def llm_synthesize(question: str, sources: list) -> str | None:
    if not LLM_API_KEY:
        return None
    ctx = "\n\n".join(
        f"[{i+1}]《{s['title']}》（{s['account']}·{s['pub_time']}）\n{s['snippet']}"
        for i, s in enumerate(sources)
    )
    prompt = (
        f"【校园资讯】\n{ctx}\n\n【用户问题】{question}\n\n"
        "请以梨宝的口吻回答（语气轻松，150 字内）。"
    )
    try:
        import requests
        r = requests.post(
            f"{LLM_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": LLM_MODEL,
                "messages": [
                    {"role": "system", "content": LIBAO_PERSONA},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.5,
                "max_tokens": 400,
            },
            timeout=30,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print("[LLM] 调用失败，降级抽取式：", e)
        return None

def extractive_answer(sources: list) -> str:
    if not sources:
        return "害！梨宝翻遍服务器也没查到，建议宝子去看看学校官方公众号的通知嗷～ [梨宝摊手.jpg]"
    top = sources[0]
    lines = [f"梨宝掐指一算，这题《{top['title']}》里有答案，你懂我意思吧？", ""]
    lines.append(top["snippet"].strip()[:280])
    return "\n".join(lines)

# ---------- 路由 ----------
class ChatReq(BaseModel):
    q: str
    k: int = 4

@app.get("/api/health")
def health():
    return {"ok": True, "llm": bool(LLM_API_KEY), "model": LLM_MODEL if LLM_API_KEY else None}

@app.get("/api/search")
def api_search(q: str, k: int = 5):
    q = (q or "").strip()
    if not q:
        return {"query": q, "results": []}
    results = rag.search(q, k)
    return {"query": q, "results": results}

@app.post("/api/chat")
def api_chat(body: ChatReq):
    q = desensitize((body.q or "").strip())
    if not q:
        return {"answer": "你想问梨宝什么呢？", "mode": "empty", "sources": []}
    results = rag.search(q, max(1, min(body.k, 6)))
    sources = [
        {
            "title": r["title"],
            "account": r["account"],
            "pub_time": r["pub_time"],
            "snippet": r["full_text"][:400],
            "url": r.get("url", ""),
        }
        for r in results[:4]
    ]
    answer = llm_synthesize(q, sources)
    mode = "llm" if answer else "extractive"
    if not answer:
        answer = extractive_answer(sources)
    return {"answer": answer, "mode": mode, "sources": sources}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
