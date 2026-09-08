#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""行业深度分析师（16）独立运行器。

由 feihongzhi_agents 导出：自包含、仅标准库，可被其他智能体直接调用或安装为 Skill。
用法：
    python3 run.py --input '{"field": "value"}'
    echo '{"field": "value"}' | python3 run.py
可选接入真实大模型（设置环境变量后加 --llm）：
    LLM_API_KEY=xxx LLM_MODEL=xxx LLM_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
    python3 run.py --llm --input '...'
"""
import argparse
import json
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime

# ------------------------- 内嵌核心逻辑（自动生成） -------------------------
def _ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def run_logic_16(data, llm=None):
    """行业深度分析：输出行业趋势与竞争格局。"""
    industry = data.get("industry", "企业服务")
    scope = data.get("scope", "国内")
    report = {
        "industry": industry,
        "scope": scope,
        "market_size": "示例口径：120 亿元（需以权威数据源校准）",
        "growth": "年增速约 18%",
        "competition": "格局分散，头部集中度提升中",
        "conclusion": "进入窗口期，建议聚焦细分场景建立壁垒",
        "data_note": "本报告为分析框架示意，关键数据需接入权威数据源后校准",
        "generated_at": _ts(),
    }
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"行业 {industry}、范围 {scope}，给 1 条最关键的竞争判断，不超过 60 字。",
                system="你是行业研究首席分析师。")
        except Exception:
            ai_note = ""
    return {"report": report, "ai_note": ai_note}

# ------------------------- 极简 LLM 客户端（可选） -------------------------
class _MiniLLM:
    provider = "doubao"
    def __init__(self):
        import os
        self.key = os.environ.get("LLM_API_KEY", "")
        self.model = os.environ.get("LLM_MODEL", "")
        self.base = os.environ.get("LLM_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3").rstrip("/")
        if not self.key or not self.model:
            raise RuntimeError("缺少 LLM_API_KEY / LLM_MODEL 环境变量")
    def complete(self, prompt, system=""):
        msgs = []
        if system:
            msgs.append({"role": "system", "content": system})
        msgs.append({"role": "user", "content": prompt})
        payload = {"model": self.model, "messages": msgs, "temperature": 0.7, "max_tokens": 1024}
        req = urllib.request.Request(
            self.base + "/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + self.key},
            method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise RuntimeError("LLM 调用失败 HTTP %s: %s" % (e.code, e.read().decode("utf-8", errors="ignore")[:200]))
        return body["choices"][0]["message"]["content"].strip()

def _load_input(args):
    if args.input:
        return json.loads(args.input)
    if not sys.stdin.isatty():
        raw = sys.stdin.read()
        if raw.strip():
            return json.loads(raw)
    return {}

def main():
    ap = argparse.ArgumentParser(description="行业深度分析师（16）")
    ap.add_argument("--input", help="JSON 输入，如 '{\"topic\": \"AI获客\"}'；或经 stdin 传入")
    ap.add_argument("--llm", action="store_true", help="启用真实大模型（需 LLM_API_KEY/LLM_MODEL 环境变量）")
    args = ap.parse_args()
    data = _load_input(args)
    llm = None
    if args.llm:
        try:
            llm = _MiniLLM()
        except Exception as e:
            print(json.dumps({"ok": False, "error": "LLM 初始化失败: " + str(e)}, ensure_ascii=False))
            sys.exit(1)
    try:
        out = run_logic_16(data, llm)
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)
    print(json.dumps({"ok": True, "output": out}, ensure_ascii=False))

if __name__ == "__main__":
    main()
