"""11 调度官：任务创建、分派、状态机、重试、人工确认与告警。

对齐开发文档《调度编排流程》：
1. 接收触发：定时 / 事件 / 人工；
2. 校验依赖（前置任务 success、数据就绪），不满足则 blocked 提示；
3. 按优先级分派执行，全程记录 trace；
4. 失败自动重试（上限 MAX_RETRY），超限转 blocked 并告警；
   涉及对外动作（need_human）的任务执行后进入 awaiting_human，人工确认后 success。
"""
import logging
import sys
from typing import Any, Dict, List, Optional

import config
from core import models
from core.agent import BaseAgent
from core.task import Task, TaskStatus

log = logging.getLogger("scheduler")


class Scheduler:
    def __init__(self, agents: Dict[str, BaseAgent]):
        self.agents = agents
        self.max_retry = config.MAX_RETRY

    # ---------------------------------------------------------- 提交
    def submit(self, module_id: str, task_type: str, input_data: Dict[str, Any],
               priority: str = "P1", need_human: Optional[bool] = None,
               task_id: Optional[str] = None) -> Task:
        if module_id not in self.agents:
            raise ValueError(f"未知模块编号: {module_id}（可用模块见 list-agents）")
        agent = self.agents[module_id]
        # 契约校验前置：尽早暴露输入错误
        agent.validate_input(input_data)
        human = agent.need_human if need_human is None else need_human
        task = Task(task_type=task_type, module_id=module_id,
                    input_json=input_data, priority=priority, need_human=human)
        if task_id:
            task.task_id = task_id
        models.insert_task(task.to_dict())
        log.info("已提交任务 %s -> %s(%s) pri=%s", task.task_id, module_id, task_type, priority)
        return task

    # ---------------------------------------------------------- 执行一轮
    def run_once(self, limit: int = 10) -> List[Dict[str, Any]]:
        """拉取 pending 任务（按优先级 + 创建时间），逐个分派执行。返回执行结果列表。"""
        results: List[Dict[str, Any]] = []
        rows = models.list_tasks(status=TaskStatus.PENDING.value)
        rows.sort(key=lambda r: ({"P0": 0, "P1": 1, "P2": 2, "P3": 3}.get(r["priority"], 1), r["created_at"]))
        for row in rows[:limit]:
            results.append(self._dispatch(Task.from_dict(row)))
        return results

    def _dispatch(self, task: Task) -> Dict[str, Any]:
        agent = self.agents.get(task.module_id)
        if agent is None:
            self._fail(task, f"模块 {task.module_id} 未注册")
            return {"task_id": task.task_id, "status": task.status.value, "error": "模块未注册"}

        try:
            task.transition(TaskStatus.RUNNING)
            task.append_trace("dispatch", f"module={task.module_id}")
            models.update_task(task.task_id, status=task.status.value, trace=task.trace)

            output = agent.execute(task)

            task.output_json = output
            task.append_trace("executed", "ok")
            # 结果落库（失败视为任务失败，走重试）
            agent.persist(output, task)
            task.append_trace("persisted", "ok")
            if task.need_human:
                task.transition(TaskStatus.AWAITING_HUMAN)
                task.append_trace("human_gate", "等待人工确认")
            else:
                task.transition(TaskStatus.SUCCESS)
            models.update_task(task.task_id, status=task.status.value, output_json=task.output_json,
                               trace=task.trace, finished_at=task.finished_at)
            log.info("任务 %s 完成 -> %s", task.task_id, task.status.value)
            return {"task_id": task.task_id, "status": task.status.value}
        except Exception as e:  # noqa: BLE001 业务异常统一转失败
            log.warning("任务 %s 执行异常: %s", task.task_id, e)
            self._fail(task, str(e))
            return {"task_id": task.task_id, "status": task.status.value, "error": str(e)}

    def _fail(self, task: Task, reason: str) -> None:
        task.retry_count += 1
        task.append_trace("failed", reason)
        if task.retry_count <= self.max_retry:
            task.status = TaskStatus.PENDING  # 自动重试
            log.info("任务 %s 重试 %d/%d", task.task_id, task.retry_count, self.max_retry)
        else:
            task.transition(TaskStatus.BLOCKED)
            self._alert(f"任务 {task.task_id} 重试超限已阻塞: {reason}")
        models.update_task(task.task_id, status=task.status.value,
                           retry_count=task.retry_count, trace=task.trace)

    def _alert(self, msg: str) -> None:
        # M0 阶段告警落日志；后续可扩展飞书 / 短信通知
        log.warning("【告警】%s", msg)
        if config.ALERT_LEVEL == "stdout":
            print(f"ALERT: {msg}")

    # ---------------------------------------------------------- 人工确认
    def approve(self, task_id: str, approved: bool = True) -> Dict[str, Any]:
        row = models.get_task(task_id)
        if row is None:
            raise ValueError(f"任务不存在: {task_id}")
        task = Task.from_dict(row)
        if task.status != TaskStatus.AWAITING_HUMAN:
            raise ValueError(f"任务 {task_id} 不在人工确认状态（当前 {task.status.value}）")
        if approved:
            task.transition(TaskStatus.SUCCESS)
            task.append_trace("human_approved", "ok")
        else:
            task.transition(TaskStatus.FAILED)
            task.append_trace("human_rejected", "人工驳回")
            self._fail(task, "人工驳回")  # 走重试逻辑（若无重试价值可置 blocked）
            models.update_task(task.task_id, status=task.status.value,
                               retry_count=task.retry_count, trace=task.trace)
            return {"task_id": task_id, "status": task.status.value, "approved": False}
        models.update_task(task.task_id, status=task.status.value, trace=task.trace,
                           finished_at=task.finished_at)
        return {"task_id": task_id, "status": task.status.value, "approved": True}

    # ---------------------------------------------------------- 统计
    def stats(self) -> Dict[str, Any]:
        counts = models.count_tasks()
        by_module: Dict[str, int] = {}
        for row in models.list_tasks():
            by_module[row["module_id"]] = by_module.get(row["module_id"], 0) + 1
        return {
            "task_counts": counts,
            "by_module": by_module,
            "agents_online": len(self.agents),
            "max_retry": self.max_retry,
        }

    # ---------------------------------------------------------- 链路演示
    def create_pipeline(self, steps: List[Dict[str, Any]]) -> List[str]:
        """按顺序提交一组任务（链路演示用），随后由 run_once 依次执行。"""
        ids: List[str] = []
        for i, step in enumerate(steps):
            t = self.submit(module_id=step["module_id"],
                            task_type=step.get("task_type", f"pipeline_{i + 1}"),
                            input_data=step.get("input", {}),
                            priority=step.get("priority", "P1"))
            ids.append(t.task_id)
        return ids
