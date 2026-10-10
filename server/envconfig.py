# -*- coding: utf-8 -*-
"""
server 共用环境配置（维护批 P1-10，2026-10-11）
================================================
此前 `_load_env` 在 app.py / memory.py / plan_dialog.py 三处各有一份手抄实现
（维护计划红旗 S9：三份实现易在重构时各自漂移——例如某份改了注释规则另两份没跟）。
本模块是唯一事实来源：同一段解析语义（KEY=VALUE、# 注释、setdefault 尊重已设变量），
三处调用同一实现。零第三方依赖。
"""
import os


def load_env(path) -> None:
    """逐行加载 KEY=VALUE 文件。幂等、可重复调用：
    · 已存在于 os.environ 的变量**优先于文件**（setdefault）—— 显式配置不被文件覆盖；
    · 空行与 # 开头注释跳过；值可含等号（split 一次）。"""
    if not path or not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def load_server_env() -> None:
    """加载 server/.env（唯一入口）。"""
    load_env(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))


def llm_settings() -> tuple:
    """读取 LLM 三件套，返回 (base_url, api_key, model)。
    Key 只从环境变量/server/.env 读，任何 Key 不进仓库/日志（既有红线）。"""
    return (
        os.environ.get("LLM_BASE_URL", "https://api.deepseek.com/v1").rstrip("/"),
        os.environ.get("LLM_API_KEY", ""),
        os.environ.get("LLM_MODEL", "deepseek-chat"),
    )
