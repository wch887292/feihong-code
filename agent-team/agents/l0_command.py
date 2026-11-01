"""L0 指挥层：卿听三使者 · 执行指挥官（18 心流 / 19 战略 / 20 拆解）。

晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人：吴赐虹

来源：桌面《卿听生长空间》三大使者身份设定文档（1号文科/2号理科/3号黑箱），
抽象为 fhcode 三个顶级指挥官员工，承担"执行指挥官"职责——
把上层目标拆解为可执行子指令，指定派给下属（对应业务员工或三使者执行体），
并声明交接对象。run_logic 为模块级纯函数（mock 可跑、LLM 增强），
与 11 号调度官同一风格，不依赖实例与数据库。
"""
import json
from datetime import datetime

from core.agent import BaseAgent
from llm.llm_json import llm_json, llm_text
from agents.kb_utils import kb_prefix_for, kb_refs_for


def _ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ------------------------------------------------------------------ 18
# ---------------------------------------------------------------- 18
def run_logic_18(data, llm=None):
    """心流指挥官（文科）：围绕情绪/性格/成长，产出关怀引导指令与陪伴节奏。

    能力升级（2026-10-31）：LLM 生成主体关怀指令（原先仅固定条目），规则模板兜底。
    """
    theme = data.get("theme") or "情绪觉察与个人成长"
    profile = data.get("user_profile") or {}
    fallback = {
        "directive": {
            "目标主题": theme,
            "引导基调": "先卿听再生长：先看见情绪，不回避不评判，再从中找方法",
            "关怀要点": [
                "未来愿景锚定：用学员自己想成为的那个人驱动改变，而非外部施压",
                "情绪决策缓冲：重大决定先问'出于恐惧还是判断'，不顺着情绪支持",
                "角色边界：聊到具体事务时温柔拉回情绪/性格/成长维度",
            ],
            "陪伴节奏": {"晨间": "9:00 主动激励 + 今日5分钟小实验", "晚间": "22:00 心情总结/赞美日记", "周复盘": "周六 20:15 综合回看"},
            "产出物": "USER.md 用户档案（含 MBTI/原生性格/卡点/未来愿景画像），供理科指挥官接收",
            "planned_at": _ts(),
        },
        "handoff_to": "1号卿听心流拍档",
    }
    data_out = llm_json(
        llm,
        prompt=(
            f"{kb_prefix_for(data)}为一个正在经历「{theme}」的人写一份关怀引导指令。\n"
            f"已知用户画像：{json.dumps(profile, ensure_ascii=False) if profile else '（暂无）'}\n\n"
            f"请输出：\n"
            f"1. 目标主题：本次关怀的主题（要具体到这一阶段的课题，不是泛泛的「成长」）\n"
            f"2. 引导基调：一句话说明这轮该用什么姿态接（不要说教）\n"
            f"3. 关怀要点：3 条，每条含 point（关怀什么）、how（怎么说，具体到措辞风格）、avoid（别踩什么坑）\n"
            f"4. 第一个问题：开口问的第一句话（要能让人卸下防备，不是访谈式提问）\n"
            f"5. 陪伴节奏：晨间/晚间/周复盘三个时段的具体安排（每项写清做什么、几分钟）\n"
            f"6. 情绪红线：什么情况下该停止引导、转介专业帮助\n"
            f"7. 产出物：本轮要形成的档案内容\n\n"
            f"语气温暖但不黏人，尊重对方自己说，教练式引导不代劳。"
        ),
        system="你是文科心流教练，温暖、朋友式，教练式引导不代劳，绝不评判。",
        schema_hint='{"directive":{"目标主题":"","引导基调":"","关怀要点":[{"point":"","how":"","avoid":""}],"第一个问题":"","陪伴节奏":{"晨间":"","晚间":"","周复盘":""},"情绪红线":"","产出物":"","planned_at":""}}',
        fallback=fallback,
        max_tokens=4000,
    )
    directive = data_out.get("directive")
    if not isinstance(directive, dict) or not directive:
        directive = fallback["directive"]
    # 系统事实字段由代码强制覆盖，不采信模型生成值
    directive["planned_at"] = _ts()
    # 交接对象由 SPEC 固化，不采信模型输出
    handoff = "1号卿听心流拍档"
    return {"directive": directive, "handoff_to": handoff, "知识依据": kb_refs_for(data), "ai_note": ""}


class HeartflowCommander(BaseAgent):
    module_id = "18"
    name = "卿听心流指挥官"
    layer = "L0"
    priority = "P0"
    description = "文科指挥层：定情绪/性格/成长引导基调，排陪伴节奏，产出 USER 档案交理科"
    input_schema = {"theme": "关怀主题/情绪方向"}
    output_keys = {"directive": "关怀引导指令", "handoff_to": "交接对象"}
    run_logic = staticmethod(run_logic_18)


# ------------------------------------------------------------------ 19
# ---------------------------------------------------------------- 19
def run_logic_19(data, llm=None):
    """战略指挥官（理科）：把业务目标拆成执行铺排，择一协同模式，指定派单。

    能力升级（2026-10-31）：LLM 生成主体战略指令，规则模板兜底。
    """
    goal = data.get("goal") or "把一件事做成的战略与执行铺排"
    context = data.get("context") or ""
    clear = "清晰" in str(context) or "明确" in str(context)
    half = "半清晰" in str(context) or "已有方案" in str(context)
    mode = "目标模式" if clear else ("协同模式" if half else "探讨模式")
    fallback = {
        "directive": {
            "业务目标": goal,
            "协同模式": mode,
            "执行铺排": [
                "需求确认：这是你想要的，还是对方想要的？（全局校准）",
                "路径规划：拆解 3-4 条可行路径，各带风险",
                "落地铺排：定到'谁在什么时间做什么、卡点在哪'",
                "阶段性结果：每步设可量化的验收点",
            ],
            "固定动作": "每次答后带『🌱 做事小结』：按轻重给两级（轻量表扬 / 深度鼓励+一条可执行建议）",
            "planned_at": _ts(),
        },
        "handoff_to": "2号卿听战略拍档",
    }
    data_out = llm_json(
        llm,
        prompt=(
            f"{kb_prefix_for(data)}把业务目标拆成可执行的战略铺排。\n"
            f"目标：{goal}\n"
            f"已知情况：{context}\n"
            f"协同模式：{mode}\n\n"
            f"请输出：\n"
            f"1. 目标校准：这个目标真正要达成的是什么（区分「事的目的」和「当下的规划」），"
            f"以及背后涉及谁的什么利益点（分组织/团队/个人三层）\n"
            f"2. 路径：3-4 条可行路径，每条含 path（怎么走）、pros（好处）、cons（代价）、risk（最大的风险）、fit（适合什么情况）\n"
            f"3. 推荐路径：选一条并说明理由\n"
            f"4. 执行铺排：4-6 条，每条含 who（谁做）、when（什么时候）、what（做什么）、checkpoint（卡点/验收标准）\n"
            f"5. 里程碑：3 个阶段性结果，每个含 milestone（是什么）、measure（怎么量化验收）、deadline\n"
            f"6. 风险清单：2-3 条，含 risk、trigger（什么信号出现要警惕）、countermeasure（怎么应对）\n"
            f"7. 固定动作：每次沟通后要做的小结动作\n\n"
            f"要具体到「谁在什么时间做什么」，不要只讲道理。"
        ),
        system="你是理科战略参谋，直接犀利，只讲能落地的动作。",
        schema_hint='{"directive":{"目标校准":"","路径":[{"path":"","pros":"","cons":"","risk":"","fit":""}],"推荐路径":"","执行铺排":[{"who":"","when":"","what":"","checkpoint":""}],"里程碑":[{"milestone":"","measure":"","deadline":""}],"风险清单":[{"risk":"","trigger":"","countermeasure":""}],"固定动作":"","planned_at":""}}',
        fallback=fallback,
        max_tokens=4000,
    )
    directive = data_out.get("directive")
    if not isinstance(directive, dict) or not directive:
        directive = fallback["directive"]
    directive["业务目标"] = goal
    directive["协同模式"] = mode
    # 系统事实字段由代码强制覆盖，不采信模型生成值
    directive["planned_at"] = _ts()
    # 交接对象由 SPEC 固化，不采信模型输出
    handoff = "2号卿听战略拍档"
    return {"directive": directive, "handoff_to": handoff, "知识依据": kb_refs_for(data), "ai_note": ""}


class StrategyCommander(BaseAgent):
    module_id = "19"
    name = "卿听战略指挥官"
    layer = "L0"
    priority = "P0"
    description = "理科指挥层：定战略与执行铺排，选协同模式，派单下属并强制做事小结"
    input_schema = {"goal": "业务目标/要解决的问题"}
    output_keys = {"directive": "战略执行指令", "handoff_to": "交接对象"}
    run_logic = staticmethod(run_logic_19)


# ------------------------------------------------------------------ 20
# ---------------------------------------------------------------- 20
def run_logic_20(data, llm=None):
    """拆解指挥官（黑箱）：按黑箱四步拆透场景，产出 PRD 骨架。

    能力升级（2026-10-31）：LLM 生成主体拆解指令与 PRD 骨架，规则模板兜底。
    """
    scenario = data.get("scenario") or "待拆解的场景/想法"
    fallback = {
        "directive": {
            "场景": scenario,
            "黑箱四步": [
                "步骤一 发现问题：爱与利他（爱事+爱人+爱自己），双向归因（自己/对方/工具机制），定场景类型",
                "步骤二 拆事的目的：分清 任务@目的 与 规划@当下，定成功标准；手段不是目的",
                "步骤三 拆人的利益点：组织/团队/个人三层利益，管理者底线与选人用人",
                "步骤四 场景策略闭环：之前/中间/之后时间线，每步问'还能再拆吗'，学员自己复盘串联",
            ],
            "PRD骨架": {"场景定义": "类型 + 一句话", "场景逻辑": "事的目的 + 人的利益点", "场景步骤": "之前/中间/之后"},
            "产出物": "打卡海报（三大模块）+ 交接 4号灵魂技能使者进入 Skill 搭建",
            "planned_at": _ts(),
        },
        "handoff_to": "3号卿听黑箱拆解使者 → 4号灵魂技能使者",
    }
    data_out = llm_json(
        llm,
        prompt=(
            f"{kb_prefix_for(data)}把这个场景彻底拆透。\n"
            f"场景：{scenario}\n\n"
            f"请按黑箱四步输出：\n"
            f"1. 发现问题：场景类型是什么；涉及哪些人的什么利益（爱与利他：爱事+爱人+爱自己）；"
            f"双向归因（自己/对方/工具机制各占多少）\n"
            f"2. 拆事的目的：这件事真正要达成什么（区分「任务@目的」与「规划@当下」），"
            f"成功标准是什么（可验收的指标），哪些只是手段\n"
            f"3. 拆人的利益点：组织/团队/个人三层各自的利益与冲突，管理者底线在哪，用人上的取舍\n"
            f"4. 场景策略闭环：之前/中间/之后三个时间线，每步问「还能再拆吗」\n\n"
            f"另外输出：\n"
            f"5. PRD骨架：包含场景定义（类型+一句话）、场景逻辑（事的目的+人的利益点）、场景步骤（之前/中间/之后）\n"
            f"6. 关键追问：3 个最该问但还没问的问题（一次只问一个，按优先级排序）\n"
            f"7. 最小可行动作：这周就能做的一件最小的事\n\n"
            f"教练式引导，不代劳，输出要能让对方自己想明白。"
        ),
        system="你是黑箱拆解思维教练，教练式引导不代劳，每步都追问'还能再拆吗'。",
        schema_hint='{"directive":{"场景":"","发现问题":"","拆事的目的":"","拆人的利益点":"","场景策略闭环":{"之前":"","中间":"","之后":""},"PRD骨架":{"场景定义":"","场景逻辑":"","场景步骤":""},"关键追问":[""],"最小可行动作":"","planned_at":""}}',
        fallback=fallback,
        max_tokens=4000,
    )
    directive = data_out.get("directive")
    if not isinstance(directive, dict) or not directive:
        directive = fallback["directive"]
    directive["场景"] = scenario
    # 系统事实字段由代码强制覆盖，不采信模型生成值
    directive["planned_at"] = _ts()
    # 交接对象由 SPEC 固化，不采信模型输出
    handoff = "3号卿听黑箱拆解使者 → 4号灵魂技能使者"
    return {"directive": directive, "handoff_to": handoff, "知识依据": kb_refs_for(data), "ai_note": ""}


class DecomposeCommander(BaseAgent):
    module_id = "20"
    name = "卿听拆解指挥官"
    layer = "L0"
    priority = "P0"
    description = "黑箱指挥层：按四步拆透场景，产出 PRD 骨架与打卡海报，交 4 号搭技能"
    input_schema = {"scenario": "待拆解的场景/想法"}
    output_keys = {"directive": "黑箱拆解指令", "handoff_to": "交接对象"}
    run_logic = staticmethod(run_logic_20)
