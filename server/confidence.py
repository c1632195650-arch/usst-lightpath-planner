# -*- coding: utf-8 -*-
"""
梨宝回答置信度 · 四态分级（F2/B2，2026-10-24）
================================================
「懂分寸」的可见化：每条回答如实标注依据强度。server 端**一处计算**（口径不分叉），
前端只做呈现（src/components/ui/confidenceModel.ts 的文案映射，两端同步改）。

四态（与 docs/new-features-tech-plans-2026-10-24.md F2 映射表一致）：
  cited       ✅ 依据校园公开信息 —— grounded 且相关性门通过（或纯原文抽取无推断）
  inferred    ⚠️ 部分为梨宝的推断 —— hybrid（官方资讯+常识混合）、门判存疑、agent 自查
  structured  🧩 来自校内数据 —— L0 模板 / 空间图谱 / 方法库 / 健康库直出
  none        ❌ 没查到可靠依据 —— 空问句或知识库边界外

纯函数、零第三方依赖 —— server/tests/test_chat_confidence.py 直接 import 本模块，
不拉起 fastapi/rag 等重依赖。
"""


def compute_confidence(route, mode, relevance, n_sources,
                       used_space=False, used_study=False, used_health=False,
                       study_pseudo=False, tools_used=False, stale_used=False):
    """依据 _chat_core 已算出的观测信号算四态置信度。这里零检索、零 LLM 调用。

    入参：
      route       grounded / hybrid / llm / empty（规则路由判定结果）
      mode        template / llm / extractive / ''（empty 早退时无 mode）
      relevance   'ok' / 'irrelevant_downgraded' / None（D5 门观测；None=门不可用）
      n_sources   本轮挂给前端的资讯来源条数（模板答会故意置空）
      used_*      空间 / 方法库 / 健康库是否命中注入
      study_pseudo 伪科学纠正口径是否命中（确定性文案）
      tools_used  L2 agent 是否动用了自查工具（poi/联网等）
      stale_used  W7（C2）：本轮 sources 是否含 effective_to 已过期的条目——
                  过期来源按「含推断」降级（诚实：官方口径可能已变）
    """
    if route == "empty":
        return {"level": "none", "reason": "没有可判定的问题内容"}
    # 结构化直出第一优先：L0 模板（图谱拼答案，sources 已置空）——它不依赖资讯检索，
    # D5 门判掉的资讯证据不影响图谱数据的确定性。
    if mode == "template":
        return {"level": "structured", "reason": "来自校内空间与图谱数据"}
    # D5 门判「检索证据与问题不是同一件事」→ 空间/知识库/来源旗标再亮也不能标
    # structured（2026-10-24 部署验收实测抓到：宇宙尽头类问题模糊命中空间图谱、
    # 门降级后 used_space 仍为 true）。诚实口径 = 含推断。
    if relevance == "irrelevant_downgraded":
        return {"level": "inferred", "reason": "证据相关性存疑，仅供参考，建议以官方信息为准"}
    # W7：含过期来源（effective_to < today）—— structured/cited 一律降 inferred，
    # 理由明说「可能已过期」（角标同步呈现）。模板答不受影响（sources 为空不会传 stale）。
    if stale_used and mode != "template":
        return {"level": "inferred", "reason": "部分来源可能已过期，建议以最新官方通知为准"}
    # 结构化直出：空间上下文、方法库/健康库的确定性口径
    if used_space:
        return {"level": "structured", "reason": "来自校内空间与图谱数据"}
    if used_study or used_health or study_pseudo:
        return {"level": "structured", "reason": "来自校内方法/健康知识库"}
    if n_sources >= 1:
        # cited 锚定两种形态：① grounded（高置信命中 + 事实型提问），门判相关
        # （或门不可用但强命中）；② extractive 纯原文抽取 —— 没有模型"推断"成分。
        # ⚠️ hybrid 即使门判 ok 也是 inferred：官方资讯 + LLM 常识混合，来源卡
        #    撑不起"整条回答都有据"（工作单 F2 映射表第二行）。
        if route == "grounded" and relevance in ("ok", None):
            return {"level": "cited", "reason": "依据校园公开信息"}
        if mode == "extractive" and relevance != "irrelevant_downgraded":
            return {"level": "cited", "reason": "依据校园公开信息"}
        # hybrid / 门判存疑的其余形态 —— 诚实标注"部分为推断"
        return {"level": "inferred", "reason": "部分为梨宝的推断，建议以官方通知为准"}
    # 没有资讯来源、也没进任何结构化库：agent 动用过自查工具的至少算"推断"，
    # 什么都没有就是边界外的诚实口径。
    if tools_used:
        return {"level": "inferred", "reason": "梨宝自查得到，建议以官方通知为准"}
    return {"level": "none", "reason": "没查到可靠依据"}


def compute_kb(used_space, used_study, used_health):
    """本轮答案主要依据的校内结构化库标记（前端据此把来源标成"校内知识库"）。

    多库并发命中时按 space > method > health 取主 —— 展示用主标记，不追求穷举
    （used_space/used_study/used_health 三个布尔字段仍在响应里，可精确观测）。
    'none' = 仅资讯库或无依据。
    """
    if used_space:
        return "space"
    if used_study:
        return "method"
    if used_health:
        return "health"
    return "none"
