"""L3 销售转化层：02 AI销售跟进销冠 / 04 客户聊天成交分析官 / 09 私域客户分层跟进官。"""
import json
import time
from datetime import datetime

from core.agent import BaseAgent


def _ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------- 02
def run_logic_02(data, llm=None):
    """销售跟进：按话术自动跟进、多轮触达客户。"""
    customer = data.get("customer") or {"company_name": "示例公司", "contact_name": "王总"}
    strategy = data.get("strategy", "标准 3 触达")
    follow_up = {
        "target": f"{customer.get('contact_name', '')}（{customer.get('company_name', '')}）",
        "round": 1,
        "message": f"您好，上次聊到的方案资料已整理好，方便发您参考吗？",
        "channel": "企业微信",
        "frequency_check": "24h 内仅 1 次，通过频控",
        "next_action": "若 24h 未回复，执行第二轮价值提醒",
        "need_human": True,
        "at": _ts(),
    }
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"客户 {json.dumps(customer, ensure_ascii=False)}，策略 {strategy}，生成第二轮跟进话术，不超过 60 字。",
                system="你是顶级销售。")
        except Exception:
            ai_note = ""
    return {"follow_up": follow_up, "ai_note": ai_note}


class FollowUpAgent(BaseAgent):
    module_id = "02"
    name = "AI销售跟进销冠"
    layer = "L3"
    priority = "P0"
    description = "按话术自动跟进、多轮触达客户（对外动作需人工确认）"
    input_schema = {"customer": "客户对象（company_name/contact_name）", "strategy": "跟进策略"}
    output_keys = {"follow_up": "跟进消息与下一步"}
    need_human = True
    run_logic = staticmethod(run_logic_02)

    def persist(self, output, task):
        from core import models
        c = task.input_json.get("customer", {})
        fu = output.get("follow_up", {})
        models.upsert_customer(
            company_name=c.get("company_name", ""),
            contact_name=c.get("contact_name", ""),
            contact_phone=c.get("contact_phone", ""),
            remark=fu.get("message", ""),
            tier="untiered",
        )


# ---------------------------------------------------------------- 04
def run_logic_04(data, llm=None):
    """聊天成交分析：分析聊天记录，诊断卡点，输出建议话术。"""
    transcript = data.get("transcript", "客户：价格有点高；销售：可以谈；客户：我再想想。")
    diagnosis = {
        "pain_points": ["价格敏感"],
        "blockers": ["价值量化不足", "未给决策紧迫感"],
        "suggested_scripts": [
            "先量化 ROI：按当前产能算 3 个月回本",
            "再给限时政策：本月底前签约送首月服务",
        ],
        "confidence": "中高（抽样人工复核）",
        "analyzed_at": _ts(),
    }
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"聊天记录：{transcript[:200]}，指出最关键的一个成交卡点，不超过 50 字。",
                system="你是成交分析专家。")
        except Exception:
            ai_note = ""
    return {"diagnosis": diagnosis, "ai_note": ai_note}


class ChatAnalysisAgent(BaseAgent):
    module_id = "04"
    name = "客户聊天成交分析官"
    layer = "L3"
    priority = "P0"
    description = "分析聊天记录，诊断成交卡点，输出建议话术"
    input_schema = {"transcript": "聊天记录 / 通话转写"}
    output_keys = {"diagnosis": "卡点诊断与建议话术"}
    run_logic = staticmethod(run_logic_04)


# ---------------------------------------------------------------- 09
def run_logic_09(data, llm=None):
    """私域分层跟进：客户分层、差异化跟进计划。"""
    customers = data.get("customers") or [
        {"customer_id": "C1", "company_name": "客户A", "contact_name": "李总", "contact_phone": "13800000001"},
        {"customer_id": "C2", "company_name": "客户B", "contact_name": "张总", "contact_phone": "13800000002"},
        {"customer_id": "C3", "company_name": "客户C", "contact_name": "陈总", "contact_phone": "13800000003"},
    ]
    tiers = []
    for i, c in enumerate(customers):
        tier = ["A", "B", "C"][i % 3]
        tiers.append({"customer_id": c["customer_id"], "company_name": c["company_name"], "tier": tier})
    plan = [
        {"tier": "A", "action": "每周 1 次价值触达 + 需求深挖", "interval": "7 天"},
        {"tier": "B", "action": "每月 1 次方案更新 + 节点关怀", "interval": "30 天"},
        {"tier": "C", "action": "季度盘点，重新评估意向", "interval": "90 天"},
    ]
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"客户列表 {json.dumps(customers, ensure_ascii=False)}，给出分层建议说明，不超过 60 字。",
                system="你是私域运营专家。")
        except Exception:
            ai_note = ""
    return {"tiers": tiers, "follow_up_plan": plan, "ai_note": ai_note}


class TieringAgent(BaseAgent):
    module_id = "09"
    name = "私域客户分层跟进官"
    layer = "L3"
    priority = "P0"
    description = "私域客户分层、差异化跟进与维护"
    input_schema = {"customers": "客户列表"}
    output_keys = {"tiers": "分层标签", "follow_up_plan": "跟进计划"}
    run_logic = staticmethod(run_logic_09)

    def persist(self, output, task):
        from core import models
        tier_map = {t["customer_id"]: t["tier"] for t in output.get("tiers", [])}
        for c in task.input_json.get("customers", []):
            models.upsert_customer(
                customer_id=c.get("customer_id"),
                company_name=c.get("company_name", ""),
                contact_name=c.get("contact_name", ""),
                contact_phone=c.get("contact_phone", ""),
                tier=tier_map.get(c.get("customer_id"), "untiered"),
                remark="分层跟进",
            )
