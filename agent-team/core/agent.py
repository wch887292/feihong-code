"""BaseAgent：所有 AI 员工模块的基类。

设计要点（支持 Skill 单独分发）：
- 每个模块的核心业务逻辑写在模块级纯函数 run_logic(input_data, llm) 中，
  不依赖类实例与数据库，可被 skill_packager 用 inspect.getsource 内嵌导出为独立 run.py。
- BaseAgent 负责：契约校验（输入/输出 schema）、trace 记录、LLM 注入、错误上抛。
"""
from typing import Any, Callable, Dict, Optional

from core.task import Task, TaskError

# 简化 JSON Schema：字段名 -> 描述/约束
EMPTY_SCHEMA: Dict[str, Any] = {}


class BaseAgent:
    module_id: str = ""
    name: str = ""
    layer: str = ""
    priority: str = "P1"          # P0 | P1 | P2 | P3 | 基建
    description: str = ""
    input_schema: Dict[str, str] = EMPTY_SCHEMA      # 必填字段: 说明
    output_keys: Dict[str, str] = EMPTY_SCHEMA       # 输出字段: 说明
    need_human: bool = False                          # 是否需人工确认
    run_logic: Callable[[Dict[str, Any], Any], Dict[str, Any]] = staticmethod(
        lambda data, llm: {"result": data}
    )

    def __init__(self, llm: Optional[Any] = None):
        self.llm = llm

    # ------------------------------------------------------------------
    def validate_input(self, data: Any) -> Dict[str, Any]:
        if not isinstance(data, dict):
            raise TaskError(f"[{self.module_id}] 输入必须是 JSON 对象，收到 {type(data).__name__}")
        for field, desc in self.input_schema.items():
            if field not in data:
                raise TaskError(f"[{self.module_id}] 缺少必填输入字段 {field}（{desc}）")
        return data

    def validate_output(self, output: Any) -> Dict[str, Any]:
        if not isinstance(output, dict):
            raise TaskError(f"[{self.module_id}] 输出必须是 JSON 对象，收到 {type(output).__name__}")
        return output

    # ------------------------------------------------------------------
    def execute(self, task: Task) -> Dict[str, Any]:
        """调度官调用入口：契约校验 -> 纯函数执行 -> 输出校验 -> trace。"""
        data = self.validate_input(task.input_json)
        task.append_trace("validate_input", "ok")
        output = self.run_logic(data, self.llm)
        output = self.validate_output(output)
        task.append_trace("run_logic", f"output_keys={sorted(output.keys())}")
        return output

    def persist(self, output: Dict[str, Any], task: Task) -> None:
        """可选持久化钩子：模块结果落库（leads/customers/content_assets）。

        仅主系统调度时调用；Skill 分发版 run.py 保持纯逻辑，由调用方决定落库。
        """
        return None

    def meta(self) -> Dict[str, Any]:
        return {
            "module_id": self.module_id,
            "name": self.name,
            "layer": self.layer,
            "priority": self.priority,
            "description": self.description,
            "input_schema": self.input_schema,
            "output_keys": self.output_keys,
            "need_human": self.need_human,
        }
