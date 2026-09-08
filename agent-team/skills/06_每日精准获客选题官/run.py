#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""每日精准获客选题官（06）独立运行器。

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


def run_logic_06(data, llm=None):
    """每日精准获客选题：按目标客户画像与热点生成选题。"""
    persona = data.get("persona", "工厂老板")
    hot_topics = data.get("hot_topics") or ["AI 获客", "降本增效"]
    topics = [
        {"title": f"AI 如何帮{persona}每天自动获客", "direction": "痛点切入", "reason": f"结合热点「{hot_topics[0]}」"},
        {"title": "一人公司怎么养 17 个 AI 员工", "direction": "案例教学", "reason": "差异化稀缺选题"},
        {"title": "评论区才是最大的金矿", "direction": "方法拆解", "reason": f"呼应热点「{hot_topics[-1]}」"},
    ]
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"画像：{persona}；热点：{hot_topics}。补充 1 个更高转化率的选题，不超过 60 字。",
                system="你是短视频选题策划专家。")
        except Exception:
            ai_note = ""
    return {"date": _ts()[:10], "topics": topics, "ai_note": ai_note}

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
    ap = argparse.ArgumentParser(description="每日精准获客选题官（06）")
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
        out = run_logic_06(data, llm)
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)
    print(json.dumps({"ok": True, "output": out}, ensure_ascii=False))

if __name__ == "__main__":
    main()
