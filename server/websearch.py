# -*- coding: utf-8 -*-
"""梨宝 · L3 联网搜索（agent 的最后一件工具）
================================================
只在「资讯库 + 校园图谱都查不到」时才会被调用（见 agent.py 的三道锁）。

数据源取舍：
  · Tavily —— 有 `TAVILY_API_KEY` 时首选：专为 LLM 设计，直接返回摘要，省一次抓取。
  · cn.bing.com 结果页抓取 —— 无 Key 时的兜底，国内直连可达（无需代理）。
两条链路都失败就**返回空**，让 agent 走「诚实认账 + 指官方渠道」，
绝不允许把抓取失败编成「网上说没有」。

开关：`LIBAO_WEBSEARCH=0` 一键关闭（演示/断网时用），关闭后本模块恒返回 []。
"""
import html as _html
import json
import os
import re
import urllib.parse
import urllib.request

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/122.0 Safari/537.36")
_OFF = ("0", "false", "no", "off")


def enabled():
    return os.environ.get("LIBAO_WEBSEARCH", "1").strip().lower() not in _OFF


def _strip_tags(s):
    return _html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def _tavily(q, k, timeout):
    key = os.environ.get("TAVILY_API_KEY", "").strip()
    if not key:
        return []
    req = urllib.request.Request(
        "https://api.tavily.com/search",
        data=json.dumps({"api_key": key, "query": q, "max_results": k,
                         "search_depth": "basic"}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read().decode("utf-8"))
    out = []
    for it in (data.get("results") or [])[:k]:
        out.append({"title": (it.get("title") or "")[:120],
                    "url": it.get("url") or "",
                    "snippet": (it.get("content") or "")[:300],
                    "provider": "tavily"})
    return out


def _bing_cn(q, k, timeout):
    """无 Key 兜底：抓 cn.bing.com 的 HTML 结果页（只取标题/链接/摘要）。"""
    url = "https://cn.bing.com/search?q=" + urllib.parse.quote(q) + f"&count={k}"
    req = urllib.request.Request(url, headers={"User-Agent": _UA,
                                               "Accept-Language": "zh-CN,zh;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        page = r.read().decode("utf-8", "ignore")
    out = []
    for m in re.finditer(r'<li class="b_algo".*?</li>', page, re.S):
        blk = m.group(0)
        a = re.search(r'<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', blk, re.S)
        if not a:
            continue
        snip = re.search(r"<p[^>]*>(.*?)</p>", blk, re.S)
        out.append({"title": _strip_tags(a.group(2))[:120],
                    "url": _html.unescape(a.group(1)),
                    "snippet": _strip_tags(snip.group(1))[:300] if snip else "",
                    "provider": "bing"})
        if len(out) >= k:
            break
    return out


def web_search(q, k=5, timeout=8):
    """联网检索 → [{title,url,snippet,provider}]；关闭 / 失败 / 无结果 → []"""
    q = (q or "").strip()
    if not q or not enabled():
        return []
    for fn in (_tavily, _bing_cn):
        try:
            out = fn(q, k, timeout)
        except Exception as e:
            print(f"[websearch] {fn.__name__} 失败：{e}")
            continue
        if out:
            return out
    return []
