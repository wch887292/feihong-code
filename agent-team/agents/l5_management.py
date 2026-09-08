"""L5 系统管理层：11 一人公司 AI 员工调度官。

调度官的运行骨架在 core/scheduler.py；此处注册为可编排模块，
提供「调度计划生成」能力（供其他模块/智能体调用），并声明系统级元信息。
"""
import json
from datetime import datetime

from core.agent import BaseAgent


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


class DispatcherAgent(BaseAgent):
    module_id = "11"
    name = "一人公司AI员工调度官"
    layer = "L5"
    priority = "基建"
    description = "编排、调度、监控全部 AI 员工，管理任务全生命周期"
    input_schema = {"tasks": "待编排任务列表"}
    output_keys = {"schedule": "执行顺序与策略"}
    run_logic = staticmethod(run_logic_11)
