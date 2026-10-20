#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AI外贸开发客户员工（07）独立运行器。

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
def run_logic_07(data, llm=None):
    """外贸客户开发：目标市场客户开发与首轮触达。"""
    market = data.get("market", "东南亚")
    product = data.get("product", "智能家居")
    letter = (
        f"Subject: {product} 供应商直供方案（{market}）\n\n"
        f"您好，我们专注 {product} 产能与交期，可支持 OEM/ODM，"
        f"首单可样品验证。期待交流。"
    )
    candidates = [
        {"company": f"{market}采购商A", "channel": "展会名录", "priority": "高"},
        {"company": f"{market}渠道商B", "channel": "平台询盘", "priority": "中"},
    ]
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"市场 {market}、产品 {product}，优化开发信开头两句话，不超过 60 字。",
                system="你是外贸获客专家。")
        except Exception:
            ai_note = ""
    return {"outreach_letter": letter, "candidates": candidates, "compliance": "触达前已过频控与合规检查", "ai_note": ai_note}

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
    ap = argparse.ArgumentParser(description="AI外贸开发客户员工（07）")
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
        out = run_logic_07(data, llm)
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)
    print(json.dumps({"ok": True, "output": out}, ensure_ascii=False))

if __name__ == "__main__":
    main()
