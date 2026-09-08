"""L4 分析决策层：10 GEO商机诊断官 / 16 行业深度分析师 / 17 投资研究咨询官。"""
import json
from datetime import datetime

from core.agent import BaseAgent


def _ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------- 10
def run_logic_10(data, llm=None):
    """GEO 商机诊断：基于地理与经营数据诊断潜在商机。"""
    region = data.get("region", "泉州")
    business = data.get("business_type", "企业服务")
    diagnosis = {
        "region": region,
        "business_type": business,
        "zones": [
            {"zone": f"{region}·核心商圈", "score": 92, "reason": "人口密度高、企业密集"},
            {"zone": f"{region}·产业园区", "score": 85, "reason": "目标客群集中"},
        ],
        "priority": "建议优先覆盖核心商圈",
        "diagnosed_at": _ts(),
    }
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"区域 {region}、业态 {business}，给出获客优先级判断，不超过 60 字。",
                system="你是 GEO 商业诊断专家。")
        except Exception:
            ai_note = ""
    return {"diagnosis": diagnosis, "ai_note": ai_note}


class GeoDiagnosisAgent(BaseAgent):
    module_id = "10"
    name = "GEO商机诊断官"
    layer = "L4"
    priority = "P3"
    description = "基于地理与经营数据诊断潜在商机"
    input_schema = {"region": "目标区域", "business_type": "业态"}
    output_keys = {"diagnosis": "商机诊断报告"}
    run_logic = staticmethod(run_logic_10)


# ---------------------------------------------------------------- 16
def run_logic_16(data, llm=None):
    """行业深度分析：输出行业趋势与竞争格局。"""
    industry = data.get("industry", "企业服务")
    scope = data.get("scope", "国内")
    report = {
        "industry": industry,
        "scope": scope,
        "market_size": "示例口径：120 亿元（需以权威数据源校准）",
        "growth": "年增速约 18%",
        "competition": "格局分散，头部集中度提升中",
        "conclusion": "进入窗口期，建议聚焦细分场景建立壁垒",
        "data_note": "本报告为分析框架示意，关键数据需接入权威数据源后校准",
        "generated_at": _ts(),
    }
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"行业 {industry}、范围 {scope}，给 1 条最关键的竞争判断，不超过 60 字。",
                system="你是行业研究首席分析师。")
        except Exception:
            ai_note = ""
    return {"report": report, "ai_note": ai_note}


class IndustryAnalystAgent(BaseAgent):
    module_id = "16"
    name = "行业深度分析师"
    layer = "L4"
    priority = "P3"
    description = "输出行业趋势与竞争格局分析"
    input_schema = {"industry": "行业", "scope": "范围"}
    output_keys = {"report": "行业分析报告"}
    run_logic = staticmethod(run_logic_16)


# ---------------------------------------------------------------- 17
def run_logic_17(data, llm=None):
    """投资研究：项目 / 投资研究与尽调辅助。"""
    company = data.get("company", "示例项目")
    materials = data.get("materials", "BP 摘要")
    report = {
        "company": company,
        "business_model": "B2B 订阅 + 增值服务",
        "risks": ["获客成本偏高", "复购率待验证"],
        "valuation_notes": "建议以 DCF + 可比公司交叉验证（需财务数据支撑）",
        "conclusion": "方向成立，需补充现金流与复购数据后再决策",
        "generated_at": _ts(),
    }
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"项目 {company}、材料 {materials[:100]}，提示最需要核实的一个风险点，不超过 50 字。",
                system="你是投资研究顾问。")
        except Exception:
            ai_note = ""
    return {"report": report, "ai_note": ai_note}


class InvestResearchAgent(BaseAgent):
    module_id = "17"
    name = "投资研究咨询官"
    layer = "L4"
    priority = "P3"
    description = "项目 / 投资研究与尽调辅助"
    input_schema = {"company": "项目/公司", "materials": "材料摘要"}
    output_keys = {"report": "投研报告"}
    run_logic = staticmethod(run_logic_17)
