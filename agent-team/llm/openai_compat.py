"""OpenAI 兼容大模型适配器（零第三方依赖，标准库 urllib）。

晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人：吴赐虹

用途：让 AI 员工军团接入任意 OpenAI 兼容接口（火山方舟 / 硅基流动 / OpenAI / 本地 Ollama），
     不再被单一厂商绑定。原先的 doubao_llm.py 仅是本适配器的一个特例，
     现统一由本文件实现，doubao 作为别名保留以兼容既有配置。

配置（环境变量或 agent-team/.env）：
    LLM_PROVIDER=openai_compat | doubao | mock
    LLM_API_KEY       API Key
    LLM_MODEL         模型名
    LLM_BASE_URL      接口根地址（末尾不带 /，如 https://api.siliconflow.cn/v1）

向下兼容：
    DOUBAO_API_KEY / DOUBAO_MODEL / DOUBAO_BASE_URL 仍然有效，
    当 LLM_API_KEY / LLM_MODEL / LLM_BASE_URL 未设置时回退使用。
"""
import json
import urllib.request
import urllib.error
from typing import Any, Dict, List

from llm.base import LLMClient


class OpenAICompatLLM(LLMClient):
    """通用 OpenAI 兼容客户端（chat/completions）。"""

    provider = "openai_compat"

    def __init__(self, api_key: str, model: str, base_url: str, timeout: int = 60):
        if not api_key:
            raise ValueError("LLM_API_KEY 未配置：请在 .env 中填写后设置 LLM_PROVIDER=openai_compat")
        if not base_url:
            raise ValueError("LLM_BASE_URL 未配置：请在 .env 中填写接口根地址")
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def chat(self, messages: List[Dict[str, str]], **kwargs: Any) -> str:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": kwargs.get("temperature", 0.7),
            "max_tokens": kwargs.get("max_tokens", 2048),
        }
        req = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=kwargs.get("timeout", self.timeout)) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"LLM API 调用失败 HTTP {e.code}: {detail[:300]}") from e
        except urllib.error.URLError as e:
            raise RuntimeError(f"LLM API 网络错误: {e.reason}") from e

        try:
            return (body["choices"][0]["message"]["content"] or "").strip()
        except (KeyError, IndexError, TypeError) as e:
            raise RuntimeError(f"LLM API 返回结构异常: {str(body)[:300]}") from e


class DoubaoLLM(OpenAICompatLLM):
    """豆包（火山方舟）适配器：保留旧类名与 provider 标识，行为完全一致。"""

    provider = "doubao"
