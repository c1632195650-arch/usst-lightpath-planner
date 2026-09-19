# -*- coding: utf-8 -*-
"""
评测系统 · 裁判适配器（2026-09-18 P1）
=======================================
**零第三方依赖**（只用 requests），因为本项目没有裁判预算，而 DeepEval / RAGAS
这类库的核心价值是「指标定义」而不是「连接模型」——定义我们照抄（faithfulness /
relevancy / completeness / 分寸），连接自己做，省下重依赖与不可控的 token 花费。

三档 provider（默认 none = 一分钱不花，先把管线跑通）：
  none      不调用任何模型 → 一律返回 unknown（用于 dry-run 与 CI 自检）
  ollama    本地模型（免费；需自行安装 Ollama，默认 qwen2.5:7b-instruct）
  deepseek  付费档（读 server/.env 的 LLM_API_KEY）——**必须显式指定**，且受
            `JUDGE_MAX_CALLS` 硬上限保护（默认 30 次），防止误跑烧钱

六条判分纪律的实现位置：
  ① 不用同族裁判 → provider 选择权交给调用方（规则是：生成用 deepseek 时裁判别用 deepseek）
  ② 分维度独立打分 + unknown 出口 → 见 rubrics 与 parse_result
  ③ 成对比较换序 → 由调用方跑两次（本模块只负责单次判定）
  ④ 客观题给证据 → payload 里传 evidence 字段
  ⑤ 校准门槛 → evals/calibrate.py
  ⑥ 成本控制 → JUDGE_MAX_CALLS + 每次调用记账（calls_made/cost_note）

用法：
  python evals/judge.py --selftest                     # 自检（不发请求）
  python evals/judge.py --metric faithfulness --payload payload.json --provider ollama
"""
import argparse
import json
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUBRICS = os.path.join(ROOT, "evals", "judges", "rubrics.md")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b-instruct")
MAX_CALLS = int(os.environ.get("JUDGE_MAX_CALLS", "30"))

_calls = 0


def load_rubrics():
    """从 rubrics.md 里按顺序抽出 ``` 代码块 → {metric: prompt}"""
    txt = open(RUBRICS, encoding="utf-8").read()
    blocks = re.findall(r"```\n(.*?)```", txt, re.S)
    names = ["faithfulness", "relevance", "tone_safety"]
    if len(blocks) < len(names):
        raise RuntimeError(f"rubrics.md 里只找到 {len(blocks)} 个 rubric，期望 {len(names)}")
    return dict(zip(names, blocks))


def render(metric, payload):
    """把 payload 填进 rubric 模板。缺字段填空串（裁判会走 unknown 分支，不会崩）。"""
    tpl = load_rubrics()[metric]
    out = tpl
    for k in ("question", "answer", "evidence", "reference"):
        v = payload.get(k, "")
        if isinstance(v, (list, tuple)):
            v = "\n".join(str(x) for x in v)
        out = out.replace("{{" + k + "}}", str(v or "（无）"))
    return out


def available():
    provs = ["none"]
    try:
        import requests
        requests.get(OLLAMA_URL + "/api/tags", timeout=2)
        provs.append("ollama")
    except Exception:
        pass
    if _deepseek_key():
        provs.append("deepseek")
    return provs


def _load_env(path):
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


def _deepseek_key():
    _load_env(os.path.join(ROOT, "server", ".env"))
    return os.environ.get("LLM_API_KEY", "").strip()


def parse_result(metric, text):
    """严格解析：字段不全 → failed=True（**不许当 0 分**，见 judges/README 解析约定）"""
    want = {
        "faithfulness": ["score"],
        "relevance": ["relevance", "completeness", "clarity"],
        "tone_safety": ["no_fabrication", "labeled_unofficial",
                        "no_decision_for_user", "tone_persona"],
    }[metric]
    try:
        m = re.search(r"\{.*\}", text or "", re.S)
        obj = json.loads(m.group(0)) if m else {}
    except Exception:
        return {"failed": True, "unknown": False, "scores": {}, "reason": "JSON 解析失败"}
    missing = [k for k in want if k not in obj or obj[k] is None]
    unknown = bool(obj.get("unknown"))
    if unknown:
        return {"failed": False, "unknown": True, "scores": {},
                "reason": obj.get("reason", "裁判自述无法判断")}
    if missing:
        return {"failed": True, "unknown": False, "scores": obj,
                "reason": f"缺字段 {missing}"}
    return {"failed": False, "unknown": False,
            "scores": {k: obj[k] for k in want},
            "reason": obj.get("reason", "")}


def _call_ollama(prompt):
    import requests
    r = requests.post(f"{OLLAMA_URL}/api/generate",
                      json={"model": OLLAMA_MODEL, "prompt": prompt,
                            "stream": False, "format": "json",
                            "options": {"temperature": 0}},
                      timeout=120)
    r.raise_for_status()
    return r.json().get("response", "")


def _call_deepseek(prompt):
    import requests
    key = _deepseek_key()
    base = os.environ.get("LLM_BASE_URL", "https://api.deepseek.com/v1").rstrip("/")
    r = requests.post(f"{base}/chat/completions",
                      headers={"Authorization": f"Bearer {key}",
                               "Content-Type": "application/json"},
                      json={"model": os.environ.get("JUDGE_MODEL", "deepseek-chat"),
                            "messages": [{"role": "user", "content": prompt}],
                            "temperature": 0,
                            "response_format": {"type": "json_object"}},
                      timeout=90)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def judge_one(metric, payload, provider="none"):
    """单次判定。返回 dict（永远不抛异常，失败也返回结构化结果）"""
    global _calls
    base = {"metric": metric, "provider": provider}
    if provider == "none":
        return {**base, "unknown": True, "failed": False,
                "reason": "provider=none（dry-run，不调用模型）", "scores": {},
                "prompt_chars": len(render(metric, payload))}
    if _calls >= MAX_CALLS:
        return {**base, "unknown": False, "failed": True,
                "reason": f"超出 JUDGE_MAX_CALLS={MAX_CALLS} 硬上限，已停止调用",
                "scores": {}}
    prompt = render(metric, payload)
    try:
        text = _call_ollama(prompt) if provider == "ollama" else _call_deepseek(prompt)
    except Exception as e:
        return {**base, "unknown": False, "failed": True,
                "reason": f"{provider} 调用失败：{str(e)[:120]}", "scores": {}}
    _calls += 1
    out = parse_result(metric, text)
    return {**base, **out, "prompt_chars": len(prompt), "raw": (text or "")[:400]}


def main():
    ap = argparse.ArgumentParser(description="裁判适配器（零依赖）")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--metric", default="faithfulness",
                    choices=["faithfulness", "relevance", "tone_safety"])
    ap.add_argument("--payload", default="")
    ap.add_argument("--provider", default="none", choices=["none", "ollama", "deepseek"])
    args = ap.parse_args()

    if args.selftest:
        rubs = load_rubrics()
        print(f"rubric 载入：{list(rubs)}｜可用 provider：{available()}")
        demo = {"question": "学校有没有麦当劳", "evidence": "左侧有麦当劳（6:30-22:00）",
                "answer": "有嗷，在第二食堂左侧，6:30-22:00。"}
        for mt in rubs:
            p = render(mt, demo)
            print(f"  {mt:<12} 渲染 {len(p)} 字，含 JSON 要求：{'只输出 JSON' in p}")
        # 解析器自检（含"缺字段=失败"与"unknown 不算失败"）
        print("  解析自检：",
              parse_result("faithfulness", '{"score": 5, "reason": "ok"}')["scores"],
              parse_result("faithfulness", '{"unknown": true}')["unknown"],
              parse_result("relevance", '{"relevance": 4}')["failed"])
        print(f"  dry-run 判定：{judge_one('faithfulness', demo, 'none')['reason']}")
        return 0

    payload = json.load(open(args.payload, encoding="utf-8")) if args.payload else {}
    res = judge_one(args.metric, payload, args.provider)
    print(json.dumps(res, ensure_ascii=False, indent=1))
    return 0 if not res.get("failed") else 1


if __name__ == "__main__":
    sys.exit(main())
