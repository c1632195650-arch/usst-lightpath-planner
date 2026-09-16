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
  GET  /api/search?q=&k=                  公众号文章库检索（政策/通知/攻略）
  GET  /api/poi?q=&funcs=&k=              校园地点检索（147 地点·支持口语黑话）
  GET  /api/nearby?from=&k=&funcs=&types=  就近推荐（按步行分钟，OSM 路网实算）
  POST /api/chat   {q, session_id, user_id, k}
  POST /api/memory/reset  {session_id, user_id}
  GET  /api/route?from=&to=&mode=         两点步行路径（排程引擎的转场时间）
  POST /api/route/batch  {pairs:[[a,b],...]}  批量问路
  GET  /api/weather?days=7                未来天气（Open-Meteo · 分时段摘要）

🔴 /api/poi 与 /api/nearby **一律不返回经纬度**（2026-09-15 决策 D4）：
   真实坐标只用于后端算路与排序，不出现在任何响应体里。
"""
import os, re, sys, io, json, time, uuid
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "scripts"))

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import rag
import campus
import memory
# 三级梯子的后两级（2026-09-16）：
#   direct = L0 模板直答（存在性/位置/营业时间，0 次 LLM）
#   agent  = L2 托底（库外流量交给 LLM 自查一轮，必要时才联网）
import direct
import agent
import websearch   # 只为读 LIBAO_WEBSEARCH 开关（真正的搜索在 agent 的工具里）

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

# 调试开关（默认关，关时行为与本开关不存在时**完全一致**）：
#   LIBAO_DEBUG=1 python server/app.py
# 打开后每轮 /api/chat 打**一行** trace，用于把「答得不对」拆成四段定位：
#   检索错（raw_vec 低 / 没有相关条目）｜上下文错（snippet 里没有答案）
#   模型错（snippet 有答案但回答跑偏）｜渲染错（前端显示 ≠ answer）
# 刻意只打一行：多行日志在终端里翻不动，也没法 grep。
LIBAO_DEBUG = os.environ.get("LIBAO_DEBUG", "").strip().lower() not in ("", "0", "false", "no", "off")

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
    # ⚠️ 边界不能用 `\b`：Python re 在 Unicode 模式下把中文也当作 \w，
    #    于是「学号20231234567」这种**中文紧邻数字**的写法两侧都不构成单词边界，
    #    整条规则静默失效（实测：手机号能脱敏，紧跟中文的学号漏掉）。
    #    改用「前后不是数字」的环视 —— 这才是原本想表达的边界，且不依赖 \w 的语义。
    (r"(?<!\d)1[3-9]\d{9}(?!\d)", "[手机号]"),
    (r"(?<!\d)20\d{11}(?!\d)", "[学号]"),
    (r"(?<!\d)\d{6,12}(?!\d)", "[编号]"),
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
def llm_answer(question, sources, route, mem_ctx="", space_ctx="", profile_ctx=""):
    if not LLM_API_KEY:
        return None
    ctx = ""
    if sources:
        # ⚠️ 必须用 .get 兜底：`api_chat` 投影出的 sources **不含 full_text**，
        #    而 snippet 在检索侧可能为空（缺全文的文章）→ 直接下标会 KeyError。
        #    本段又在 try 之外，异常会一路冒到 HTTP 500。实测：20 条真实提问里 2 条（10%）会触发。
        ctx = "\n\n".join(
            f"[{i+1}]《{s['title']}》（{s['account']}·{s['pub_time']}）\n"
            f"{(s.get('snippet') or s.get('full_text') or '')[:400]}"
            for i, s in enumerate(sources)
        )
    blocks = []
    if profile_ctx:
        # 「你是谁」是背景，排在记忆与检索之前 —— 先立人，再谈事。
        # 必须显式禁止复述：否则模型会把一串轴值原样念出来，像在念体检报告。
        blocks.append(
            "【用户档案】这位同学的真实情况如下。回答时请结合 TA 的课表、作息偏好与所处学期阶段，"
            "但不要机械复述档案条目，也不要主动提及档案的存在。\n" + profile_ctx
        )
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
    body = (top.get("snippet") or top.get("full_text") or "").strip()[:280]
    if not body:
        # 检索到了条目却连正文都取不到 —— 与其回一个只有抬头的空壳，不如照实说没查到
        return ("害！这个梨宝翻遍服务器也没查到官方说法 [梨宝摊手.jpg]\n"
                "建议宝子去学校官网或问辅导员确认一下嗷～")
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
    # 用户档案摘要（画像轴值 + 课表概览 + 学期阶段），由前端 features/libao 侧生成。
    # 这里不设 max_length：它是内部通道，超长直接截断比返回 422 更不容易把对话打断
    # （截断与脱敏在 api_chat 里做）。
    profile_ctx: str = ""
    k: int = 4

@app.get("/api/health")
def health():
    return {"ok": True, "llm": bool(LLM_API_KEY),
            "model": LLM_MODEL if LLM_API_KEY else None,
            "thresholds": {"raw_high": RAW_HIGH, "raw_low": RAW_LOW}}


# ---------- 天气（Open-Meteo · 免 Key · 免注册） ----------
# 数据源取舍与「高德要 Key 有配额所以弃用」同源：排程要天天问天气，
# 只有免费且无需注册才可能长期跑下去。
#
# 坐标默认取**主校区（军工路 516 号）**，值来自 data/osm/key_points.json 的实测校门坐标。
# 刻意不用「上海市中心」那个点 —— 那会让「上海天气」和「学校天气」差出一个区。
WEATHER_LAT = float(os.environ.get("WEATHER_LAT", "31.292147"))
WEATHER_LON = float(os.environ.get("WEATHER_LON", "121.547838"))
WEATHER_TTL = int(os.environ.get("WEATHER_TTL_SEC", "1800"))   # 缓存 30 分钟

# WMO 天气码 → 中文。只列实际会遇到的；**未知码如实返回「未知」，不猜**。
_WMO_CN = {
    0: "晴", 1: "晴间多云", 2: "多云", 3: "阴",
    45: "雾", 48: "雾凇",
    51: "毛毛雨", 53: "小雨", 55: "中雨", 56: "冻雨", 57: "冻雨",
    61: "小雨", 63: "中雨", 65: "大雨", 66: "冻雨", 67: "冻雨",
    71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
    80: "阵雨", 81: "强阵雨", 82: "暴雨",
    85: "阵雪", 86: "强阵雪",
    95: "雷阵雨", 96: "雷阵雨伴冰雹", 99: "强雷阵雨伴冰雹",
}

_weather_cache: dict = {}


def _num(v, nd=None):
    """宽松数值转换：拿不到就返回 None（让前端少一个数字，而不是多一个 0）。"""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f, nd) if nd is not None else int(round(f))


def _wmo_text(code) -> str:
    try:
        return _WMO_CN.get(int(code), "未知")
    except (TypeError, ValueError):
        return "未知"


def _bucket(hour: int) -> str:
    """一天三段 —— 与作息真正相关的三段（上午 / 下午 / 晚间）。"""
    if 6 <= hour < 12:
        return "am"
    if 12 <= hour < 18:
        return "pm"
    if 18 <= hour < 23:
        return "night"
    return ""


@app.get("/api/weather")
def api_weather(days: int = Query(7, ge=1, le=16)):
    """未来若干天天气，含**分时段**（上午 / 下午 / 晚间）摘要。

    只返回数据、不返回建议 —— 「下雨该不该把跑步改到室内」是产品策略，
    归前端 `features/weather/`，那里才可测试、可调整。

    数据源不可用时返回 `ok: false` 而**不是 5xx**：天气是可选增强，
    拉不到就不显示，不该把整个周计划页拖成报错。
    """
    import time as _time
    from collections import defaultdict

    cached = _weather_cache.get(days)
    if cached and _time.time() - cached["at"] < WEATHER_TTL:
        return {**cached["payload"], "cached": True}

    try:
        import requests
        r = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": WEATHER_LAT,
                "longitude": WEATHER_LON,
                "daily": ("weather_code,temperature_2m_max,temperature_2m_min,"
                          "precipitation_probability_max,precipitation_sum,wind_speed_10m_max"),
                "hourly": "temperature_2m,precipitation_probability,weather_code",
                "timezone": "Asia/Shanghai",
                "forecast_days": days,
            },
            timeout=12,
        )
        r.raise_for_status()
        raw = r.json()
    except Exception as e:
        print("[WEATHER] 拉取失败：", e)
        return {"ok": False, "error": str(e), "days": []}

    # 小时级 → 三段聚合。每段取**最坏的降水概率**与温度极值：
    # 用户关心的是「这段时间会不会淋到」，平均值会把一场阵雨抹平。
    buckets: dict = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    hourly = raw.get("hourly") or {}
    h_time = hourly.get("time") or []
    for i, ts in enumerate(h_time):
        try:
            date, hh = ts.split("T")
            hour = int(hh.split(":")[0])
        except (ValueError, IndexError):
            continue
        b = _bucket(hour)
        if not b:
            continue
        for src, dst in (("precipitation_probability", "rainProb"),
                         ("temperature_2m", "temp"),
                         ("weather_code", "code")):
            arr = hourly.get(src) or []
            if i < len(arr) and arr[i] is not None:
                buckets[date][b][dst].append(arr[i])

    daily = raw.get("daily") or {}
    out = []
    for i, date in enumerate(daily.get("time") or []):
        def _at(key):
            arr = daily.get(key) or []
            return arr[i] if i < len(arr) else None

        periods = {}
        for b in ("am", "pm", "night"):
            src = buckets.get(date, {}).get(b) or {}
            if not src:
                continue
            codes = src.get("code") or [0]
            temps = src.get("temp") or []
            rains = src.get("rainProb") or []
            periods[b] = {
                "code": _num(codes[0]) or 0,
                "text": _wmo_text(codes[0]),
                "rainProb": _num(max(rains)) or 0,
                "tMax": _num(max(temps), 1) if temps else None,
                "tMin": _num(min(temps), 1) if temps else None,
            }

        out.append({
            "date": date,
            "code": _num(_at("weather_code")) or 0,
            "text": _wmo_text(_at("weather_code")),
            "tMax": _num(_at("temperature_2m_max"), 1),
            "tMin": _num(_at("temperature_2m_min"), 1),
            "rainProb": _num(_at("precipitation_probability_max")) or 0,
            "rainMm": _num(_at("precipitation_sum"), 1),
            "windMax": _num(_at("wind_speed_10m_max"), 1),
            "periods": periods,
        })

    payload = {
        "ok": True,
        "place": "军工路 516 号（主校区）",
        "lat": WEATHER_LAT, "lon": WEATHER_LON,
        "source": "open-meteo",
        "days": out,
    }
    _weather_cache[days] = {"at": _time.time(), "payload": payload}
    return {**payload, "cached": False}


@app.get("/api/search")
def api_search(q: str, k: int = 5):
    q = (q or "").strip()
    if not q:
        return {"query": q, "results": []}
    return {"query": q, "results": rag.search(q, k)}


# ---------- 校园地点检索（口语 → 地点）----------
# 与 /api/search 的分工：/api/search 查的是「公众号文章库」（政策、通知、攻略），
# /api/poi 查的是「校园空间图谱」（147 个地点）。两者数据源完全不同，不要混。
#
# 🔴 本接口**不返回经纬度**（2026-09-15 决策 D4）：
#    `campus_map.json` 按合规设计本就不落坐标，投影层再显式白名单一次，
#    保证既不暴露、也不给未来的改动留后门。
@app.get("/api/poi")
def api_poi(q: str = "", funcs: str = "", k: int = 5):
    """`/api/poi?q=吃饭&funcs=life&k=5`

    q 支持官方名（第三教学楼）、别名（三教）、口语黑话（图文 / 取快递 / 看病）。
    funcs 为五类功能过滤：teach 教学 / office 办公 / life 生活 / sport 运动 / transport 交通。
    返回 {query, funcs, results:[{id,name,type,func,emoji,campus,campus_cn,zone,hours,…}]}

    ⚠️ 参数名**不能叫 `func`** —— FastAPI 内部
    `run_in_threadpool(func, ...)` 的第一个位置参数就叫 `func`，
    接口签名里再用 `func` 会撞成 `got multiple values for argument 'func'`，
    运行时直接 500（2026-09-15 实测踩到，故改名 `funcs`）。
    """
    q = (q or "").strip()
    k = max(1, min(k, 20))
    if not q and not funcs:
        return {"query": q, "funcs": funcs, "results": []}
    results = campus.search_pois(q, func=funcs or None, limit=k)
    return {"query": q, "funcs": funcs, "results": results}


@app.get("/api/nearby")
def api_nearby(src: str = Query("", alias="from"), k: int = 5,
               funcs: str = "", types: str = "", max_min: float = 0):
    """`/api/nearby?from=第三教学楼&k=5&funcs=life&types=食堂`

    按**步行分钟**（OSM 路网实算，不是直线距离）升序返回最近的设施。
    候选只取 `pois`（吃/买/快递/打印/办事），校园地标不参与。
    `funcs` 五类功能过滤；`types` 精确到 type（「下课饿了去哪吃」用 `types=食堂`
    比 `funcs=life` 准 —— 后者会把心理健康中心也带进来）。
    起点无法定位、或与某地点分属不同教学区时不猜：前者 `walkable:false`，
    后者直接不出现在结果里。
    返回 `results`（可算分钟的，按分钟升序）+ `unrefined`（位置只细化到片区、
    与起点落在同一参考点，**给不出分钟就不给**）；后者不占 `k` 名额，也不会被丢掉。

    ⚠️ 同理，参数名避开 `func`（FastAPI 保留），见 `/api/poi` 的说明。
    """
    k = max(1, min(k, 20))
    ts = [t.strip() for t in types.split(",") if t.strip()] or None
    return campus.nearby_by_walk(src, limit=k, funcs=funcs or None,
                                 types=ts, max_min=(max_min or None))


# ---------- 步行路径（排程引擎的转场时间来源） ----------
class RouteBatchReq(BaseModel):
    """批量问路：排程引擎一次要问十几对地点，逐条 HTTP 太慢。"""
    pairs: list[list[str]] = Field(default_factory=list, max_length=200)
    mode: str = "fastest"


def _route_payload(a: str, b: str, mode: str = "fastest"):
    """把 campus.route 的结果整理成前端要的形状（只留必要字段）。"""
    r = campus.route(a, b, mode)
    if not r:
        return None
    return {
        "from": r.get("from"), "to": r.get("to"),
        "meters": round(r.get("meters", 0)),
        "minutes": round(r.get("minutes", 0), 1),
        "reliable": bool(r.get("reliable", False)),
        "locate": list(r.get("locate", [])),
        "mode": mode,
    }


@app.get("/api/route")
def api_route(src: str = Query("", alias="from"), dst: str = Query("", alias="to"),
              mode: str = "fastest"):
    """两点间步行路径。

    q: /api/route?from=第三教学楼&to=第五食堂
    返回 {from,to,meters,minutes,reliable,locate} 或 {"route": null}
    （查不到时返回 null 而不是报错 —— 前端据此退回估算值）
    """
    if not src or not dst:
        return {"route": None, "reason": "missing from/to"}
    if mode not in ("fastest", "campus"):
        mode = "fastest"
    return {"route": _route_payload(src, dst, mode)}


@app.post("/api/route/batch")
def api_route_batch(body: RouteBatchReq):
    """批量问路，返回 {'<from>→<to>': payload|null}。"""
    mode = body.mode if body.mode in ("fastest", "campus") else "fastest"
    out = {}
    for pair in body.pairs[:200]:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            continue
        a, b = str(pair[0]), str(pair[1])
        if not a or not b:
            continue
        out[f"{a}→{b}"] = _route_payload(a, b, mode)
    return {"routes": out, "mode": mode}


def _chat_trace(rid, q, route, intent, top_raw, n_results, sources,
                space_ctx, mem_ctx, profile_ctx, mode, answer, ms, tools=None):
    """把一轮对话的关键中间量压成**一行**日志（仅在 LIBAO_DEBUG 打开时调用）。

    它存在的原因：响应体里的 route / top_raw_vec / sources 分数其实一直都有，
    只是**没有任何地方把它们打出来** —— 调一轮对话要么开浏览器、要么加断点。
    这一行是为了能在终端里一眼分清四类故障：

      检索错   → top_raw 低，或 sources 全是风马牛不相及的标题
      上下文错 → 标题对，但 snippet 里根本没有答案（这是 F2 修掉的那类）
      模型错   → snippet 里明明有答案，answer 却跑偏
      渲染错   → answer 正常，前端显示不对（看前端的调试抽屉）

    `src3` 里三个数字依次是：score（归一化排序分）/ raw_vec（绝对余弦，判边界的那个）/
    snippet 字符数 —— **snip_len=0 基本等于「这一条什么都没喂给模型」**。
    """
    try:
        top = " ".join(
            f"{s['title'][:22]}({s.get('score', 0.0):.2f}/{s.get('raw_vec', 0.0):.2f}/"
            f"{len(s.get('snippet') or '')})"
            for s in sources[:3]
        ) or "-"
        print(
            f"[chat {rid}] q={q[:36]!r} route={route} intent={intent} "
            f"top_raw={top_raw:.3f} k={n_results} src3=[{top}] "
            f"space={int(bool(space_ctx))} mem={int(bool(mem_ctx))} "
            f"prof={int(bool(profile_ctx))} mode={mode} "
            f"tools=[{','.join(tools or []) or '-'}] "
            f"ans_len={len(answer)} ms={int(ms)}",
            flush=True,
        )
    except Exception as e:      # 日志绝不能把正常对话搞挂
        print(f"[chat {rid}] trace 失败：{e}", flush=True)


@app.post("/api/chat")
def api_chat(body: ChatReq):
    # request_id：把「终端里那一行 trace」和「前端调试抽屉里这一轮」对起来
    rid = uuid.uuid4().hex[:8]
    _t0 = time.perf_counter()

    q = desensitize((body.q or "").strip())
    if not q:
        return {"answer": "你想问梨宝什么呢？", "route": "empty", "sources": [],
                "request_id": rid, "elapsed_ms": 0}

    # 用户档案：再兜一层脱敏（前端已过滤一轮），并截断防 prompt 膨胀。
    # 注意档案里**不该**出现学号/姓名/手机号，但信任边界不能靠前端单方面保证。
    profile_ctx = desensitize((body.profile_ctx or "").strip())[:1200]

    # 1) 检索（拿 raw_vec 作为边界信号）
    results = rag.search(q, max(1, min(body.k, 6)))
    sources = [{
        "title": r["title"], "account": r["account"], "pub_time": r["pub_time"],
        # snippet 为空（缺全文的公众号文章）时退回 full_text —— 否则下游拿到空上下文，
        # 且会让 llm_answer 里的 `s['full_text']` 直接 KeyError（详见该处注释）。
        "snippet": (r.get("snippet") or r.get("full_text") or "")[:400],
        "url": r.get("url", ""),
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

    # 5) 生成答案 —— 三层梯子（2026-09-16 落地，钱花在刀刃上）：
    #    L0 template  存在性/位置/营业时间 + 实体命中 → 图谱拼答案，**0 次 LLM**
    #    L1 快路径    grounded / hybrid → 现有「检索 + 一次生成」
    #    L2 托底      route=="llm"（规则判定库外）→ agent 自查一轮（图谱/资讯库/联网）
    #                 失败则回退旧行为，行为不比改动前更差
    # 注意：`route` 字段语义**保持不变**（仍是规则路由的判定结果，供回归断言与调试对齐），
    #       新行为只体现在 `mode`（template / llm / extractive）与新增的 `tools` 上。
    tools_used = []
    da = None
    try:
        da = direct.try_direct(q)
    except Exception as e:
        print("[direct] 异常：", e)
    if da:
        answer, mode = da["answer"], "template"
        # 模板答完全取自结构化图谱，不引用资讯库 → 置空 sources，避免前端显示"假来源"
        sources = []
    elif route == "llm":
        ag = agent.run_agent(q, LIBAO_PERSONA, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL,
                             mem_ctx=mem_ctx, profile_ctx=profile_ctx,
                             web_ok=websearch.enabled())
        if ag and ag.get("answer"):
            answer, mode = ag["answer"], "llm"
            tools_used = ag.get("tools") or []
        else:
            answer = llm_answer(q, sources, route, mem_ctx, space_ctx, profile_ctx)
            mode = "llm" if answer else "extractive"
            if not answer:
                answer = extractive_answer(sources, route)
    else:
        answer = llm_answer(q, sources, route, mem_ctx, space_ctx, profile_ctx)
        mode = "llm" if answer else "extractive"
        if not answer:
            answer = extractive_answer(sources, route)

    # 6) 落记忆（用户问 + 梨宝答；回答侧也过脱敏，模型可能复述出用户输入的号码/学号）
    try:
        memory.remember(body.user_id, body.session_id, "user", q)
        memory.remember(body.user_id, body.session_id, "assistant", desensitize(answer))
    except Exception as e:
        print("[memory] 写入失败：", e)

    # 7) 调试 trace（默认关；`LIBAO_DEBUG=1` 时每轮一行）
    elapsed_ms = (time.perf_counter() - _t0) * 1000
    if LIBAO_DEBUG:
        _chat_trace(rid, q, route, intent, top_raw, len(results), sources,
                    space_ctx, mem_ctx, profile_ctx, mode, answer, elapsed_ms,
                    tools=tools_used)

    return {
        "answer": answer, "mode": mode, "route": route,
        "intent": intent, "top_raw_vec": round(top_raw, 4),
        "sources": sources,
        "used_space": bool(space_ctx),
        "used_memory": bool(mem_ctx),
        # 与 used_space / used_memory 对齐：让「这轮到底用上了什么」可被前端与测试观测
        "used_profile": bool(profile_ctx),
        # 托底层用了哪些工具（search_kb / search_pois / web_search）——
        # 空数组 = L0 模板或 L1 快路径，未进入 agent
        "tools": tools_used,
        # 纯附加字段（不破坏既有契约）：给前端调试抽屉与日志做对齐用
        "request_id": rid, "elapsed_ms": round(elapsed_ms),
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
