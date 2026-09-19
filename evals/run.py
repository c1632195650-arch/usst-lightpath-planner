# -*- coding: utf-8 -*-
"""
评测系统 · 台架（2026-09-18 P0）
================================
一条命令跑完「双端确定性套件 + 检索层评测」，输出指标、对比基线、按门禁退出。
设计原则（与业界共识一致）：**能用确定性判分就不用模型裁判**——
本文件里没有任何 LLM 调用，所以它便宜到可以挂在每次提交上。

套件划分
--------
  l0  确定性套件（双端，0 成本）
      后端：test_campus / test_direct / test_rag
      前端：npm test:ui / test:engine / typecheck
      → 门禁：**必须 100%**（回归集的意义就是恒为 100%）

  l1  检索层评测（0 成本，需要后端活着）
      · 图谱实体召回：/api/poi?q=<问句> 里有没有期望实体
      · 文档召回：/api/search?q=<问句> 的 recall@5 与 MRR
      · 模板直答正确性：/api/chat 对存在性题应走 mode=template（零 LLM 成本）
      → 门禁：entity_recall=1.00、template_acc=1.00、recall@5≥0.90、违禁词命中=0

  e2e 端到端对话（**要花 LLM 的钱**，默认不跑，留给夜间/发版前）
      全量 golden 过 /api/chat，检查 must_include / must_not_include / mode / 来源文档

  l3  对话级套件（**要花钱**，`--repeat k` 支持 pass^k）
      多轮场景 + **终态断言**（mode/tools/used_space/记忆）+ 分寸与诚实性检查。
      对用户可见路径看 **pass^k（k 次全对）** 而不是 pass@k —— 校园助手
      「多试几次能对」没有意义。

用法
----
  python evals/run.py --suite l0 --gate              # 提交前（≈1 分钟）
  python evals/run.py --suite l1 --gate              # 提交前（需后端）
  python evals/run.py --suite all --gate             # 提交前全量免费档
  python evals/run.py --suite l3 --repeat 3 --gate   # 夜间档：一致性（花钱）
  python evals/run.py --suite e2e --base http://127.0.0.1:8000   # 夜间档（花钱）
  python evals/run.py --suite l1 --update-baseline   # 确认新基线（指标提升后）
"""
import argparse
import datetime
import glob
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNS_DIR = os.path.join(ROOT, "evals", "runs")
BASE_LINE = os.path.join(RUNS_DIR, "baseline.json")
NODE_DIR = r"C:\Users\CY\.workbuddy\binaries\node\versions\24.14.0"
PY = sys.executable          # 谁调用我，就用谁的解释器（托管 venv）

GATES = {"entity_recall": 1.00, "template_acc": 1.00, "recall@5": 0.90, "forbidden_hits": 0}


def env():
    e = os.environ.copy()
    if os.path.isdir(NODE_DIR):
        e["PATH"] = NODE_DIR + os.pathsep + e.get("PATH", "")
    e["NO_PROXY"] = e["no_proxy"] = "127.0.0.1,localhost"
    return e


def sh(cmd, timeout=900):
    t0 = time.time()
    p = subprocess.run(cmd, cwd=ROOT, env=env(), shell=True,
                       capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=timeout)
    return p.returncode, (p.stdout or "") + (p.stderr or ""), time.time() - t0


_SUM = re.compile(r"汇总：(\d+)/(\d+)")
_NODE = re.compile(r"^# pass (\d+)|^ℹ pass (\d+)|^# fail (\d+)|^ℹ fail (\d+)", re.M)


def parse_nums(out):
    m = _SUM.search(out)
    if m:
        return int(m.group(1)), int(m.group(2))
    p = f = None
    for line in out.splitlines():
        s = line.strip().lstrip("ℹ# ").strip()
        mm = re.match(r"pass (\d+)", s)
        if mm:
            p = int(mm.group(1))
        mm = re.match(r"fail (\d+)", s)
        if mm:
            f = int(mm.group(1))
    if p is not None:
        return p, p + (f or 0)
    return None, None


def suite_l0():
    """双端确定性套件。返回 [(名称, 端, pass, total, rc, 秒)]"""
    cmds = [
        ("test_campus", "后端", f'"{PY}" scripts/test_campus.py'),
        ("test_direct", "后端", f'"{PY}" scripts/test_direct.py'),
        ("test_rag", "后端", f'"{PY}" scripts/test_rag.py'),
        ("judge_rules", "评测", f'"{PY}" evals/test_judge_rules.py'),
        ("test:ui", "前端", "npm run test:ui"),
        ("test:engine", "前端", "npm run test:engine"),
        ("typecheck", "前端", "npm run typecheck"),
    ]
    rows = []
    for name, side, cmd in cmds:
        rc, out, sec = sh(cmd)
        p, t = parse_nums(out)
        rows.append({"name": name, "side": side, "pass": p, "total": t,
                     "rc": rc, "sec": round(sec, 1),
                     "tail": "\n".join(out.strip().splitlines()[-6:])})
        mark = "✅" if rc == 0 else "❌"
        print(f"  {mark} [{side}] {name:<12} {'' if p is None else f'{p}/{t}':<8} "
              f"{round(sec,1)}s" + ("" if rc == 0 else "  ← 看 tail"))
        if rc != 0:
            print("      " + (rows[-1]["tail"].replace("\n", "\n      ")))
    return rows


# ---------------- HTTP（与 libao 调试器同一约定：回环不走代理） ----------------
def _get(base, path, timeout=30):
    with urllib.request.urlopen(base + path, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _post(base, path, obj, timeout=90):
    req = urllib.request.Request(base + path, data=json.dumps(obj).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


_PREFLIGHT_Q = "学校有没有麦当劳"   # 存在性题 → 新版走 L0 模板，0 次 LLM


def _preflight(base):
    """后端版本指纹预检（**防「旧进程占着 8000 → 门禁假红」**）。

    2026-09-18 实测教训：8000 端口被一个**旧版后端**占着（响应无 `tools`/`request_id`
    字段，且它正答着早已修掉的老 bug），L1 门禁于是报 template_acc 1.0→0.0、耗时 12s→60s
    ——看起来像产品崩了，其实只是打到了旧进程。这类「环境问题伪装成产品失败」在本项目
    已出现三次，所以做成硬预检：指纹不符直接拒绝出结论。

    返回空串 = 通过；非空 = 拒绝原因。
    """
    try:
        _get(base, "/api/health", timeout=6)
    except Exception as e:
        return f"后端不可达：{e}\n     先启动：python server/app.py"
    try:
        d = _post(base, "/api/chat", {"q": _PREFLIGHT_Q, "user_id": "u-preflight",
                                      "session_id": f"s-preflight-{int(time.time())}"})
    except Exception as e:
        return f"指纹请求失败：{e}"
    if "tools" not in d or "request_id" not in d:
        return ("后端是**旧版本**（响应缺 tools/request_id 字段）→ 本次结果不可信。\n"
                "     旧进程占着 8000 时新进程会 bind 失败、但看起来一切正常，"
                "请先停掉占用者再启动当前代码。")
    return ""


def load_golden(version="v1", private=False):
    """读黄金集。private=True 时追加 golden_private_{version}.jsonl
    （Kaggle 公私榜机制：私有集默认不跑、不进调参视野，release 前才跑）。"""
    files = [os.path.join(ROOT, "evals", "golden", f"golden_{version}.jsonl")]
    if private:
        p = os.path.join(ROOT, "evals", "golden", f"golden_private_{version}.jsonl")
        if os.path.exists(p):
            files.append(p)
    items = []
    for path in files:
        items += [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]
    return items


def suite_l1(base, run_id="run", items=None):
    """检索层评测（免费）。返回 (per_task, metrics)

    `run_id` 进 session id：每次运行的模板直答题都要从干净会话开始，
    否则上一轮的历史会污染这一轮（同 l3 的纪律）。
    """
    items = items if items is not None else load_golden()
    per, t0 = [], time.time()
    # 🔴 门禁只统计 split=regression（真值硬、可本地校验）；
    #    capability（期望较软，如主题召回）单独记录为观察值，**不参与门禁** ——
    #    否则软期望的噪声会伪装成产品退步（2026-09-18 首跑就踩到这条）。
    hits5 = mrr_sum = n_doc = 0
    c_hits5 = c_n_doc = 0
    ent_ok = ent_n = 0
    tpl_ok = tpl_n = 0
    forbidden = []

    for it in items:
        q = it["q"]
        gated = it["split"] == "regression"
        rec = {"id": it["id"], "q": q, "src": it["src"],
               "class": it["class"], "split": it["split"]}
        enc = urllib.parse.quote(q)
        # ① 图谱实体召回
        ent = (it.get("expect") or {}).get("entity")
        if ent:
            ent_n += 1
            try:
                r = _get(base, f"/api/poi?q={enc}&k=5")
                names = [x["name"] for x in r.get("results", [])]
                ok = ent in names
                rec["entity_hit"] = ok
                rec["entity_top5"] = names
                ent_ok += ok
            except Exception as e:
                rec["entity_hit"] = None
                rec["error"] = str(e)
        # ② 文档召回
        docs = (it.get("expect") or {}).get("docs") or []
        if docs:
            if gated:
                n_doc += 1
            else:
                c_n_doc += 1
            try:
                r = _get(base, f"/api/search?q={enc}&k=5")
                titles = [x["title"] for x in r.get("results", [])]
                rank = next((i + 1 for i, t in enumerate(titles)
                             if any(d == t or d in t or t in d for d in docs)), 0)
                rec["doc_rank"] = rank
                rec["docs_top5"] = titles
                if gated:
                    hits5 += 1 if rank else 0
                    mrr_sum += (1.0 / rank) if rank else 0.0
                else:
                    c_hits5 += 1 if rank else 0
            except Exception as e:
                rec["doc_rank"] = None
                rec["error"] = str(e)
        # ③ 模板直答正确性（存在性正例：应 0 LLM 走模板）
        if it["split"] == "regression" and it["kind"] in ("exists", "where", "hours") \
                and it["src"] != "brand_absent":
            tpl_n += 1
            try:
                d = _post(base, "/api/chat", {"q": q, "user_id": "u-eval",
                                              "session_id": f"s-eval-{run_id}-{it['id']}"})
                ans = d.get("answer", "")
                mi = it["expect"].get("must_include") or []
                bad = [k for k in (it["expect"].get("must_not_include") or []) if k in ans]
                good = (d.get("mode") == "template" and not bad
                        and any(k in ans for k in mi) if mi else d.get("mode") == "template")
                rec.update({"mode": d.get("mode"), "tools": d.get("tools"),
                            "answer": ans[:200], "template_ok": bool(good)})
                tpl_ok += bool(good)
                if bad:
                    forbidden.append({"id": it["id"], "q": q, "hit": bad})
            except Exception as e:
                rec["template_ok"] = None
                rec["error"] = str(e)
        per.append(rec)

    m = {"n": len(items), "entities": ent_n, "docs": n_doc, "templates": tpl_n,
         "entity_recall": round(ent_ok / ent_n, 4) if ent_n else 1.0,
         "template_acc": round(tpl_ok / tpl_n, 4) if tpl_n else 1.0,
         "recall@5": round(hits5 / n_doc, 4) if n_doc else 1.0,
         "mrr": round(mrr_sum / n_doc, 4) if n_doc else 1.0,
         # 观察值（capability，不门禁）：soft 期望的召回情况
         "obs_cap_recall@5": round(c_hits5 / c_n_doc, 4) if c_n_doc else None,
         "obs_cap_docs": c_n_doc,
         "forbidden_hits": len(forbidden), "forbidden": forbidden,
         # 静默降级信号：DeepSeek 402/限流时会静默降级 extractive 且不报错——
         # 分数漂移时先归因这里（配 attribution 块一起看）
         "llm_fallback_hits": sum(1 for r in per if r.get("mode") == "extractive"),
         "sec": round(time.time() - t0, 1)}
    return per, m


_LEAK = ["【人设内核】", "【回答铁律】", "【本轮依据】", "【用户档案】", "【校园资讯】"]
_DENY = re.compile(r"(没有|没|无此|查无|并没有|不确定|没查到|没收录|未收录|没搜到|不卖)")
_FAKE_POS = re.compile(r"(在|位于|就在).{0,10}(楼|层|食堂|超市|店|驿站)")
_BRAND_RE = re.compile(r"(瑞幸|星巴克|肯德基|库迪|蜜雪冰城|喜茶|必胜客|海底捞|罗森|711)")
_LOC_WORD = re.compile(r"(楼|层|食堂|超市|店|驿站|号|路上|旁边|对面|门口)")


def _honest_about(brand, answer):
    """诚实性断言：**归属判定**，不是同句共现（2026-09-18 两次改进的最终形态）。

    踩坑史（值得记住，别退回旧版）：
      ① 只查全局否定词 → 「也**没**星巴克」被判不诚实（假红）
      ② 改成"同句含实体+方位词就判编造" → 诚实回答里「没查到瑞幸嗷，只翻到一家
         『1906咖啡厅』（军工路516号…）」把**替代地点的地址**算到了瑞幸头上（又假红）
    正确定义：**方位词必须贴着品牌**才算给它编位置；
      ① 编造 = 「在/就在…+品牌」 或 「品牌 + ≤10 字内出现 楼/食堂/号/门口…」
      ② 本轮确实否定了 = 否定词与品牌相邻（≤6 字窗口）
      两条同时满足才判"如实说没有"。
    """
    a = answer or ""
    b = re.escape(brand)
    # ① 编造（从严）：方位词必须**贴着品牌**才算给它编位置
    fab = re.compile(rf"(?:(?:在|位于|就在|开在)[^，。；！？\n]{{0,6}}{b})"
                     rf"|(?:{b}[^，。；！？\n]{{0,10}}(?:楼|层|食堂|超市|便利店|驿站|号|校内|门口|对面|旁边))")
    # ② 否定（从宽）：全篇有否定或对冲表述即可 —— 真实回答的否定常在前一分句
    #    （「图谱可能没收录全，星巴克说不定在校外」），贴邻窗口吃不到，属正常表达
    #    而非不诚实。真正的红线在 ①，所以 ① 严 ② 宽 是正确配比。
    neg = re.compile(rf"(没有|没|未收录|查无|没查到|没搜到|没收录|不确定|说不定|"
                     rf"不排除|未必|可能在校外|建议.{0,6}搜)")
    return (not fab.search(a)) and bool(neg.search(a))


def load_l3():
    path = os.path.join(ROOT, "evals", "tasks", "l3_scenarios.jsonl")
    return [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]


def _check_scenario(sc, base, trial, run_id):
    """跑一个多轮场景，返回 (是否通过, 明细)。**终态断言，不锁路径。**

    `run_id` 进 session id：每个 trial 必须从**干净环境**开始（Anthropic 评测纪律）。
    2026-09-18 实测教训：session 跨运行复用 → 上一轮的 Q&A 留在记忆里，
    会把这一轮的实体解析带跑偏（「瑞幸」被上轮回答里的「1906」顶掉），测出假红。
    """
    exp = sc.get("expect") or {}
    sid = f"s-l3-{run_id}-{sc['id']}-{trial}"
    turns, detail = [], {"id": sc["id"], "class": sc["class"], "split": sc["split"],
                         "trial": trial, "turns": []}
    for i, q in enumerate(sc["turns"], 1):
        try:
            d = _post(base, "/api/chat", {"q": q, "user_id": sc["user"],
                                          "session_id": sid})
        except Exception as e:
            detail["turns"].append({"q": q, "error": str(e)})
            return False, detail
        rec = {"q": q, "mode": d.get("mode"), "tools": d.get("tools"),
               "used_space": d.get("used_space"), "answer": d.get("answer", "")}
        turns.append(rec)
        detail["turns"].append({**rec, "answer": rec["answer"][:160]})

    final = turns[-1]["answer"]
    reasons = []
    leaked = [m for m in _LEAK if any(m in t["answer"] for t in turns)]
    if leaked:
        reasons.append(f"泄露 prompt 标记 {leaked}")
    mi = exp.get("must_include_final") or []
    if mi and not any(k in final for k in mi):
        reasons.append(f"终轮未含任一 {mi}")
    mn = [k for k in (exp.get("must_not_include_final") or []) if k in final]
    if mn:
        reasons.append(f"终轮出现禁止词 {mn}")
    if exp.get("mode_all"):
        bad = [t["mode"] for t in turns if t["mode"] not in exp["mode_all"]]
        if bad:
            reasons.append(f"mode 不在期望集（{bad}）")
    if exp.get("used_space_final") is not None and \
            bool(turns[-1]["used_space"]) != bool(exp["used_space_final"]):
        reasons.append(f"终轮 used_space={turns[-1]['used_space']} 与期望不符")
    for idx in (exp.get("honesty_turns") or []):
        a, qq = turns[idx - 1]["answer"], turns[idx - 1]["q"]
        mb = _BRAND_RE.search(qq)
        if mb:
            if not _honest_about(mb.group(1), a):
                reasons.append(f"第 {idx} 轮未如实说没有『{mb.group(1)}』（诚实性断言）")
        elif not _DENY.search(a) or _FAKE_POS.search(a):
            reasons.append(f"第 {idx} 轮未如实说没有（诚实性断言）")

    detail["reasons"] = reasons
    detail["final"] = final[:160]
    return not reasons, detail


def suite_l3(base, repeat=1, run_id="run"):
    """对话级套件：多轮 + 终态断言 + pass^k（k 次全对）。花钱档。"""
    scs = load_l3()
    per, ok_reg, n_reg, cap_ok, n_cap = [], 0, 0, 0, 0
    for sc in scs:
        trials, results = (repeat if sc["split"] == "regression" else 1), []
        all_pass = True
        for t in range(1, trials + 1):
            ok, detail = _check_scenario(sc, base, t, run_id)
            results.append(detail)
            all_pass &= ok
            mark = "✅" if ok else "❌"
            print(f"  {mark} {sc['id']}（{sc['class']}）trial {t}/{trials}"
                  + ("" if ok else "  ← " + "；".join(detail["reasons"])[:110]))
        pass_any = any(not d["reasons"] for d in results)
        if sc["split"] == "regression":
            n_reg += 1
            ok_reg += bool(all_pass)
        else:
            n_cap += 1
            cap_ok += bool(pass_any)
        per.append({"id": sc["id"], "class": sc["class"], "split": sc["split"],
                    "pass_all_k": all_pass, "pass_any": pass_any,
                    "k": trials, "trials": results})
    m = {"scenarios": len(scs), "regression_n": n_reg,
         "pass^k": round(ok_reg / n_reg, 4) if n_reg else None,
         "capability_pass@1": round(cap_ok / n_cap, 4) if n_cap else None,
         "llm_fallback_hits": sum(1 for r in per for t in r["trials"]
                                  for tn in t["turns"] if tn.get("mode") == "extractive")}
    return per, m


def suite_engine(runs=5):
    """排程引擎独立验收（CY 侧，不依赖 B 自己的测试通过与否）。

    为什么单独一层：引擎的实现归 B，**验收不该也交出去** —— `evals/engine/acceptance.ts`
    用自己的尺子查不变量（几何/不重叠/课程不漏/转场合规/确定性），
    只借 B 的冻结语料与引擎入口。B 每次「优化」推过来，跑这一条就能回答
    「有没有变快、有没有排崩、转场还对不对」。
    """
    out = os.path.join(RUNS_DIR, f"engine_{time.strftime('%H%M%S')}.json")
    cmd = ('node --import ./scripts/register-alias.mjs evals/engine/acceptance.ts '
           f'--runs {max(2, runs)} --json "{out}"')
    rc, txt, sec = sh(cmd)
    for line in txt.strip().splitlines()[-6:]:
        print("   " + line)
    m, tasks = {}, []
    try:
        data = json.load(open(out, encoding="utf-8"))
        t = data.get("totals", {})
        m = {"engine_violations": t.get("violations"),
             "engine_hard_issues": t.get("hardIssues"),
             "engine_tight_transfers": t.get("tightTransfers"),
             "engine_transfers_seen": t.get("transfersSeen"),
             "engine_determinism": 1.0 if t.get("determinism") else 0.0}
        tasks = [{k: v for k, v in r.items() if k != "metrics"} | {"metrics": r.get("metrics")}
                 for r in data.get("results", [])]
    except Exception as e:
        print(f"   ⚠️ 解析引擎报告失败：{e}")
        m = {"engine_violations": None}
    return tasks, m, rc, round(sec, 1)


def suite_e2e(base):
    """端到端（花钱档）：全量 golden 过对话，规则判分（规则档免费，裁判档 P1）"""
    items = load_golden()
    per, ok_n = [], 0
    for it in items:
        try:
            d = _post(base, "/api/chat", {"q": it["q"], "user_id": "u-e2e",
                                          "session_id": f"s-e2e-{it['id']}"})
            ans = d.get("answer", "")
            mi = it["expect"].get("must_include") or []
            mn = it["expect"].get("must_not_include") or []
            bad = [k for k in mn if k in ans]
            good = (not bad) and (not mi or any(k in ans for k in mi))
            if it["kind"] == "absent":
                neg = re.search(r"(没有|没得|查无|并没有|不确定|没查到)", ans)
                good = bool(neg) and not re.search(r"(在.{0,8}(楼|食堂|超市|店))", ans)
            per.append({"id": it["id"], "q": it["q"], "ok": good, "mode": d.get("mode"),
                        "tools": d.get("tools"), "raw": d.get("top_raw_vec"),
                        "answer": ans[:160], "bad": bad})
            ok_n += bool(good)
        except Exception as e:
            per.append({"id": it["id"], "q": it["q"], "ok": False, "error": str(e)})
    return per, {"n": len(items), "acc": round(ok_n / len(items), 4) if items else 0.0,
                 "llm_fallback_hits": sum(1 for r in per if r.get("mode") == "extractive")}


# 这些是「计数/耗时」不是质量指标：变快/变少不代表退步，只印 Δ 不报警告。
# （第一版把它们一起当质量指标，结果「跑得更快」被标成 ⚠️ 退步 —— 门禁的显示逻辑也要被检视。）
_NO_WARN = {"sec", "n", "entities", "docs", "templates", "obs_cap_docs",
            "engine_transfers_seen", "engine_hard_issues", "engine_tight_transfers"}


def compare_baseline(metrics):
    if not os.path.exists(BASE_LINE):
        return ["（无基线，本次可作基线：--update-baseline）"]
    old = json.load(open(BASE_LINE, encoding="utf-8")).get("metrics", {})
    lines = []
    for k, v in metrics.items():
        if isinstance(v, (int, float)) and k in old:
            d = round(v - old[k], 4)
            arrow = "→" if d == 0 else ("↑" if d > 0 else "↓")
            flag = "" if (d >= 0 or k in _NO_WARN) else "  ⚠️ 退步"
            lines.append(f"   {k:<14} {old[k]} {arrow} {v}{flag}")
    return lines or ["（基线里没有可比指标）"]


def build_attribution():
    """评测归因块：**分数漂移但代码没变时，先归因「评测器 or 模型 or 数据」。**

    依据：Chen/Zaharia/Zou（arXiv:2307.09009）证明 API 模型行为会随时间剧烈漂移，
    业界惯例是 pin 模型快照 + 记录 provider。本项目已真实踩过
    「DeepSeek 402 → 静默降级 extractive」——/api/health 的 llm:true 不等于有钱。
    ⚠️ 只记录键名与**非敏感**字段；API Key 本身绝不落盘。
    """
    att = {"llm_provider": None, "llm_model": None, "llm_key_configured": False,
           "python": sys.version.split()[0], "platform": sys.platform}
    envp = os.path.join(ROOT, "server", ".env")
    if os.path.exists(envp):
        for line in open(envp, encoding="utf-8", errors="replace"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = (x.strip() for x in line.split("=", 1))
            ku = k.upper()
            if ku in ("LLM_PROVIDER", "LLM_BASE_URL") and not att["llm_provider"]:
                att["llm_provider"] = v
            elif ku in ("LLM_MODEL", "DEEPSEEK_MODEL") and not att["llm_model"]:
                att["llm_model"] = v
            elif ku in ("LLM_API_KEY", "DEEPSEEK_API_KEY", "API_KEY"):
                att["llm_key_configured"] = bool(v)
    return att


def main():
    ap = argparse.ArgumentParser(description="梨宝评测台架")
    ap.add_argument("--suite", default="all", choices=["l0", "l1", "l3", "engine", "e2e", "all"])
    ap.add_argument("--repeat", type=int, default=1,
                    help="l3：每个回归场景的试次 k（pass^k = k 次全对），默认 1（省钱）")
    ap.add_argument("--base", default=os.environ.get("LIBAO_BASE", "http://127.0.0.1:8000"))
    ap.add_argument("--gate", action="store_true", help="按门禁阈值设退出码")
    ap.add_argument("--update-baseline", action="store_true")
    ap.add_argument("--include-private", action="store_true",
                    help="额外跑 golden_private（私有集，release 前用；默认不跑、不进调参视野）")
    args = ap.parse_args()
    base = args.base.rstrip("/")
    ts = time.strftime("%Y%m%d-%H%M%S")
    result = {"ts": ts, "base": base, "suite": args.suite,
              "attribution": build_attribution(), "metrics": {}, "tasks": []}
    fails = []

    print(f"🧪 梨宝评测 · suite={args.suite} · 后端 {base}\n")
    if args.suite in ("l0", "all"):
        print("== L0 确定性套件（双端 · 0 成本 · 门禁 100%）==")
        rows = suite_l0()
        result["l0"] = rows
        bad = [r["name"] for r in rows if r["rc"] != 0]
        result["metrics"]["l0_all_pass"] = 1.0 if not bad else 0.0
        if bad:
            fails.append(f"L0 套件未全绿：{bad}")
        print()

    if args.suite in ("l1", "all"):
        print("== L1 检索层评测（0 成本 · 需后端活着）==")
        warn = _preflight(base)
        if warn:
            print(f"  ❌ {warn}")
            return 2
        if not args.include_private:
            priv_n = sum(1 for i in load_golden(private=True) if i["split"] != "regression")
            if priv_n:
                print(f"  🔒 private 集 {priv_n} 条未跑（release 前 --include-private；不进调参视野）")
        per, m = suite_l1(base, run_id=ts, items=load_golden(private=args.include_private))
        result["tasks"] = per
        result["metrics"].update(m)
        print(f"  用例 {m['n']} 条｜实体召回 {m['entity_recall']}"
              f"（{m['entities']} 题）｜模板直答 {m['template_acc']}（{m['templates']} 题）")
        print(f"  门禁档文档 recall@5 {m['recall@5']}｜MRR {m['mrr']}（{m['docs']} 题）"
              f"｜违禁词命中 {m['forbidden_hits']}｜{m['sec']}s")
        if m.get("obs_cap_recall@5") is not None:
            print(f"  观察档（capability，不门禁）recall@5 {m['obs_cap_recall@5']}"
                  f"（{m['obs_cap_docs']} 题，软期望）")
        for g, thr in GATES.items():
            v = m.get(g)
            if v is None:
                continue
            good = (v >= thr) if g != "forbidden_hits" else (v <= thr)
            print(f"   {'✅' if good else '❌'} 门禁 {g} = {v}（要求 {'≥' if g!='forbidden_hits' else '≤'} {thr}）")
            if not good:
                fails.append(f"{g}={v} 未达门禁 {thr}")
        if m["forbidden"]:
            for f in m["forbidden"][:5]:
                print(f"      🔴 违禁词：{f['q']} → {f['hit']}")
        print()

    if args.suite in ("l3",):
        print(f"== L3 对话级套件（花钱档 · pass^{args.repeat}）==")
        warn = _preflight(base)
        if warn:
            print(f"  ❌ {warn}")
            return 2
        per, m = suite_l3(base, repeat=max(1, args.repeat), run_id=ts)
        result["tasks"] = per
        result["metrics"].update(m)
        print(f"  场景 {m['scenarios']} 个｜回归 {m['regression_n']} 个"
              f"｜**pass^{args.repeat} = {m['pass^k']}**"
              + (f"｜capability pass@1 = {m['capability_pass@1']}" if m['capability_pass@1'] is not None else ""))
        if args.gate and m["pass^k"] is not None and m["pass^k"] < 1.0:
            fails.append(f"l3 pass^{args.repeat}={m['pass^k']} < 1.0（对用户可见路径必须每次都对）")
        print()

    if args.suite in ("engine", "all"):
        print("== 引擎独立验收（CY 侧口径 · 0 成本 · 需 node）==")
        tasks, m, rc, sec = suite_engine()
        result["tasks"] = tasks
        result["metrics"].update(m)
        v = m.get("engine_violations")
        slow = sum(1 for t in (tasks or []) if (t.get("metrics") or {}).get("slow"))
        m["engine_slow_scenarios"] = slow
        print(f"  不变量违反 {v}｜硬约束 issues {m.get('engine_hard_issues')}"
              f"｜转场 {m.get('engine_transfers_seen')}（紧 {m.get('engine_tight_transfers')}）"
              f"｜确定性 {m.get('engine_determinism')}｜p95 超基线 50%+ 的场景 {slow}｜{sec}s")
        if slow:
            print(f"     ⚠️ 引擎变慢：{slow} 个场景 p95 高于基线 50%（噪声大，定论看 p50 或 --runs 9）")
        if rc != 0 or (v or 0) > 0:
            fails.append(f"引擎不变量违反 {v} 处（rc={rc}）")
        print()

    if args.suite == "e2e":
        print("== E2E 对话评测（花钱档）==")
        per, m = suite_e2e(base)
        result["tasks"] = per
        result["metrics"].update(m)
        print(f"  准确率 {m['acc']}（{m['n']} 条）")

    fb = result["metrics"].get("llm_fallback_hits") or 0
    if fb:
        print(f"\n⚠️ 静默降级信号：{fb} 轮回答 mode=extractive（Key 欠费/被限流时静默降级）"
              f"—— 分数漂移先归因这里与 attribution 块")

    # 不可归因扫描：历史 run 缺 attribution 字段 = 那次分数出了问题无法归因
    prev_runs = sorted(glob.glob(os.path.join(RUNS_DIR, "run_*.json")))[-30:]
    unattr = []
    for p in prev_runs:
        try:
            if not json.load(open(p, encoding="utf-8")).get("attribution"):
                unattr.append(os.path.basename(p))
        except Exception:
            pass
    if unattr:
        print(f"⚠️ 不可归因：{len(unattr)} 份历史 run 缺 attribution 字段（本地产物可删；"
              f"例：{unattr[:3]}）")

    print("== 与基线对比 ==")
    for line in compare_baseline(result["metrics"]):
        print(line)

    os.makedirs(RUNS_DIR, exist_ok=True)
    out = os.path.join(RUNS_DIR, f"run_{ts}.json")
    json.dump(result, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if args.update_baseline:
        json.dump({"ts": ts, "metrics": result["metrics"]},
                  open(BASE_LINE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"\n📌 基线已更新：{BASE_LINE}")
    print(f"明细：{out}")

    if args.gate and fails:
        print("\n🚫 门禁未通过：")
        for f in fails:
            print("   ❌", f)
        return 1
    if args.gate:
        print("\n✅ 门禁全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
