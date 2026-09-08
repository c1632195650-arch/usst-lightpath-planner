# -*- coding: utf-8 -*-
"""
公众号文本清洗（去引流尾巴 / 软广）
=====================================
共享模块：collector.py（标题级广告过滤）与 fulltext.py（正文级引流清洗）都 import 这里。
也可单独运行做「回溯清洗」：对已落库的 full_text 重新清洗，并重建 FTS5 + 向量索引。

用法：
    python scripts/clean_text.py      # 回溯清洗 DB 里的 full_text + 重建索引

设计原则：只删「引流/软广」特征，绝不误删正文信息。故：
  - 短行（≤80 字）含引流特征 → 整行删（引流尾巴几乎都是独立成行的短句）；
  - 长行（>80 字）→ 按句切分，只删命中的引流句，保留其余正文。
"""
import re, os, sys, sqlite3

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "..", "data", "usst_articles.db")

# ---- 引流尾巴关键词（字面包含，保守，只删短片段）----
AD_TAIL_KEYWORDS = [
    "扫码关注", "扫码添加", "扫码进群", "长按识别", "识别二维码",
    "后台回复", "回复关键词", "关注公众号", "关注我们", "点击上方蓝字",
    "添加微信", "加微信", "微信号", "进群", "加群", "入群", "群聊",
    "点赞在看", "点个在看", "在看点一点", "分享到",
    "活跃聚集地", "仅上理同学添加", "上理同学添加",
    "商务合作", "广告投放", "接广告", "合作联系", "联系方式",
    "最终解释权", "免责声明",
]

# ---- 引流尾巴正则（「回复 X 领取」类变体）----
AD_TAIL_REGEX = [
    r"回复[“\"']?.{0,8}?[”\"']?(领取|获取|下载|白嫖|免费|领)",
    r"后台回复.{0,10}(领取|获取|领)",
]

# ---- 标题级软广关键词（整篇过滤，命中即不入库）----
AD_TITLE_KEYWORDS = [
    "校园班", "招生啦", "兼职实习群", "拼团", "砍价", "微商", "代理",
    "福利领取", "关注有礼", "限时优惠", "课程报名", "培训班",
    # 引流/标题党软文（2026-09-08 扩充）
    "白嫖", "免费领", "扫码领", "扫码关注", "后台回复", "加微信",
    "内幕", "杀疯了", "震惊", "毁了我", "脱单计划", "压岁钱",
    "真题资料包", "转发领取", "集赞",
]

# ---- 低价值/娱乐营销关键词（不删，但标记 low_value=1 供检索降权）----
LOW_VALUE_KEYWORDS = [
    "脱单", "排行榜", "压岁钱", "吃瓜", "八卦", "吐槽", "测评",
]


def _is_ad_frag(s):
    """判断一个短文本片段是否含引流特征"""
    s = (s or "").strip()
    if not s:
        return False
    if any(k in s for k in AD_TAIL_KEYWORDS):
        return True
    if any(re.search(p, s) for p in AD_TAIL_REGEX):
        return True
    return False


def clean_ad_tails(text):
    """按行删引流尾巴；长行按句删引流句（避免误删正文）"""
    if not text:
        return text
    out = []
    for raw in (text or "").split("\n"):
        line = raw.strip()
        if not line:
            continue
        if len(line) <= 80:
            if _is_ad_frag(line):
                continue  # 短行整体是引流 → 删
            out.append(line)
        else:
            # 长行：按句切，只删命中的引流句
            sents = re.split(r"(?<=[。！？!?；;])", line)
            kept = "".join(s for s in sents if not _is_ad_frag(s))
            if kept.strip():
                out.append(kept.strip())
    return "\n".join(out).strip()


def is_ad_title(title):
    """标题级软广判定（整篇过滤）"""
    return any(k in (title or "") for k in AD_TITLE_KEYWORDS)


def is_low_value_title(title):
    """低价值/娱乐营销判定（不删，标记降权）"""
    return any(k in (title or "") for k in LOW_VALUE_KEYWORDS)


# ---------- 回溯清洗：对已落库全文重洗 + 重建索引 ----------
def reclean_db():
    conn = sqlite3.connect(DB_PATH)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(articles)")}
    if "full_text" not in cols:
        print("无 full_text 列，跳过")
        conn.close()
        return 0
    rows = conn.execute("SELECT id, full_text FROM articles").fetchall()
    changed = 0
    for aid, ft in rows:
        if not ft:
            continue
        cleaned = clean_ad_tails(ft)
        if cleaned != ft:
            conn.execute("UPDATE articles SET full_text=? WHERE id=?", (cleaned, aid))
            changed += 1
    conn.commit()
    # 全文变了 → 清空 seg_text，交给 rag.build() 重建分词与索引
    if "seg_text" in cols:
        conn.execute("UPDATE articles SET seg_text=NULL")
        conn.commit()
    conn.close()
    print(f"[回溯清洗] {changed} 篇正文被清理")
    return changed


if __name__ == "__main__":
    reclean_db()
    # 重建 FTS5 + 向量索引（分词列与全文已变）
    sys.path.insert(0, BASE)
    import rag
    print("[重建索引] 开始…")
    rag.build()
    print("✅ 清洗 + 重建索引完成")
