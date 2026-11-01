"""L4 分析决策层：10 GEO商机诊断官 / 16 行业深度分析师 / 17 投资研究咨询官。"""
import json
from datetime import datetime

from core.agent import BaseAgent
from llm.llm_json import llm_json, llm_text
from agents.kb_utils import kb_prefix_for, kb_refs_for


def _ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------- 10
def run_logic_10(data, llm=None):
    """GEO 商机诊断：基于地理与经营数据诊断潜在商机。

    能力升级（2026-10-31）：LLM 生成主体诊断（真实商圈/客群/切入方式），规则兜底；
    同时对输入字段做别名容错（target_region / industry / capability 等）。
    """
    region = str(data.get("region") or data.get("target_region") or data.get("area") or "泉州")
    business = str(data.get("business_type") or data.get("industry") or data.get("business") or "企业服务")
    capability = str(data.get("capability") or data.get("strength") or "")
    fallback = {
        "region": region,
        "business_type": business,
        "zones": [
            {"zone": f"{region}·核心商圈", "score": 92, "reason": "人口密度高、企业密集"},
            {"zone": f"{region}·产业园区", "score": 85, "reason": "目标客群集中"},
        ],
        "priority": "建议优先覆盖核心商圈",
        "diagnosed_at": _ts(),
    }
    diagnosis = llm_json(
        llm,
        prompt=(
            f"{kb_prefix_for(data)}做一次生成式引擎（GEO）视角的商机诊断。\n"
            f"目标区域：{region}\n"
            f"业态/行业：{business}\n"
            f"我方能力：{capability or '（未提供，按通用咨询公司假设）'}\n\n"
            f"请输出：\n"
            f"1. zones：3-5 个具体可打的区域/商圈，每项含 zone（具体到「晋江·青阳街道」或「石狮·服装产业园」这种粒度）、"
            f"score（0-100 机会分）、reason（为什么这里有机会，要具体到人群或业态）、"
            f"target_who（这里的具体目标客户画像）、entry（切入方式：发什么内容/用什么钩子）\n"
            f"2. priority：最该先做的 1-2 个区域及理由\n"
            f"3. keyword_gaps：目标客户在 AI 搜索里会问但我们还没覆盖的问题（5 条）\n"
            f"4. actions：本周就能做的 3 个具体动作\n"
            f"5. risks：1-2 个风险提示\n\n"
            f"地域要具体到真实地名，不要泛泛而谈。"
        ),
        system="你是 GEO 商业诊断专家，擅长找出「在 AI 搜索里客户会问、但同行还没答」的问题。",
        schema_hint='{"region":"","business_type":"","zones":[{"zone":"","score":90,"reason":"","target_who":"","entry":""}],"priority":"","keyword_gaps":[""],"actions":[""],"risks":[""],"diagnosed_at":""}',
        fallback=fallback,
        max_tokens=4000,
    )
    for k, v in fallback.items():
        if k not in diagnosis or diagnosis[k] in (None, "", [], {}):
            diagnosis[k] = v
    diagnosis["region"] = region
    diagnosis["business_type"] = business
    diagnosis["diagnosed_at"] = _ts()
    return {"diagnosis": diagnosis, "知识依据": kb_refs_for(data), "ai_note": ""}


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
# ---------------------------------------------------------------- 16
def run_logic_16(data, llm=None):
    """行业深度分析：趋势与竞争格局。

    能力升级（2026-10-31）：LLM 生成真实分析报告（框架+判断+可校准的数据口径），规则模板兜底。
    """
    industry = data.get("industry", "企业服务")
    scope = data.get("scope", "国内")
    fallback = {
        "industry": industry,
        "scope": scope,
        "market_size": "示例口径：120 亿元（需以权威数据源校准）",
        "growth": "年增速约 18%",
        "competition": "格局分散，头部集中度提升中",
        "conclusion": "进入窗口期，建议聚焦细分场景建立壁垒",
        "data_note": "本报告为分析框架示意，关键数据需接入权威数据源后校准",
        "generated_at": _ts(),
    }
    report = llm_json(
        llm,
        prompt=(
            f"{kb_prefix_for(data)}做一份行业深度分析。\n"
            f"行业：{industry}\n"
            f"分析范围：{scope}\n\n"
            f"请输出：\n"
            f"1. market_size：市场规模（必须标注口径与来源年份，如「2025 年行业规模约 X 亿，口径为出厂端」；"
            f"不确定就写区间并说明估算依据，不要编精确数字）\n"
            f"2. growth：增长趋势与驱动因素（拆 3 条驱动，每条说清传导链）\n"
            f"3. competition：竞争格局（用五力或产业链视角，说清谁在抢什么、壁垒在哪）\n"
            f"4. key_players：主要玩家 4-6 家，各含 name、position（他们卡在哪个位置）、threat（对我方的威胁度）\n"
            f"5. opportunities：3 个还没被做透的机会（要具体到「谁+什么场景+为什么现在」）\n"
            f"6. conclusion：进入判断（能不能进、从哪切、要放弃什么）\n"
            f"7. data_note：哪些数据是估算、哪些需要用权威源校准\n\n"
            f"不确定就说不确定，不要编造数字。"
        ),
        system="你是行业研究首席分析师，结论要有依据，数据不确定就标注，不编造精确数字。",
        schema_hint='{"industry":"","scope":"","market_size":"","growth":"","competition":"","key_players":[{"name":"","position":"","threat":""}],"opportunities":[""],"conclusion":"","data_note":"","generated_at":""}',
        fallback=fallback,
        max_tokens=4000,
    )
    for k, v in fallback.items():
        if k not in report or report[k] in (None, "", [], {}):
            report[k] = v
    report["industry"] = industry
    report["scope"] = scope
    report["generated_at"] = _ts()
    return {"report": report, "知识依据": kb_refs_for(data), "ai_note": ""}


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
# ---------------------------------------------------------------- 17
def run_logic_17(data, llm=None):
    """投资研究咨询：研究简报与多空要点（强制免责，不荐股）。

    能力升级（2026-10-31）：LLM 生成真实研究简报，规则模板兜底。
    """
    company = data.get("company", "目标项目")
    materials = data.get("materials", "")
    if not isinstance(materials, str):
        materials = str(materials)
    fallback = {
        "report": {
            "company": company,
            "business_model": "示例：项目商业模式成立",
            "bull_case": [],
            "bear_case": [],
            "objective_conclusion": "结论：需进一步尽调",
            "disclaimer": "本文仅为研究参考，不构成投资建议",
            "generated_at": _ts(),
        }
    }
    data_out = llm_json(
        llm,
        prompt=(
            f"{kb_prefix_for(data)}写一份投资研究简报。\n"
            f"标的：{company}\n"
            f"已知材料：{materials}\n\n"
            f"请输出：\n"
            f"1. company：标的名称\n"
            f"2. business_model：商业模式（怎么赚钱、谁付钱、客单多少）\n"
            f"3. market：市场空间与竞争位置\n"
            f"4. financials：财务要点（只基于材料里给的数字，材料没给就写「材料未提供，需补充」）\n"
            f"5. bull_case：看多逻辑 3 条，每条含 point（观点）、evidence（依据）、impact（影响多大）\n"
            f"6. bear_case：看空逻辑 3 条，同结构\n"
            f"7. key_risks：关键风险（每条含 risk、probability 高/中/低、mitigation 怎么缓）\n"
            f"8. due_diligence：下一步该尽调什么（5 条，按优先级排）\n"
            f"9. objective_conclusion：客观结论（不做买卖建议，只给判断和条件）\n"
            f"10. disclaimer：免责声明（必须包含「不构成投资建议」）\n\n"
            f"材料没有的信息明确说没有，不要编财务数据。"
        ),
        system="你是投资研究顾问，多空并列、客观中立，不荐股不承诺收益。",
        schema_hint='{"report":{"company":"","business_model":"","market":"","financials":"","bull_case":[{"point":"","evidence":"","impact":""}],"bear_case":[{"point":"","evidence":"","impact":""}],"key_risks":[{"risk":"","probability":"","mitigation":""}],"due_diligence":[""],"objective_conclusion":"","disclaimer":"","generated_at":""}}',
        fallback=fallback,
        max_tokens=4000,
    )
    report = data_out.get("report")
    if not isinstance(report, dict) or not report:
        report = fallback["report"]
    report.setdefault("disclaimer", "本文仅为研究参考，不构成投资建议。")
    report["company"] = company
    report["generated_at"] = _ts()
    return {"report": report, "知识依据": kb_refs_for(data), "ai_note": ""}


class InvestResearchAgent(BaseAgent):
    module_id = "17"
    name = "投资研究咨询官"
    layer = "L4"
    priority = "P3"
    description = "项目 / 投资研究与尽调辅助"
    input_schema = {"company": "项目/公司", "materials": "材料摘要"}
    output_keys = {"report": "投研报告"}
    run_logic = staticmethod(run_logic_17)
