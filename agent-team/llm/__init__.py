"""LLM 工厂：按配置返回 mock / openai_compat / doubao 客户端。

晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人：吴赐虹

优先级（配置回退链）：
    LLM_PROVIDER 显式指定 > 有 API Key 时自动用 openai_compat > mock
    LLM_API_KEY / LLM_MODEL / LLM_BASE_URL 优先，回退 DOUBAO_* 旧变量。
"""
from config import (
    DOUBAO_API_KEY,
    DOUBAO_BASE_URL,
    DOUBAO_MODEL,
    LLM_API_KEY,
    LLM_BASE_URL,
    LLM_MODEL,
    LLM_PROVIDER,
)

from llm.base import LLMClient
from llm.mock_llm import MockLLM


def _resolve() -> tuple:
    """返回 (api_key, model, base_url)，兼容旧 DOUBAO_* 变量。"""
    key = (LLM_API_KEY or "").strip() or (DOUBAO_API_KEY or "").strip()
    model = (LLM_MODEL or "").strip() or (DOUBAO_MODEL or "").strip()
    base = (LLM_BASE_URL or "").strip() or (DOUBAO_BASE_URL or "").strip()
    return key, model, base


def get_llm() -> LLMClient:
    provider = (LLM_PROVIDER or "mock").strip().lower()
    key, model, base = _resolve()

    # 显式 mock：强制走确定性输出
    if provider == "mock":
        return MockLLM()

    # 显式 openai_compat / doubao
    if provider in ("openai_compat", "openai", "siliconflow", "doubao"):
        if not key:
            # 缺 Key 时降级 mock，不阻断链路（保持「永不停机」原则）
            return MockLLM()
        from llm.openai_compat import DoubaoLLM, OpenAICompatLLM
        if provider == "doubao":
            return DoubaoLLM(api_key=key, model=model or "doubao-seed-1-6-250615",
                             base_url=base or "https://ark.cn-beijing.volces.com/api/v3")
        return OpenAICompatLLM(api_key=key, model=model, base_url=base)

    # 未显式指定：有 Key 就自动接真实 LLM，否则 mock
    if key and base:
        from llm.openai_compat import OpenAICompatLLM
        return OpenAICompatLLM(api_key=key, model=model, base_url=base)
    return MockLLM()
