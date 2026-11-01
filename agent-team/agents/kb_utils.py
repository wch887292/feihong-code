"""知识库注入工具：供 L0-L5 员工复用 L6 已验证的知识消费范式。

晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人 吴赐虹

桥接（fhcode-bridge.mjs）在执行前会把企业知识包注入 input.knowledge_context；
本模块提供统一的「取包 / 渲染 / 溯源」三件套，让员工产出基于真实公司资产
（合伙制度、利润分红条款、客户见证），而不是模型即兴发挥。

降级：knowledge_context 缺失 / 非法 / 空数组时，三件套全部安全降级，
绝不影响员工正常执行（与 L6 行为一致）。
"""
from typing import Any, Dict, List


def _kb_context(data: Any) -> List[Dict]:
    """取知识包（可选）：桥接注入的知识块数组，缺失或非法时返回空列表。"""
    ctx = data.get("knowledge_context") if isinstance(data, dict) else None
    return ctx if isinstance(ctx, list) else []


def _kb_block(ctx: List[Dict]) -> str:
    """把知识包渲染成可塞进 prompt 的文本块；无知识时返回空串。"""
    if not ctx:
        return ""
    lines = []
    for i, c in enumerate(ctx, 1):
        if not isinstance(c, dict):
            continue
        title = c.get("title") or "（无标题）"
        cat = c.get("category") or ""
        content = (c.get("content") or "").strip()
        src = c.get("source") or ""
        head = f"【知识{i}】{title}"
        if cat:
            head += f"（分类：{cat}）"
        if src:
            head += f"（来源：{src}）"
        lines.append(head + "\n" + content)
    return "\n\n".join(lines) if lines else ""


def _kb_refs(ctx: List[Dict]) -> List[Dict]:
    """从知识包抽出引用清单（用于产出溯源）。"""
    refs = []
    for c in ctx:
        if not isinstance(c, dict):
            continue
        refs.append({
            "文档标题": c.get("title") or "",
            "分类": c.get("category") or "",
            "来源": c.get("source") or "",
            "chunkId": c.get("chunkId") or "",
            "docId": c.get("docId") or "",
            "相关度": c.get("score") or 0,
        })
    return refs


# 知识引用引导语（模块级常量，避免 f-string 内英文双引号嵌套）
KB_GUIDE = (
    "\n请优先引用【企业知识库】中的真实制度条款、比例、案例数据；"
    "知识库未覆盖的部分才可给通用建议，并明确标注为通用建议。\n"
)


def kb_prefix(kb_text: str) -> str:
    """把渲染好的知识块与引导语拼成可前置于 prompt 的文本；无知识时返回空串。"""
    if not kb_text:
        return ""
    return "【企业知识库·真实资产】\n" + kb_text + "\n" + KB_GUIDE


# ---- 便捷封装：直接吃 input dict，省去每个员工重复取包/渲染/溯源 ----
def kb_context_for(data: Any) -> List[Dict]:
    """取知识包（可选）：直接给 input dict，返回数组；缺失/非法返回空列表。"""
    return _kb_context(data)


def kb_prefix_for(data: Any) -> str:
    """直接给 input dict，返回可前置于 prompt 的知识块文本；无知识返回空串。"""
    return kb_prefix(_kb_block(_kb_context(data)))


def kb_refs_for(data: Any) -> List[Dict]:
    """直接给 input dict，返回知识溯源清单；无知识返回空列表。"""
    return _kb_refs(_kb_context(data))
