"""豆包大模型适配器（火山方舟 OpenAI 兼容接口）。

零第三方依赖：使用标准库 urllib 发起请求。
配置：DOUBAO_API_KEY / DOUBAO_MODEL / DOUBAO_BASE_URL（见 config.py）。
"""
import json
import urllib.request
import urllib.error
from typing import Any, Dict, List

from llm.base import LLMClient


class DoubaoLLM(LLMClient):
    provider = "doubao"

    def __init__(self, api_key: str, model: str, base_url: str):
        if not api_key:
            raise ValueError("DOUBAO_API_KEY 未配置：请在 .env 中填写后设置 LLM_PROVIDER=doubao")
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")

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
            with urllib.request.urlopen(req, timeout=kwargs.get("timeout", 60)) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"豆包 API 调用失败 HTTP {e.code}: {detail[:300]}") from e
        except urllib.error.URLError as e:
            raise RuntimeError(f"豆包 API 网络错误: {e.reason}") from e

        try:
            return body["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, TypeError) as e:
            raise RuntimeError(f"豆包 API 返回结构异常: {str(body)[:300]}") from e
