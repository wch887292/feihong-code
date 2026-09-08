"""LLM 客户端抽象：所有模块通过统一接口调用大模型。"""
from typing import Any, Dict, List


class LLMClient:
    """大模型客户端接口。

    chat(messages, **kwargs) -> str
    messages: [{"role": "system"|"user"|"assistant", "content": str}, ...]
    """

    provider: str = "base"

    def chat(self, messages: List[Dict[str, str]], **kwargs: Any) -> str:
        raise NotImplementedError

    def complete(self, prompt: str, system: str = "", **kwargs: Any) -> str:
        msgs = []
        if system:
            msgs.append({"role": "system", "content": system})
        msgs.append({"role": "user", "content": prompt})
        return self.chat(msgs, **kwargs)
