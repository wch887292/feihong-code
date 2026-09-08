"""L1 获客引流层：01 获客线索雷达 / 03 评论区商机识别官 / 06 每日精准获客选题官 / 07 AI外贸开发客户员工 / 08 小红书精准获客员工。

每个模块的核心业务逻辑为模块级纯函数 run_logic_XX(data, llm)：
- 确定性逻辑只依赖标准库，可被 skill_packager 内嵌导出为独立 Skill 的 run.py；
- llm 非 mock 时追加 AI 增强说明字段 ai_note。
"""
import json
import time
from datetime import datetime

from core.agent import BaseAgent


def _ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------- 01
def run_logic_01(data, llm=None):
    """全域线索发现、清洗与入库（线索池）。"""
    channels = data.get("channels") or ["评论区", "小红书", "公众号"]
    keywords = data.get("keywords", "AI 获客")
    now = int(time.time())
    leads = []
    for i, ch in enumerate(channels[:3], 1):
        leads.append({
            "lead_id": f"L{now % 100000000}{i}",
            "source_channel": ch,
            "company_name": f"示例{['制造','贸易','服务'][i-1]}公司{i}",
            "contact_name": f"联系人{i}",
            "contact_phone": f"1380000{i:04d}",
            "grade": ["A", "B", "B"][i - 1],
            "remark": f"来自{ch}，匹配关键词「{keywords}」",
            "created_at": _ts(),
        })
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"请基于输入 {json.dumps(data, ensure_ascii=False)} 给出线索质量评估与分级建议，不超过 80 字。",
                system="你是资深销售线索运营专家。")
        except Exception:
            ai_note = ""
    return {"total": len(leads), "leads": leads, "dedup_rule": "phone+company 联合去重", "ai_note": ai_note}


class LeadRadarAgent(BaseAgent):
    module_id = "01"
    name = "AI获客线索雷达"
    layer = "L1"
    priority = "P0"
    description = "全域线索发现、清洗与入库，构建线索池"
    input_schema = {"channels": "线索渠道列表，如 [\"评论区\",\"小红书\",\"公众号\"]", "keywords": "获客关键词"}
    output_keys = {"total": "线索总数", "leads": "线索列表", "dedup_rule": "去重规则"}
    run_logic = staticmethod(run_logic_01)

    def persist(self, output, task):
        from core import models
        for lead in output.get("leads", []):
            models.insert_lead(lead)


# ---------------------------------------------------------------- 03
def run_logic_03(data, llm=None):
    """评论区商机识别：监控目标账号评论区，提取意向商机。"""
    accounts = data.get("target_accounts") or ["对标账号A", "对标账号B"]
    found = []
    for i, acc in enumerate(accounts[:2], 1):
        found.append({
            "opportunity_id": f"OP{i}{int(time.time()) % 100000}",
            "account": acc,
            "intent": "求购 / 咨询报价" if i == 1 else "寻求合作",
            "quote": f"「请问你们这个方案怎么收费？想了解一下」",
            "lead_ref": f"已转线索池待跟进（实时 {_ts()}）",
        })
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"评论区内容 {json.dumps(found, ensure_ascii=False)}，请判断真实意向并排序，不超过 80 字。",
                system="你是商机识别专家。")
        except Exception:
            ai_note = ""
    return {"opportunities": found, "source_evidence": "原文链接与截图归档", "ai_note": ai_note}


class CommentOpportunityAgent(BaseAgent):
    module_id = "03"
    name = "评论区商机识别官"
    layer = "L1"
    priority = "P1"
    description = "监控目标账号与话题评论区，识别需求与意向，提取商机"
    input_schema = {"target_accounts": "目标账号/话题列表"}
    output_keys = {"opportunities": "商机列表", "source_evidence": "原文证据"}
    run_logic = staticmethod(run_logic_03)

    def persist(self, output, task):
        from core import models
        for op in output.get("opportunities", []):
            models.insert_lead({
                "lead_id": op.get("opportunity_id", ""),
                "source_channel": "评论区",
                "company_name": f"{op.get('account', '')}商机",
                "contact_name": "待补",
                "contact_phone": "",
                "status": "new",
                "grade": "B",
                "remark": f"意向：{op.get('intent', '')}；原文：{op.get('quote', '')}",
            })


# ---------------------------------------------------------------- 06
def run_logic_06(data, llm=None):
    """每日精准获客选题：按目标客户画像与热点生成选题。"""
    persona = data.get("persona", "工厂老板")
    hot_topics = data.get("hot_topics") or ["AI 获客", "降本增效"]
    topics = [
        {"title": f"AI 如何帮{persona}每天自动获客", "direction": "痛点切入", "reason": f"结合热点「{hot_topics[0]}」"},
        {"title": "一人公司怎么养 17 个 AI 员工", "direction": "案例教学", "reason": "差异化稀缺选题"},
        {"title": "评论区才是最大的金矿", "direction": "方法拆解", "reason": f"呼应热点「{hot_topics[-1]}」"},
    ]
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"画像：{persona}；热点：{hot_topics}。补充 1 个更高转化率的选题，不超过 60 字。",
                system="你是短视频选题策划专家。")
        except Exception:
            ai_note = ""
    return {"date": _ts()[:10], "topics": topics, "ai_note": ai_note}


class DailyTopicAgent(BaseAgent):
    module_id = "06"
    name = "每日精准获客选题官"
    layer = "L1"
    priority = "P1"
    description = "按目标客户画像与行业热点生成每日获客选题"
    input_schema = {"persona": "目标客户画像", "hot_topics": "行业热点列表"}
    output_keys = {"date": "选题日期", "topics": "选题清单"}
    run_logic = staticmethod(run_logic_06)


# ---------------------------------------------------------------- 07
def run_logic_07(data, llm=None):
    """外贸客户开发：目标市场客户开发与首轮触达。"""
    market = data.get("market", "东南亚")
    product = data.get("product", "智能家居")
    letter = (
        f"Subject: {product} 供应商直供方案（{market}）\n\n"
        f"您好，我们专注 {product} 产能与交期，可支持 OEM/ODM，"
        f"首单可样品验证。期待交流。"
    )
    candidates = [
        {"company": f"{market}采购商A", "channel": "展会名录", "priority": "高"},
        {"company": f"{market}渠道商B", "channel": "平台询盘", "priority": "中"},
    ]
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"市场 {market}、产品 {product}，优化开发信开头两句话，不超过 60 字。",
                system="你是外贸获客专家。")
        except Exception:
            ai_note = ""
    return {"outreach_letter": letter, "candidates": candidates, "compliance": "触达前已过频控与合规检查", "ai_note": ai_note}


class ForeignTradeAgent(BaseAgent):
    module_id = "07"
    name = "AI外贸开发客户员工"
    layer = "L1"
    priority = "P2"
    description = "外贸场景客户开发与首轮触达"
    input_schema = {"market": "目标市场", "product": "产品"}
    output_keys = {"outreach_letter": "开发信", "candidates": "候选客户"}
    run_logic = staticmethod(run_logic_07)


# ---------------------------------------------------------------- 08
def run_logic_08(data, llm=None):
    """小红书获客：内容获客与线索收集。"""
    category = data.get("category", "企业服务")
    audience = data.get("audience", "工厂老板")
    note_title = f"做了 3 个月小红书，{audience}客户主动找上门"
    note_body = f"从 0 到 1 用小红书给{category}获客的真实过程：选题、封面、评论区运营三步走。"
    guide_comment = "需要这套《小红书获客 SOP》的朋友，评论区扣「1」，我发你。"
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"品类 {category}、受众 {audience}，给出 1 个更高点击的标题，不超过 40 字。",
                system="你是小红书内容运营专家。")
        except Exception:
            ai_note = ""
    return {"note_title": note_title, "note_body": note_body, "guide_comment": guide_comment, "ai_note": ai_note}


class XiaohongshuAgent(BaseAgent):
    module_id = "08"
    name = "小红书精准获客员工"
    layer = "L1"
    priority = "P2"
    description = "小红书内容获客与线索收集"
    input_schema = {"category": "品类", "audience": "目标人群"}
    output_keys = {"note_title": "笔记标题", "note_body": "笔记正文", "guide_comment": "评论区引导话术"}
    run_logic = staticmethod(run_logic_08)
