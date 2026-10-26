#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人：吴赐虹

桥接执行器：供「任务分发平台 → fhcode AI 员工军团」桥接调用。
在【同一个 Python 进程】内完成 submit + run_once，彻底规避跨进程 SQLite 竞态，
并读回任务最终状态与 output_json，供分发平台回传结果。

用法：
    python bridge_exec.py --module 12 --type manual --input '{"topic":"..."}' [--no-human-gate]

输出（stdout 首行 JSON）：
    {"ok": true, "task_id": "...", "status": "...", "output_json": {...}}
    失败时 {"ok": false, "error": "..."}
"""
import argparse
import json
import sys


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--module", required=True)
    p.add_argument("--type", default="manual")
    p.add_argument("--input", default="{}")
    p.add_argument("--no-human-gate", action="store_true", help="关闭人工确认闸（内部员工自动执行）")
    args = p.parse_args()

    try:
        from llm import get_llm
        from core import models
        from core.scheduler import Scheduler
        from agents.registry import instantiate_all

        input_data = json.loads(args.input) if args.input else {}

        # 初始化库（幂等，确保表存在）
        models.init_db()

        llm = get_llm()
        agents = instantiate_all(llm)
        sched = Scheduler(agents)

        # 人工闸：对外动作员工默认 need_human=True；内部员工关闭
        need_human = None if args.no_human_gate else None
        task = sched.submit(module_id=args.module, task_type=args.type,
                            input_data=input_data, priority="P1", need_human=need_human)

        # 同一进程内立即执行该任务（run-once 会取所有 pending，但只提交了这一个）
        sched.run_once(limit=10)

        # 读回最终状态与产出
        row = models.get_task(task.task_id)
        status = row["status"] if row else "unknown"
        output_json = row["output_json"] if row else {}
        try:
            output = json.loads(output_json) if isinstance(output_json, str) else (output_json or {})
        except Exception:
            output = {"raw": str(output_json)[:2000]}

        print(json.dumps({
            "ok": True,
            "task_id": task.task_id,
            "status": status,
            "output_json": output,
        }, ensure_ascii=False))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()