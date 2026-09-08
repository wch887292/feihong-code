"""LLM 工厂：按配置返回 mock 或 doubao 客户端。"""
from config import (DOUBAO_API_KEY, DOUBAO_BASE_URL, DOUBAO_MODEL, LLM_PROVIDER)

from llm.base import LLMClient
from llm.mock_llm import MockLLM


def get_llm() -> LLMClient:
    if LLM_PROVIDER == "doubao":
        from llm.doubao_llm import DoubaoLLM
        return DoubaoLLM(api_key=DOUBAO_API_KEY, model=DOUBAO_MODEL, base_url=DOUBAO_BASE_URL)
    return MockLLM()
