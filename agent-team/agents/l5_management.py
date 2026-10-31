"""L5 系统管理层：11 一人公司 AI 员工调度官。

调度官的运行骨架在 core/scheduler.py；此处注册为可编排模块，
提供「调度计划生成」能力（供其他模块/智能体调用），并声明系统级元信息。
"""
import json
from datetime import datetime

from core.agent import BaseAgent
from llm.llm_json import llm_json, llm_text, pick


def _ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def run_logic_11(data, llm=None):
    """调度计划：按优先级与依赖生成执行顺序。

    能力升级（2026-10-31）：
      1) LLM 生成主体调度计划与风险判断（原先只有固定 order 列表）
      2) 修复硬索引崩溃：任务项字段名不固定（module_id / title / task_type）时不再 KeyError
    """
    tasks = data.get("tasks") or [
        {"module_id": "01", "task_type": "lead_scan", "priority": "P0"},
        {"module_id": "02", "task_type": "follow_up", "priority": "P0"},
        {"module_id": "04", "task_type": "chat_analysis", "priority": "P0"},
        {"module_id": "09", "task_type": "tiering", "priority": "P0"},
    ]
    if not isinstance(tasks, list):
        tasks = [tasks]

    def _tid(t, i):
        return str(t.get("module_id") or t.get("id") or t.get("module") or f"T{i + 1}")

    def _tname(t):
        return str(t.get("title") or t.get("name") or t.get("task_type") or t.get("type") or "未命名任务")

    def _tpri(t):
        return str(t.get("priority") or "P1")

    # ---- 规则兜底：按优先级排序 ----
    pri_rank = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
    ordered = sorted(tasks, key=lambda t: pri_rank.get(_tpri(t), 1))
    fallback_schedule = {
        "order": [_tid(t, i) for i, t in enumerate(ordered)],
        "tasks": [{"module_id": _tid(t, i), "title": _tname(t), "priority": _tpri(t)} for i, t in enumerate(ordered)],
        "dependency_rule": "前置任务 success 后触发后续任务",
        "retry_policy": "失败自动重试，上限 3 次，超限转 blocked 并告警",
        "human_gate": "涉及对外触达的任务在人工确认节点暂停",
        "estimated_minutes": len(ordered) * 3,
        "planned_at": _ts(),
    }
    fallback = {"schedule": fallback_schedule}

    data_out = llm_json(
        llm,
        prompt=(
            f"为这批任务设计一份可执行的调度编排方案。\n"
            f"任务清单：{json.dumps(tasks, ensure_ascii=False)}\n\n"
            f"请输出：\n"
            f"1. order：任务执行顺序（用任务的 module_id 或 id，没有就用序号）\n"
            f"2. tasks：每个任务的执行安排，每项含 module_id、title、priority（P0-P3）、"
            f"depends_on（依赖的前序任务 id 列表，没有就空数组）、"
            f"owner_hint（该由哪个角色的 AI 员工承接）、duration_min（预估分钟）、deliverable（交付物是什么）\n"
            f"3. risks：编排上的 1-3 个风险（如依赖过深、并行冲突、对外动作无人确认）\n"
            f"4. human_gate：哪些任务必须人工确认后才能执行（涉及对外触达客户/发消息/报价的）\n"
            f"5. parallel_groups：可以并行执行的分组（每组一个 id 列表）\n\n"
            f"要给出真实的依赖判断，不要把所有任务排成一条直线。"
        ),
        system="你是系统调度架构师，编排要兼顾效率与风险控制。",
        schema_hint='{"schedule":{"order":[],"tasks":[{"module_id":"","title":"","priority":"P1","depends_on":[],"owner_hint":"","duration_min":3,"deliverable":""}],"dependency_rule":"","retry_policy":"","human_gate":"","parallel_groups":[[]],"estimated_minutes":15,"planned_at":""},"risks":[""]}',
        fallback=fallback,
        max_tokens=4000,
    )
    schedule = data_out.get("schedule")
    if not isinstance(schedule, dict) or not schedule:
        schedule = fallback_schedule
    # LLM 常把 risks 放在 schedule 内，或用 risk / 风险 等别名 → 多位置兼容取值
    risks = pick(data_out, "risks", "risk", "risk_list", default=None)
    if risks is None:
        risks = pick(schedule, "risks", "risk", "risk_list", default=[])
    if isinstance(risks, str):
        risks = [risks]
    if not isinstance(risks, list):
        risks = []
    # tasks 字段名兼容（depends_on / dependency、duration_min / duration…）
    raw_tasks = pick(schedule, "tasks", "task_list", "items", default=[])
    if not isinstance(raw_tasks, list) or not raw_tasks:
        raw_tasks = fallback_schedule["tasks"]
    norm_tasks = []
    for i, t in enumerate(raw_tasks):
        if not isinstance(t, dict):
            continue
        norm_tasks.append({
            "module_id": pick(t, "module_id", "id", "module", default=f"T{i + 1}"),
            "title": pick(t, "title", "name", "task", default="未命名任务"),
            "priority": pick(t, "priority", "pri", default="P1"),
            "depends_on": pick(t, "depends_on", "dependency", "depends", "predecessors", default=[]),
            "duration_min": pick(t, "duration_min", "duration", "minutes", "estimate", default=3),
            "deliverable": pick(t, "deliverable", "output", "result", "artifact", default=""),
            "owner_hint": pick(t, "owner_hint", "owner", "assignee", "role", default=""),
        })
    if norm_tasks:
        schedule["tasks"] = norm_tasks
    for k, v in fallback_schedule.items():
        if k not in schedule or schedule[k] in (None, "", [], {}):
            schedule[k] = v
    schedule["planned_at"] = _ts()
    return {"schedule": schedule, "risks": risks, "ai_note": ""}


class DispatcherAgent(BaseAgent):
    module_id = "11"
    name = "一人公司AI员工调度官"
    layer = "L5"
    priority = "基建"
    description = "编排、调度、监控全部 AI 员工，管理任务全生命周期"
    input_schema = {"tasks": "待编排任务列表"}
    output_keys = {"schedule": "执行顺序与策略"}
    run_logic = staticmethod(run_logic_11)
