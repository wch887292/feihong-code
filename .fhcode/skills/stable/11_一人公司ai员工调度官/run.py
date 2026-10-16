#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一人公司AI员工调度官（11）独立运行器。

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


def run_logic_11(data, llm=None):
    """调度计划：按优先级与依赖生成执行顺序。"""
    tasks = data.get("tasks") or [
        {"module_id": "01", "task_type": "lead_scan", "priority": "P0"},
        {"module_id": "02", "task_type": "follow_up", "priority": "P0"},
        {"module_id": "04", "task_type": "chat_analysis", "priority": "P0"},
        {"module_id": "09", "task_type": "tiering", "priority": "P0"},
    ]
    order = sorted(tasks, key=lambda t: {"P0": 0, "P1": 1, "P2": 2, "P3": 3}.get(t.get("priority", "P1"), 1))
    schedule = {
        "order": [t["module_id"] for t in order],
        "dependency_rule": "前置任务 success 后触发后续任务",
        "retry_policy": "失败自动重试，上限 3 次，超限转 blocked 并告警",
        "human_gate": "涉及对外触达的任务在人工确认节点暂停",
        "estimated_minutes": len(order) * 3,
        "planned_at": _ts(),
    }
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"任务列表 {json.dumps(tasks, ensure_ascii=False)}，指出编排上的一个风险，不超过 50 字。",
                system="你是系统调度架构师。")
        except Exception:
            ai_note = ""
    return {"schedule": schedule, "ai_note": ai_note}

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
    ap = argparse.ArgumentParser(description="一人公司AI员工调度官（11）")
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
        out = run_logic_11(data, llm)
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)
    print(json.dumps({"ok": True, "output": out}, ensure_ascii=False))

if __name__ == "__main__":
    main()
