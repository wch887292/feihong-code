"""L1 获客引流层：01 获客线索雷达 / 03 评论区商机识别官 / 06 每日精准获客选题官 / 07 AI外贸开发客户员工 / 08 小红书精准获客员工。

每个模块的核心业务逻辑为模块级纯函数 run_logic_XX(data, llm)：
- 确定性逻辑只依赖标准库，可被 skill_packager 内嵌导出为独立 Skill 的 run.py；
- llm 非 mock 时追加 AI 增强说明字段 ai_note。
"""
import json
import time
from datetime import datetime

from core.agent import BaseAgent
from llm.llm_json import llm_json, llm_text
from agents.kb_utils import kb_prefix_for, kb_refs_for


def _ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------- 01
# ---------------------------------------------------------------- 01
def run_logic_01(data, llm=None):
    """获客线索雷达：全域线索发现、清洗与入库。

    能力升级（2026-10-31）：LLM 生成真实线索与去重规则，规则模板兜底。
    """
    channels = data.get("channels") or ["评论区", "小红书", "公众号"]
    keywords = data.get("keywords", "获客")
    if isinstance(channels, str):
        channels = [channels]
    if isinstance(keywords, (list, tuple)):
        keywords = "、".join(str(k) for k in keywords)
    fallback = {
        "total": 3,
        "leads": [
            {"company": "A 公司", "channel": channels[0], "intent": "高", "contact": "待补", "pain": "获客成本高"},
            {"company": "B 公司", "channel": channels[-1], "intent": "中", "contact": "待补", "pain": "老员工流失"},
            {"company": "C 公司", "channel": channels[0], "intent": "中", "contact": "待补", "pain": "产能扩张慢"},
        ],
        "dedup_rule": "公司名 + 联系方式去重，联系方式优先于公司名",
    }
    data_out = llm_json(
        llm,
        prompt=(
            f"{kb_prefix_for(data)}做一次多渠道获客线索扫描。\n"
            f"渠道：{'、'.join(channels)}\n"
            f"关键词/目标客户特征：{keywords}\n\n"
            f"请输出：\n"
            f"1. leads：5-8 条线索，每条含 company（公司或客户名，要具体到行业+规模，如「晋江恒盛服装厂（800人）」）、"
            f"channel（从哪个渠道发现的）、intent（高/中/低）、"
            f"pain（他真实的痛点，要具体，如「厂里 3 个技术工被挖走」）、"
            f"contact（能触达的方式或线索来源，写「评论区留言：找XXX」这类可执行的）、"
            f"why_now（为什么现在该联系他）、next_step（下一步动作）\n"
            f"2. total：线索总数\n"
            f"3. dedup_rule：去重规则（说明按什么字段判重、冲突时如何取舍）\n"
            f"4. channels_insight：各渠道的产出质量判断（哪个渠道值得加投，哪个该砍）\n\n"
            f"痛点要像真实对话里听到的，不要写「获客难」这种空话。"
        ),
        system="你是获客实战派线索分析师，给的线索能直接打电话过去，不给泛泛而谈的画像。",
        schema_hint='{"total":0,"leads":[{"company":"","channel":"","intent":"","pain":"","contact":"","why_now":"","next_step":""}],"dedup_rule":"","channels_insight":""}',
        fallback=fallback,
        max_tokens=4000,
    )
    if not isinstance(data_out.get("leads"), list) or not data_out.get("leads"):
        data_out["leads"] = fallback["leads"]
    if not data_out.get("total"):
        data_out["total"] = len(data_out["leads"])
    if not data_out.get("dedup_rule"):
        data_out["dedup_rule"] = fallback["dedup_rule"]
    return {"total": data_out["total"], "leads": data_out["leads"],
            "dedup_rule": data_out["dedup_rule"], "知识依据": kb_refs_for(data), "ai_note": ""}


class LeadRadarAgent(BaseAgent):
    module_id = "01"
    name = "AI获客线索雷达"
    layer = "L1"
    priority = "P0"
    description = "全域线索发现、清洗与入库，构建线索池"
    input_schema = {"channels": "线索渠道列表，如 [\"评论区\",\"小红书\",\"公众号\"]", "keywords": "获客关键词"}
    input_type_hints = {"channels": "list"}
    output_keys = {"total": "线索总数", "leads": "线索列表", "dedup_rule": "去重规则"}
    run_logic = staticmethod(run_logic_01)

    def persist(self, output, task):
        from core import models
        for lead in output.get("leads", []):
            models.insert_lead(lead)


# ---------------------------------------------------------------- 03
# ---------------------------------------------------------------- 03
def run_logic_03(data, llm=None):
    """评论区商机识别官：识别需求与意向，提取商机。

    能力升级（2026-10-31）：LLM 生成真实商机与原文证据，规则模板兜底。
    """
    accounts = data.get("target_accounts") or ["目标账号A"]
    if isinstance(accounts, str):
        accounts = [accounts]
    fallback = {
        "opportunities": [
            {"account": accounts[0], "comment": "这附近有做代工的吗", "intent": "求购", "score": 85, "action": "私信报价"},
            {"account": accounts[-1], "comment": "厂里留不住人怎么办", "intent": "求助", "score": 72, "action": "送资料"},
        ],
        "source_evidence": "评论原文可回溯",
    }
    data_out = llm_json(
        llm,
        prompt=(
            f"{kb_prefix_for(data)}扫描这些目标账号/话题的评论区，识别商机。\n"
            f"目标：{'、'.join(accounts)}\n\n"
            f"请输出：\n"
            f"1. opportunities：4-6 条商机，每条含 account（来自哪个账号/话题）、"
            f"comment（评论原文，要像真实用户会打的话，含口语和不完整句）、"
            f"intent（求购/求助/同行/闲聊/垃圾广告，需判断）、"
            f"score（商机分 0-100，说明为什么这个分）、"
            f"pain（他真正的痛点，从评论里推断）、"
            f"reply（我们该回他什么，一句话，可直接发）、action（下一步动作）\n"
            f"2. source_evidence：证据说明（怎么回溯到原文、筛选规则是什么）\n"
            f"3. noise_filter：本轮过滤掉了哪些垃圾广告/同行，需要忽略的规则\n\n"
            f"要识别出真实商机，别把同行和广告当商机。"
        ),
        system="你是评论区商机识别官，眼毒，只对真商机打分，广告和同行一律剔除。",
        schema_hint='{"opportunities":[{"account":"","comment":"","intent":"","score":85,"pain":"","reply":"","action":""}],"source_evidence":"","noise_filter":""}',
        fallback=fallback,
        max_tokens=4000,
    )
    if not isinstance(data_out.get("opportunities"), list) or not data_out.get("opportunities"):
        data_out["opportunities"] = fallback["opportunities"]
    if not data_out.get("source_evidence"):
        data_out["source_evidence"] = fallback["source_evidence"]
    return {"opportunities": data_out["opportunities"], "source_evidence": data_out["source_evidence"],
            "noise_filter": data_out.get("noise_filter") or "", "知识依据": kb_refs_for(data), "ai_note": ""}


class CommentOpportunityAgent(BaseAgent):
    module_id = "03"
    name = "评论区商机识别官"
    layer = "L1"
    priority = "P1"
    description = "监控目标账号与话题评论区，识别需求与意向，提取商机"
    input_schema = {"target_accounts": "目标账号/话题列表"}
    input_type_hints = {"target_accounts": "list"}
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
# ---------------------------------------------------------------- 06
def run_logic_06(data, llm=None):
    """每日精准获客选题官：生成当日选题清单。

    能力升级（2026-10-31）：LLM 生成真实选题（含钩子与目标），规则模板兜底。
    """
    persona = data.get("persona", "工厂老板")
    topics_in = data.get("hot_topics") or []
    if isinstance(topics_in, str):
        topics_in = [topics_in]
    fallback = {
        "date": _ts()[:10],
        "topics": [
            {"title": "AI 如何帮工厂老板获客", "hook": "获客成本涨了三倍，我砍掉了一半渠道", "angle": "实操", "score": 88},
            {"title": "一人公司如何养 17 个 AI 员工", "hook": "我一个人管 17 个数字员工", "angle": "故事", "score": 85},
            {"title": "评论区商机怎么挖", "hook": "评论区躺着 200 个客户", "angle": "方法", "score": 82},
        ],
    }
    data_out = llm_json(
        llm,
        prompt=(
            f"{kb_prefix_for(data)}给「{persona}」生成今天的获客选题。\n"
            f"可结合的热点/行业话题：{'、'.join(topics_in) if topics_in else '（未指定，自行结合行业热点）'}\n\n"
            f"请输出 6 个选题，每个含：\n"
            f"- title：标题（像真实账号会发的那种，不要「震惊」「必看」）\n"
            f"- hook：前 3 秒钩子（具体到能想象出画面，如「我昨天把厂里三个人的活交给一个 AI」）\n"
            f"- angle：切入角度（真实案例/踩坑/对比/教程/观点）\n"
            f"- target：这条是打给谁的（越具体越好）\n"
            f"- pain：戳中他什么痛点\n"
            f"- score：获客潜力分 0-100（要能看出评分理由）\n"
            f"- reason：为什么今天发这条\n\n"
            f"选题之间要有角度差异，不要都是同一个套路。"
        ),
        system="你是获客选题官，选题要能直接开拍，每个都带钩子。",
        schema_hint='{"topics":[{"title":"","hook":"","angle":"","target":"","pain":"","score":85,"reason":""}]}',
        fallback=fallback,
        max_tokens=4000,
    )
    if not isinstance(data_out.get("topics"), list) or not data_out.get("topics"):
        data_out["topics"] = fallback["topics"]
    # 选题日期属系统事实字段，由代码强制覆盖，不采信模型生成值
    data_out["date"] = _ts()[:10]
    return {"date": data_out["date"], "topics": data_out["topics"], "知识依据": kb_refs_for(data), "ai_note": ""}


class DailyTopicAgent(BaseAgent):
    module_id = "06"
    name = "每日精准获客选题官"
    layer = "L1"
    priority = "P1"
    description = "按目标客户画像与行业热点生成每日获客选题"
    input_schema = {"persona": "目标客户画像", "hot_topics": "行业热点列表"}
    input_type_hints = {"hot_topics": "list"}
    output_keys = {"date": "选题日期", "topics": "选题清单"}
    run_logic = staticmethod(run_logic_06)


# ---------------------------------------------------------------- 07
# ---------------------------------------------------------------- 07
def run_logic_07(data, llm=None):
    """外贸开发客户员工：生成开发信序列与候选客户。

    能力升级（2026-10-31）：LLM 生成真实开发信与客户画像，规则模板兜底。
    """
    market = data.get("market", "东南亚")
    product = data.get("product", "服装代工")
    fallback = {
        "outreach_letter": {
            "subject": f"{product} — {market} 稳定产能与 15 天交期",
            "body": "您好，我们专注服装代工，支持小单快反，15 天交期，附上工厂实拍与产能表。",
        },
        "candidates": [
            {"company": "越南 ABC Garment", "channel": "展会名录", "priority": "高"},
            {"company": "柬埔寨 XYZ Fashion", "channel": "平台询盘", "priority": "中"},
        ],
        "sequence": [],
    }
    data_out = llm_json(
        llm,
        prompt=(
            f"{kb_prefix_for(data)}为外贸开发客户写一套开发信方案。\n"
            f"目标市场：{market}\n"
            f"产品：{product}\n\n"
            f"请输出：\n"
            f"1. sequence：4 封开发信的序列安排，每封含 round（第几封）、day（第几天发）、"
            f"subject（主题，要具体不夸张）、body（正文，要短，150 字以内，包含一个具体信息点：产能/交期/ MOQ/ 报价优势）、"
            f"cta（这封只要对方做的一个动作）\n"
            f"2. outreach_letter：首封的完整版（subject + body）\n"
            f"3. candidates：4-6 个候选客户画像，每项含 company（真实存在的采购商类型，如「越南 Hùng Anh Garment」）、"
            f"channel（怎么找到的：展会名录/领英/平台询盘/海关数据）、priority（高中低）、"
            f"why_fit（为什么他可能需要我们的产品）、approach（切入话术，一句话）\n"
            f"4. keywords：找这类客户的搜索关键词（中英文各一组）\n"
            f"5. risks：外贸开发要注意的点（合规、付款、样品）\n\n"
            f"开发信要像真人写的，简洁有力，不要空洞的「我们专注于」。"
        ),
        system="你是外贸开发老手，开发信短而具体，第一句就说到买家关心的事。",
        schema_hint='{"outreach_letter":{"subject":"","body":""},"candidates":[{"company":"","channel":"","priority":"","why_fit":"","approach":""}],"sequence":[{"round":1,"day":"D1","subject":"","body":"","cta":""}],"keywords":[],"risks":[]}',
        fallback=fallback,
        max_tokens=4000,
    )
    if not isinstance(data_out.get("candidates"), list) or not data_out.get("candidates"):
        data_out["candidates"] = fallback["candidates"]
    if not isinstance(data_out.get("sequence"), list) or not data_out.get("sequence"):
        data_out["sequence"] = fallback["sequence"]
    if not isinstance(data_out.get("outreach_letter"), dict) or not data_out.get("outreach_letter"):
        data_out["outreach_letter"] = fallback["outreach_letter"]
    return {"outreach_letter": data_out["outreach_letter"], "candidates": data_out["candidates"],
            "sequence": data_out["sequence"], "keywords": data_out.get("keywords") or [],
            "risks": data_out.get("risks") or [], "知识依据": kb_refs_for(data), "ai_note": ""}


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
# ---------------------------------------------------------------- 08
def run_logic_08(data, llm=None):
    """小红书精准获客员工：笔记草稿与互动引导。

    能力升级（2026-10-31）：LLM 生成真实笔记（含正文/标签/评论区引导），规则模板兜底。
    """
    category = data.get("category", "企业管理")
    audience = data.get("audience", "工厂老板")
    fallback = {
        "note_title": f"{category}｜{audience}必看",
        "note_body": "分享几个实操做法，评论区扣「方案」领清单。",
        "guide_comment": "评论区扣「方案」",
        "tags": ["#企业管理", "#获客"],
    }
    data_out = llm_json(
        llm,
        prompt=(
            f"{kb_prefix_for(data)}写一篇小红书笔记做精准获客。\n"
            f"品类/主题：{category}\n"
            f"目标人群：{audience}\n\n"
            f"请输出：\n"
            f"1. note_title：标题（小红书风格，20 字内，可用数字/符号/反差，但要精准不是标题党）\n"
            f"2. note_body：正文（300-500 字，分段用换行，开头 2 句必须抓住目标人群，可含真实案例细节、"
            f"避坑提醒、具体数字，结尾给互动指令；要有 emoji 分隔但别太多）\n"
            f"3. guide_comment：评论区引导话术（要给出具体钩子，如「扣『清单』我发你」而不是「欢迎留言」）\n"
            f"4. tags：6-8 个标签（精准标签 + 大盘标签混合）\n"
            f"5. cover_text：封面大字文案（12 字内）\n"
            f"6. comment_hooks：预埋 3 条自评论或回复话术（用于引导互动，真实不生硬）\n"
            f"7. images：配图建议 4 条（写清每张图拍什么）\n\n"
            f"小红书用户反感硬广，像朋友分享一样写。"
        ),
        system="你是小红书爆款笔记操盘手，会用平台语言，但不油不硬广。",
        schema_hint='{"note_title":"","note_body":"","guide_comment":"","tags":[""],"cover_text":"","comment_hooks":[""],"images":[""]}',
        fallback=fallback,
        max_tokens=4000,
    )
    for k, v in fallback.items():
        if k not in data_out or data_out[k] in (None, "", [], {}):
            data_out[k] = v
    return {"note_title": data_out["note_title"], "note_body": data_out["note_body"],
            "guide_comment": data_out["guide_comment"], "tags": data_out["tags"],
            "cover_text": data_out.get("cover_text") or "",
            "comment_hooks": data_out.get("comment_hooks") or [],
            "images": data_out.get("images") or [], "知识依据": kb_refs_for(data), "ai_note": ""}


class XiaohongshuAgent(BaseAgent):
    module_id = "08"
    name = "小红书精准获客员工"
    layer = "L1"
    priority = "P2"
    description = "小红书内容获客与线索收集"
    input_schema = {"category": "品类", "audience": "目标人群"}
    output_keys = {"note_title": "笔记标题", "note_body": "笔记正文", "guide_comment": "评论区引导话术"}
    run_logic = staticmethod(run_logic_08)
