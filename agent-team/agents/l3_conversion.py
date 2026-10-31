"""L3 销售转化层：02 AI销售跟进销冠 / 04 客户聊天成交分析官 / 09 私域客户分层跟进官。"""
import json
import time
from datetime import datetime

from core.agent import BaseAgent
from llm.llm_json import llm_json, llm_text


def _ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------- 02
# ---------------------------------------------------------------- 02
def run_logic_02(data, llm=None):
    """销售跟进销冠：按话术自动跟进、多轮触达。

    能力升级（2026-10-31）：LLM 生成跟进话术与多轮节奏，规则模板兜底。
    """
    customer = data.get("customer") or {}
    if not isinstance(customer, dict):
        customer = {"company_name": str(customer)}
    strategy = data.get("strategy", "先顾问后报价")
    cname = str(customer.get("company_name") or customer.get("company") or customer.get("name") or "客户")
    cperson = str(customer.get("contact_name") or customer.get("contact") or "老板")
    fallback = {
        "customer": {"company_name": cname, "contact_name": cperson},
        "follow_up": [
            {"round": 1, "channel": "微信", "message": f"{cperson}总您好，上次聊到您那边团队稳定性的问题，我这边整理了一份同行做法，方便发您看看吗？", "goal": "换取回复", "day": "D1"},
            {"round": 2, "channel": "微信", "message": "刚有家做代工转型的，客户也是技术工留不住，用了阶梯分红后半年没走一个人。您那边要不要参考下这个做法？", "goal": "建立专业信任", "day": "D3"},
            {"round": 3, "channel": "电话", "message": "不打扰太久，就问一句：您那边今年有没有在打算怎么留核心员工？我按您的情况说个思路。", "goal": "约时间深聊", "day": "D7"},
        ],
        "next_step": "D1 发第一条微信，48 小时无回复则 D3 发第二条",
        "ai_note": "",
    }
    data_out = llm_json(
        llm,
        prompt=(
            f"给这个客户设计一套多轮跟进方案。\n"
            f"客户：{cname}（联系人 {cperson}）\n"
            f"已定策略：{strategy}\n\n"
            f"请输出：\n"
            f"1. follow_up：4-6 轮跟进，每轮含 round（第几轮）、channel（微信/电话/短信/面访）、"
            f"message（可直接复制发送的话术原文，要具体、要有信息量，不要「您好我们是专业团队」这种废话）、"
            f"goal（这一轮想达成什么）、day（第几天发）、"
            f"expected_response（预期对方反应与应对）\n"
            f"2. next_step：立刻要做的第一步\n"
            f"3. objection_handling：3 个客户可能的拒绝理由与对应应对（每条含 objection + reply）\n"
            f"4. hooks：3 个能让对方回复的具体钩子（同行数据/免费诊断/限时名额，要能兑现不能吹）\n\n"
            f"话术要像真人发的微信，能看出针对这家企业的具体信息，不要通用模板。"
        ),
        system="你是销售跟进销冠，话术短、具体、有钩子，从不写长篇大论。",
        schema_hint='{"customer":{"company_name":"","contact_name":""},"follow_up":[{"round":1,"channel":"","message":"","goal":"","day":"D1","expected_response":""}],"next_step":"","objection_handling":[{"objection":"","reply":""}],"hooks":[""]}',
        fallback=fallback,
        max_tokens=4000,
    )
    if not isinstance(data_out.get("follow_up"), list) or not data_out.get("follow_up"):
        data_out["follow_up"] = fallback["follow_up"]
    if not data_out.get("next_step"):
        data_out["next_step"] = fallback["next_step"]
    data_out.setdefault("customer", fallback["customer"])
    return {"customer": data_out["customer"], "follow_up": data_out["follow_up"],
            "next_step": data_out["next_step"],
            "objection_handling": data_out.get("objection_handling") or [],
            "hooks": data_out.get("hooks") or [], "ai_note": ""}


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
        if not isinstance(c, dict):
            c = {}
        fu = output.get("follow_up", {})
        # follow_up 可能是数组（LLM 多轮方案）或对象（旧结构），都兼容
        if isinstance(fu, list):
            first = fu[0] if fu else {}
            message = first.get("message", "") if isinstance(first, dict) else ""
        elif isinstance(fu, dict):
            message = fu.get("message", "")
        else:
            message = ""
        models.upsert_customer(
            company_name=c.get("company_name", "") or c.get("company", "") or c.get("name", ""),
            contact_name=c.get("contact_name", "") or c.get("contact", ""),
            contact_phone=c.get("contact_phone", "") or c.get("phone", ""),
            remark=message,
            tier="untiered",
        )


# ---------------------------------------------------------------- 04
# ---------------------------------------------------------------- 04
def run_logic_04(data, llm=None):
    """客户聊天成交分析：诊断成交卡点，输出建议话术。

    能力升级（2026-10-31）：LLM 生成真实诊断与话术，规则模板兜底。
    """
    transcript = data.get("transcript", "")
    if not isinstance(transcript, str):
        transcript = str(transcript)
    fallback = {
        "diagnosis": {
            "temperature": 55,
            "blockers": ["价格顾虑", "决策人未定"],
            "signals": ["主动问条款"],
            "suggested_scripts": ["先量化 ROI 再谈价", "确认谁拍板"],
        }
    }
    data_out = llm_json(
        llm,
        prompt=(
            f"分析这段客户聊天记录，诊断成交卡点并给出话术。\n"
            f"聊天原文：\n{transcript}\n\n"
            f"请输出：\n"
            f"1. temperature：成交温度分 0-100（0=没戏，100=马上签），并给一句判断依据\n"
            f"2. blockers：成交卡点，每项含 blocker（卡点）、evidence（原文哪句话暴露了它，要引用原话）、"
            f"severity（高/中/低）、how_to_solve（怎么破）\n"
            f"3. signals：积极信号（原文里的正面信号，逐条引用）\n"
            f"4. risks：风险信号（如比价、已找别家、只是问着玩）\n"
            f"5. suggested_scripts：3-4 句可直接发的回复话术（要针对具体卡点，不要通用模板）\n"
            f"6. next_action：下一步最该做的一件事\n"
            f"7. decision_chain：这个单子真正的决策链是什么（谁拍板、谁反对、谁受影响）\n\n"
            f"诊断要基于原文证据，不要凭感觉。"
        ),
        system="你是成交分析官，看聊天记录能直接看到卡在哪、有没有戏、下一句该说什么。",
        schema_hint='{"diagnosis":{"temperature":55,"blockers":[{"blocker":"","evidence":"","severity":"","how_to_solve":""}],"signals":[""],"risks":[""],"suggested_scripts":[""],"next_action":"","decision_chain":""}}',
        fallback=fallback,
        max_tokens=4000,
    )
    diag = data_out.get("diagnosis")
    if not isinstance(diag, dict) or not diag:
        diag = fallback["diagnosis"]
    return {"diagnosis": diag, "ai_note": ""}


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
    """私域分层跟进：客户分层、差异化跟进计划。

    能力升级（2026-10-31）：
      1) LLM 生成主体分层依据与跟进计划（原先只按顺序硬派 A/B/C，无业务依据）
      2) 修复硬索引崩溃：客户字段名不固定（customer_id / name / company_name…）时不再 KeyError
    """
    customers = data.get("customers") or [
        {"customer_id": "C1", "company_name": "客户A", "contact_name": "李总", "contact_phone": "13800000001"},
        {"customer_id": "C2", "company_name": "客户B", "contact_name": "张总", "contact_phone": "13800000002"},
        {"customer_id": "C3", "company_name": "客户C", "contact_name": "陈总", "contact_phone": "13800000003"},
    ]
    if not isinstance(customers, list):
        customers = [customers]

    def _cid(c, i):
        return str(c.get("customer_id") or c.get("id") or c.get("uid") or f"C{i + 1}")

    def _cname(c):
        return str(c.get("company_name") or c.get("company") or c.get("name") or c.get("contact_name") or "未知客户")

    # ---- 规则兜底：按名单顺序分层 + 标准跟进节奏 ----
    fallback_tiers = [
        {"customer_id": _cid(c, i), "company_name": _cname(c), "tier": ["A", "B", "C"][i % 3]}
        for i, c in enumerate(customers)
    ]
    fallback_plan = [
        {"tier": "A", "action": "每周 1 次价值触达 + 需求深挖", "interval": "7 天"},
        {"tier": "B", "action": "每月 1 次方案更新 + 节点关怀", "interval": "30 天"},
        {"tier": "C", "action": "季度盘点，重新评估意向", "interval": "90 天"},
    ]
    fallback = {"tiers": fallback_tiers, "follow_up_plan": fallback_plan}

    data_out = llm_json(
        llm,
        prompt=(
            f"给这批私域客户做分层并给出跟进计划。\n"
            f"客户名单（含活跃度/成交次数/金额等线索）：{json.dumps(customers, ensure_ascii=False)}\n\n"
            f"请输出：\n"
            f"1. tiers：每位客户的分层结果，每项含 customer_id（沿用名单里的 id，没有就用序号）、"
            f"company_name、tier（A/B/C/D 或 VIP/活跃/普通/沉睡/流失 一类）、"
            f"reason（分层依据，要引用客户身上的具体数据，如「3个月未下单但历史金额高，属沉睡高价值」）、"
            f"next_action（这个层级该做什么，一句话）\n"
            f"2. follow_up_plan：分层策略，每项含 tier、action（具体动作）、interval（触达频率）、priority（高中低）\n"
            f"3. risks：私域运营中这批客户存在的 1-2 个风险（如客诉、串货、过度打扰）\n\n"
            f"不要按名单顺序机械分层，必须看数据说话。"
        ),
        system="你是私域运营专家，做分层要有依据，触达节奏要能落地。",
        schema_hint='{"tiers":[{"customer_id":"","company_name":"","tier":"","reason":"","next_action":""}],"follow_up_plan":[{"tier":"","action":"","interval":"","priority":""}],"risks":[""]}',
        fallback=fallback,
        max_tokens=4000,
    )
    tiers = data_out.get("tiers")
    if not isinstance(tiers, list) or not tiers:
        data_out["tiers"] = fallback_tiers
    plan = data_out.get("follow_up_plan")
    if not isinstance(plan, list) or not plan:
        data_out["follow_up_plan"] = fallback_plan
    return {"tiers": data_out["tiers"], "follow_up_plan": data_out["follow_up_plan"], "ai_note": ""}


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
        # 容错：LLM 返回的 tier 项可能缺 customer_id / tier 字段
        tier_map = {}
        for t in (output.get("tiers") or []):
            if not isinstance(t, dict):
                continue
            cid = t.get("customer_id") or t.get("id") or t.get("name")
            tier = t.get("tier") or t.get("level") or "untiered"
            if cid:
                tier_map[str(cid)] = tier
        customers = task.input_json.get("customers") or []
        if not isinstance(customers, list):
            customers = [customers]
        for idx, c in enumerate(customers):
            if not isinstance(c, dict):
                continue
            cid = c.get("customer_id") or c.get("id") or c.get("name") or f"C{idx + 1}"
            models.upsert_customer(
                customer_id=str(cid),
                company_name=c.get("company_name", "") or c.get("company", "") or c.get("name", ""),
                contact_name=c.get("contact_name", "") or c.get("contact", ""),
                contact_phone=c.get("contact_phone", "") or c.get("phone", ""),
                tier=tier_map.get(str(cid), "untiered"),
                remark="分层跟进",
            )
