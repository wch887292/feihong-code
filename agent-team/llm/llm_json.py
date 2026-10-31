"""LLM 结构化产出工具：让 AI 员工用大模型生成「主体产出」，规则模板作为兜底。

晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人：吴赐虹

设计目标：
    把 LLM 从「只生成一句 ai_note 备注」升级为「生成主体业务产出」。
    任何时候 LLM 不可用（无 Key / 网络故障 / 超时 / 返回格式错），
    都必须静默回落到调用方给定的规则产出，绝不阻断业务链路。

提供：
    - strip_code_fence(text)          去掉 ```json 代码块包裹
    - parse_json_loose(text)           宽松解析 JSON（容忍前后废话/尾逗号）
    - llm_json(llm, prompt, system, schema_hint, fallback, max_tokens)
                                     生成 JSON 对象，失败返回 fallback
"""
import json
import re
from typing import Any, Callable, Dict, Optional


def strip_code_fence(text: str) -> str:
    """去掉 ```json ... ``` 或 ``` ... ``` 包裹。"""
    if not text:
        return ""
    s = text.strip()
    m = re.match(r"^```[a-zA-Z]*\s*(.*?)\s*```$", s, re.DOTALL)
    if m:
        return m.group(1).strip()
    # 去掉残留的起始/结束围栏
    s = re.sub(r"^```[a-zA-Z]*\s*", "", s)
    s = re.sub(r"\s*```$", "", s)
    return s.strip()


# 中文引号 → 英文引号（LLM 偶尔在 JSON 里混入全角引号，导致 JSON 非法）
_CURLY_QUOTES = "\u201c\u201d\u2018\u2019"


def normalize_quotes(text: str) -> str:
    """把 JSON 中常见的全角/弯引号统一替换为 ASCII 双引号。

    实测：LLM 偶尔输出 "recursos" 这类混入 U+201C 的片段，
    导致 json.loads 直接失败、整个产出回落兜底。规范化后再解析即可救回。
    """
    if not text:
        return ""
    out = []
    for ch in text:
        if ch in _CURLY_QUOTES:
            out.append('"')
        else:
            out.append(ch)
    return "".join(out)


def parse_json_loose(text: str) -> Optional[Any]:
    """宽松解析 JSON：先整体解析，失败则截取最外层花括号再解析。"""
    if not text:
        return None
    raw = strip_code_fence(text)
    candidates = [raw]
    # 截取第一个 { 到最后一个 }
    i = raw.find("{")
    j = raw.rfind("}")
    if i != -1 and j > i:
        candidates.append(raw[i:j + 1])
    # 截取第一个 [ 到最后一个 ]
    i = raw.find("[")
    j = raw.rfind("]")
    if i != -1 and j > i:
        candidates.append(raw[i:j + 1])
    for c in candidates:
        if not c:
            continue
        for variant in (c, normalize_quotes(c)):
            try:
                return json.loads(variant)
            except Exception:
                pass
            # 去尾逗号再试
            try:
                return json.loads(re.sub(r",\s*([}\]])", r"\1", variant))
            except Exception:
                continue
    return None


def llm_json(
    llm: Any,
    prompt: str,
    system: str,
    schema_hint: str = "",
    fallback: Optional[Dict[str, Any]] = None,
    max_tokens: int = 4000,
    temperature: float = 0.7,
    timeout: int = 120,
    retry: int = 1,
) -> Dict[str, Any]:
    """调用 LLM 生成一个 JSON 对象。

    参数：
        llm          LLM 客户端；None 或 provider=mock 时直接返回 fallback
        prompt       用户提示
        system       系统提示（角色设定）
        schema_hint  期望的 JSON 结构说明（写进提示词，提升可解析性）
        fallback     兜底产出（LLM 不可用/解析失败时原样返回）
        max_tokens   最大生成 token 数
        retry        解析失败后的重试次数（推理模型输出不稳定是常态）
    返回：解析成功返回 dict；否则返回 fallback（若 fallback 为 None 则返回 {}）
    """
    if llm is None or getattr(llm, "provider", "mock") == "mock":
        return fallback if fallback is not None else {}

    full_prompt = prompt
    if schema_hint:
        full_prompt = f"{prompt}\n\n【输出要求】只输出一个 JSON 对象，不要输出任何解释文字。结构参考：\n{schema_hint}"

    last_text = ""
    for attempt in range(retry + 1):
        # 首次用完整提示；重试时换成更严格的「纯 JSON」提示（实测能显著提高成功率）
        p = full_prompt if attempt == 0 else (
            f"{prompt}\n\n"
            f"【极其重要】只输出一个 JSON 对象，第一个字符必须是 {{，最后一个字符必须是 }}，"
            f"中间不要有任何解释、前言、思考过程或 Markdown 代码块标记。"
            f"结构参考：\n{schema_hint or '{}'}"
        )
        try:
            last_text = llm.complete(
                p, system=system, max_tokens=max_tokens,
                temperature=temperature if attempt == 0 else min(temperature, 0.3),
                timeout=timeout,
            )
        except Exception:
            if attempt >= retry:
                break
            continue

        parsed = parse_json_loose(last_text or "")
        if isinstance(parsed, dict) and parsed:
            return parsed
        if isinstance(parsed, list) and parsed:
            return {"items": parsed}
        # 解析失败 → 重试

    return fallback if fallback is not None else {}


def llm_text(llm: Any, prompt: str, system: str, fallback: str = "",
             max_tokens: int = 1024, temperature: float = 0.7, timeout: int = 90) -> str:
    """调用 LLM 生成纯文本（用于改写单段文案）。失败返回 fallback。"""
    if llm is None or getattr(llm, "provider", "mock") == "mock":
        return fallback
    try:
        text = llm.complete(prompt, system=system, max_tokens=max_tokens,
                            temperature=temperature, timeout=timeout)
        return (text or "").strip() or fallback
    except Exception:
        return fallback


def pick(obj: Any, *names: str, default: Any = None) -> Any:
    """按多个候选字段名依次取值，返回第一个存在且非空的。

    背景：LLM 不严格遵守 schema_hint，常用同义字段名
    （dependency / depends_on、duration / duration_min、risks / risk 等）。
    统一用本函数取值，可显著提升「提示词与实际产出」的对齐率。
    """
    if not isinstance(obj, dict):
        return default
    for n in names:
        if n in obj:
            v = obj[n]
            if v not in (None, "", [], {}):
                return v
    return default


__all__ = ["strip_code_fence", "normalize_quotes", "parse_json_loose", "pick", "llm_json", "llm_text"]
