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


def _ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ------------------------------------------------------------------ 18
def run_logic_18(data, llm=None):
    """心流指挥官（文科）：围绕情绪/性格/成长，产出关怀引导指令与陪伴节奏。"""
    theme = data.get("theme") or "情绪觉察与个人成长"
    profile = data.get("user_profile") or {}
    directive = {
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
    }
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"为'{theme}'主题给一条最有温度的引导开场（不超过 40 字）。",
                system="你是文科心流教练，温暖、朋友式。")
        except Exception:
            ai_note = ""
    return {"directive": directive, "handoff_to": "1号卿听心流拍档", "ai_note": ai_note}


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
def run_logic_19(data, llm=None):
    """战略指挥官（理科）：把业务目标拆成执行铺排，择一协同模式，指定派单。"""
    goal = data.get("goal") or "把一件事做成的战略与执行铺排"
    context = data.get("context") or ""
    # 三模式：目标清晰→目标模式；半清晰→协同模式；模糊→探讨模式
    clear = "清晰" in str(context) or "明确" in str(context)
    half = "半清晰" in str(context) or "已有方案" in str(context)
    mode = "目标模式" if clear else ("协同模式" if half else "探讨模式")
    directive = {
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
    }
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"针对'{goal}'（{context}）指出一个最容易被忽略的执行风险，不超过 50 字。",
                system="你是理科战略参谋，直接犀利。")
        except Exception:
            ai_note = ""
    return {"directive": directive, "handoff_to": "2号卿听战略拍档", "ai_note": ai_note}


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
def run_logic_20(data, llm=None):
    """拆解指挥官（黑箱）：把场景按黑箱四步拆透，产出 PRD 骨架，交 4 号搭技能。"""
    scenario = data.get("scenario") or "待拆解的场景/想法"
    directive = {
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
    }
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"对'{scenario}'给一个最容易忽视的盲区追问（一次只问一个，不超 40 字）。",
                system="你是黑箱拆解思维教练，教练式引导，不代劳。")
        except Exception:
            ai_note = ""
    return {"directive": directive, "handoff_to": "3号卿听黑箱拆解使者 → 4号灵魂技能使者", "ai_note": ai_note}


class DecomposeCommander(BaseAgent):
    module_id = "20"
    name = "卿听拆解指挥官"
    layer = "L0"
    priority = "P0"
    description = "黑箱指挥层：按四步拆透场景，产出 PRD 骨架与打卡海报，交 4 号搭技能"
    input_schema = {"scenario": "待拆解的场景/想法"}
    output_keys = {"directive": "黑箱拆解指令", "handoff_to": "交接对象"}
    run_logic = staticmethod(run_logic_20)
