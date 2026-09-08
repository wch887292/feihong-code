"""任务协议与状态机。

对齐开发文档《统一协议与数据模型》任务部分：
状态流转约束：pending → running → success / failed / awaiting_human / blocked；
failed 可重试回 pending（上限由调度官控制）；awaiting_human 经人工确认后 success / failed。
"""
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from core.models import utcnow


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    BLOCKED = "blocked"
    AWAITING_HUMAN = "awaiting_human"


class TaskError(Exception):
    """任务执行异常：携带可诊断信息。"""


class TaskStatusError(TaskError):
    """非法状态迁移。"""


# 允许的状态迁移表
_TRANSITIONS: Dict[TaskStatus, set] = {
    TaskStatus.PENDING: {TaskStatus.RUNNING, TaskStatus.BLOCKED},
    TaskStatus.RUNNING: {TaskStatus.SUCCESS, TaskStatus.FAILED,
                         TaskStatus.AWAITING_HUMAN, TaskStatus.BLOCKED},
    TaskStatus.FAILED: {TaskStatus.PENDING, TaskStatus.BLOCKED},
    TaskStatus.AWAITING_HUMAN: {TaskStatus.SUCCESS, TaskStatus.FAILED},
    TaskStatus.SUCCESS: set(),
    TaskStatus.BLOCKED: {TaskStatus.PENDING},
}


def assert_transition(old: TaskStatus, new: TaskStatus) -> None:
    if old == new:
        return
    if new not in _TRANSITIONS.get(old, set()):
        raise TaskStatusError(f"非法状态迁移: {old.value} -> {new.value}")


def new_task_id() -> str:
    return "T" + uuid.uuid4().hex[:12]


@dataclass
class Task:
    """领域任务对象：创建时校验必填字段，序列化/反序列化与 DB 行对齐。"""

    task_type: str
    module_id: str
    input_json: Dict[str, Any] = field(default_factory=dict)
    priority: str = "P1"
    need_human: bool = False
    status: TaskStatus = TaskStatus.PENDING
    task_id: str = field(default_factory=new_task_id)
    output_json: Dict[str, Any] = field(default_factory=dict)
    retry_count: int = 0
    trace: List[Dict[str, Any]] = field(default_factory=list)
    created_at: str = field(default_factory=utcnow)
    finished_at: str = ""

    def __post_init__(self) -> None:
        if not self.task_type or not self.module_id:
            raise TaskError("task_type 与 module_id 为必填字段")
        if self.priority not in ("P0", "P1", "P2", "P3"):
            raise TaskError(f"非法优先级: {self.priority}")

    # ---- 状态机 ----
    def transition(self, new_status: TaskStatus) -> None:
        assert_transition(self.status, new_status)
        self.status = new_status
        if new_status in (TaskStatus.SUCCESS, TaskStatus.FAILED, TaskStatus.BLOCKED):
            self.finished_at = utcnow()

    def append_trace(self, step: str, detail: Any = None) -> None:
        self.trace.append({"step": step, "detail": detail, "at": utcnow()})

    # ---- 序列化 ----
    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id,
            "task_type": self.task_type,
            "module_id": self.module_id,
            "status": self.status.value,
            "priority": self.priority,
            "input_json": self.input_json,
            "output_json": self.output_json,
            "retry_count": self.retry_count,
            "need_human": self.need_human,
            "trace": self.trace,
            "created_at": self.created_at,
            "finished_at": self.finished_at,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Task":
        t = cls(
            task_id=d["task_id"],
            task_type=d["task_type"],
            module_id=d["module_id"],
            status=TaskStatus(d["status"]),
            priority=d.get("priority", "P1"),
            input_json=d.get("input_json", {}),
            output_json=d.get("output_json", {}),
            retry_count=d.get("retry_count", 0),
            need_human=bool(d.get("need_human")),
            trace=d.get("trace", []),
            created_at=d.get("created_at", ""),
            finished_at=d.get("finished_at", ""),
        )
        return t
