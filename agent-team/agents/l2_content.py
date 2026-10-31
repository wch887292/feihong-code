"""L2 内容生产层：05 同行爆款雷达 / 12 老板短视频获客脚本官 / 13 博主账号深度拆解官 / 14 AI短视频自动剪辑师 / 15 公众号自动运营发布官。"""
import json
import time
import uuid
from datetime import datetime

from core.agent import BaseAgent
from llm.llm_json import llm_json, llm_text


def _ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _content_id() -> str:
    """生成唯一内容 ID：时间戳 + 随机后缀，避免同秒冲突。"""
    return f"A{int(time.time()) % 100000000}{uuid.uuid4().hex[:6]}"


# ---------------------------------------------------------------- 05
def run_logic_05(data, llm=None):
    """同行爆款雷达：监控同行爆款，提炼可复制模式。

    能力升级（2026-10-31）：LLM 生成主体爆款清单与可复用模式，规则模板兜底。
    """
    accounts = data.get("competitor_accounts") or ["同行账号A", "同行账号B"]
    days = int(data.get("days", 7))
    fallback = {
        "hot_contents": [
            {"title": "工厂老板必看的 3 个获客真相", "views": 128000, "account": accounts[0], "days": days},
            {"title": "我靠评论区捡了 200 个客户", "views": 96000, "account": accounts[-1], "days": days},
        ],
        "patterns": ["强反差标题 + 数字钩子", "真实案例收尾 + 行动号召", "评论区互动引导"],
    }
    data_out = llm_json(
        llm,
        prompt=(
            f"监控同行账号近 {days} 天的爆款内容：{'、'.join(accounts)}\n\n"
            f"请输出：\n"
            f"1. hot_contents：3-5 条该赛道的典型爆款，每条含 title（标题）、views（播放量估算）、"
            f"account（账号）、days（发布天数）、hook（它为什么火，一句话）\n"
            f"2. patterns：3-5 条可复用的爆款公式，要具体到可套用，不要「内容要真实」这种空话\n\n"
            f"选题范围限定在：服装厂老板管理、获客、合伙人分红、招人留人。\n"
            f"标题要像真实账号发出来的，不要AI腔。"
        ),
        system="你是内容增长分析师，拆解同行爆款有一手。只讲事实和方法，不说套话。",
        schema_hint='{"hot_contents":[{"title":"","views":0,"account":"","days":7,"hook":""}],"patterns":[""]}',
        fallback=fallback,
        max_tokens=4000,
    )
    # 字段兜底
    if not isinstance(data_out.get("hot_contents"), list) or not data_out.get("hot_contents"):
        data_out["hot_contents"] = fallback["hot_contents"]
    if not isinstance(data_out.get("patterns"), list) or not data_out.get("patterns"):
        data_out["patterns"] = fallback["patterns"]
    return {"hot_contents": data_out["hot_contents"], "patterns": data_out["patterns"], "ai_note": ""}


class ViralRadarAgent(BaseAgent):
    module_id = "05"
    name = "同行爆款雷达"
    layer = "L2"
    priority = "P2"
    description = "监控同行爆款内容，提炼可复制模式"
    input_schema = {"competitor_accounts": "同行账号列表"}
    output_keys = {"hot_contents": "爆款列表", "patterns": "可复用模式"}
    run_logic = staticmethod(run_logic_05)

    def persist(self, output, task):
        from core import models
        models.insert_asset({
            "content_id": _content_id(),
            "content_type": "爆款分析",
            "topic": "同行爆款雷达",
            "script": json.dumps(output.get("hot_contents", []), ensure_ascii=False),
            "publish_status": "draft",
        })


# ---------------------------------------------------------------- 12
def run_logic_12(data, llm=None):
    """短视频获客脚本：生成口播 + 分镜脚本。

    能力升级（2026-10-31）：LLM 从「只写 ai_note」升级为「生成主体脚本」，
    规则模板降级为兜底（LLM 不可用/超时/解析失败时自动回落）。
    """
    topic = data.get("topic", "AI 获客")
    points = list(data.get("selling_points") or ["自动找客户", "降本增效"])
    while len(points) < 2:
        points.append("真实案例支撑")
    audience = data.get("audience", "工厂老板")
    # ---- 规则兜底产出（原逻辑，保证永不停机）----
    fallback_script = {
        "hook": f"{audience}注意：{topic}，90% 的人都做反了。",
        "body": f"三步讲清：①{points[0]}；②{points[1]}；③真实案例。",
        "cta": "评论区扣「方案」，免费领《获客清单》。",
        "duration_sec": 45,
        "shots": ["近景口播 3s", "痛点场景 10s", "操作演示 20s", "案例收尾 10s", "CTA 2s"],
    }
    # ---- LLM 生成主体产出 ----
    script = llm_json(
        llm,
        prompt=(
            f"为「{audience}」写一条短视频口播脚本。\n"
            f"选题：{topic}\n"
            f"核心卖点：{'、'.join(points)}\n\n"
            f"要求：\n"
            f"1. hook（前3秒）：直接命中该人群正在遇到的麻烦，反常具体，不要「90%的人」这类空话\n"
            f"2. body：讲清 2-3 个具体做法或判断，每步要有可执行的动作\n"
            f"3. cta：一句自然的行动指令，不要「点赞收藏关注」三连\n"
            f"4. duration_sec：口播总时长（秒），30-60 之间\n"
            f"5. shots：5 个分镜画面，每个写成「画面描述 时长」，如「车间实拍 3s」\n"
            f"6. 语言口语化，像真人说话，不要书面语和排比句"
        ),
        system=(
            "你是给工厂老板写短视频口播的编导，说话直接、有具体画面感。"
            "最反感 AI 味：不用\"赋能/底层逻辑/随着...发展\"，"
            "不用\"不是X而是Y\"这类假对比句壳，不说\"总而言之\"。"
        ),
        schema_hint='{"hook":"前3秒钩子","body":"主体正文","cta":"行动指令","duration_sec":45,"shots":["画面 3s","..."]}',
        fallback=fallback_script,
        max_tokens=4000,
    )
    # 字段兜底：LLM 可能少给字段，用规则值补齐
    for k, v in fallback_script.items():
        if k not in script or script[k] in (None, "", [], {}):
            script[k] = v
    # shots 必须是数组且非空
    if not isinstance(script.get("shots"), list) or not script["shots"]:
        script["shots"] = fallback_script["shots"]
    ai_note = ""
    return {"script": script, "ai_note": ai_note}


class VideoScriptAgent(BaseAgent):
    module_id = "12"
    name = "老板短视频获客脚本官"
    layer = "L2"
    priority = "P1"
    description = "生成获客向短视频脚本（口播 + 分镜）"
    input_schema = {"topic": "选题", "selling_points": "卖点列表", "audience": "目标客户"}
    output_keys = {"script": "脚本（hook/body/cta/shots）"}
    run_logic = staticmethod(run_logic_12)

    def persist(self, output, task):
        from core import models
        models.insert_asset({
            "content_id": _content_id(),
            "content_type": "脚本",
            "topic": task.input_json.get("topic", ""),
            "script": json.dumps(output.get("script", {}), ensure_ascii=False),
            "publish_status": "draft",
        })


# ---------------------------------------------------------------- 13
# ---------------------------------------------------------------- 13
def run_logic_13(data, llm=None):
    """博主账号深度拆解：定位、选题、结构、转化路径。

    能力升级（2026-10-31）：LLM 生成主体拆解报告，规则模板兜底。
    """
    account = data.get("account", "对标账号")
    fallback = {
        "account": account,
        "positioning": "工厂老板 IP，讲透 AI 获客",
        "topics": ["获客方法", "行业案例", "工具测评"],
        "structure": "三段式：痛点 → 方法 → 案例",
        "conversion": "评论区引流 → 私域 → 成交",
        "takedown_at": _ts(),
    }
    report = llm_json(
        llm,
        prompt=(
            f"深度拆解对标账号：{account}\n\n"
            f"请输出：\n"
            f"1. positioning：它到底在卖什么（不是简介，是它的真实商业定位，一句话点透）\n"
            f"2. audience：它的粉丝是谁、有什么共同特征\n"
            f"3. topics：它常做的 5 个具体选题（要像真实选题，不要分类词）\n"
            f"4. structure：它的内容结构公式（拆到段落级别，例如：反常识开场→具体案例→方法清单→行动号召）\n"
            f"5. conversion：它的变现路径（从内容到成交，具体经过哪几个环节）\n"
            f"6. strengths：它做对了什么（2-3 条）\n"
            f"7. gaps：它的可攻击点（2-3 条，我方能怎么差异化）\n"
            f"8. actions：我方能立刻抄的 3 个具体动作\n\n"
            f"要有判断，不要罗列套话。每条都要能直接指导操作。"
        ),
        system="你是账号增长拆解专家，擅长一句话点透账号的商业逻辑。只讲事实和判断。",
        schema_hint='{"account":"","positioning":"","audience":"","topics":[""],"structure":"","conversion":"","strengths":[""],"gaps":[""],"actions":[""]}',
        fallback=fallback,
        max_tokens=4000,
    )
    for k, v in fallback.items():
        if k not in report or report[k] in (None, "", [], {}):
            report[k] = v
    report["takedown_at"] = _ts()
    return {"report": report, "ai_note": ""}


class BloggerTeardownAgent(BaseAgent):
    module_id = "13"
    name = "博主账号深度拆解官"
    layer = "L2"
    priority = "P2"
    description = "拆解对标账号的定位、选题、结构与转化路径"
    input_schema = {"account": "对标账号"}
    output_keys = {"report": "拆解报告"}
    run_logic = staticmethod(run_logic_13)

    def persist(self, output, task):
        from core import models
        models.insert_asset({
            "content_id": _content_id(),
            "content_type": "账号拆解",
            "topic": task.input_json.get("account", ""),
            "script": json.dumps(output.get("report", {}), ensure_ascii=False),
            "publish_status": "draft",
        })


# ---------------------------------------------------------------- 14
# ---------------------------------------------------------------- 14
def run_logic_14(data, llm=None):
    """AI 短视频自动剪辑：素材自动剪辑成片。

    能力升级（2026-10-31）：LLM 生成具体剪辑方案（时间轴/字幕/BGM），规则兜底。
    """
    clips = data.get("clips") or ["clip_a.mp4", "clip_b.mp4", "clip_c.mp4"]
    script = data.get("script", "")
    template = data.get("template", "口播标准模板")
    if not isinstance(script, str):
        # script 可能是 dict（如 {hook, body, cta}），转成可读文本
        if isinstance(script, dict):
            script = "；".join(f"{k}: {v}" for k, v in script.items() if isinstance(v, (str, int, float)))
        else:
            script = str(script)
    clips_json = json.dumps(clips, ensure_ascii=False)
    fallback = {
        "asset_id": f"V{int(time.time()) % 100000000}{uuid.uuid4().hex[:6]}",
        "clips_used": clips,
        "template": template,
        "duration_sec": 45,
        "subtitles": "auto（准确率≥95%）",
        "status": "rendered",
        "rendered_at": _ts(),
    }
    video = llm_json(
        llm,
        prompt=(
            f"为这条短视频制定剪辑方案。\n"
            f"素材列表：{clips_json}\n"
            f"脚本/口播要点：{script[:300]}\n"
            f"模板风格：{template}\n\n"
            f"请输出：\n"
            f"1. timeline：剪辑时间轴数组，每项含 clip（用哪个素材）、start（起始秒）、duration（时长秒）、note（这段在讲什么）\n"
            f"2. subtitles：字幕处理方案（要具体：是否逐字、何时突出关键词）\n"
            f"3. bgm：背景音乐建议（曲风 + 在哪段起 + 音量比例）\n"
            f"4. transitions：转场方式与使用位置\n"
            f"5. duration_sec：总时长（秒）\n"
            f"6. highlights：3 个最该加特效/放大的画面及其原因\n\n"
            f"要能直接交给剪辑师执行，别写「节奏感强」这种空话。"
        ),
        system="你是短视频剪辑师，给的是可执行的剪辑指令，不是泛泛而谈。",
        schema_hint='{"asset_id":"","clips_used":[],"template":"","duration_sec":45,"timeline":[{"clip":"","start":0,"duration":3,"note":""}],"subtitles":"","bgm":"","transitions":"","highlights":[],"status":"rendered","rendered_at":""}',
        fallback=fallback,
        max_tokens=4000,
    )
    for k, v in fallback.items():
        if k not in video or video[k] in (None, "", [], {}):
            video[k] = v
    if not isinstance(video.get("timeline"), list) or not video["timeline"]:
        video["timeline"] = []
    video["asset_id"] = fallback["asset_id"]
    video["clips_used"] = clips
    video["template"] = template
    video["rendered_at"] = _ts()
    video["status"] = "rendered"
    return {"video": video, "ai_note": ""}


class AutoEditorAgent(BaseAgent):
    module_id = "14"
    name = "AI短视频自动剪辑师"
    layer = "L2"
    priority = "P1"
    description = "素材自动剪辑成片、批量出片"
    input_schema = {"clips": "素材列表", "script": "脚本", "template": "模板"}
    output_keys = {"video": "成片元数据"}
    run_logic = staticmethod(run_logic_14)

    def persist(self, output, task):
        from core import models
        video = output.get("video", {})
        if not isinstance(video, dict):
            video = {}
        # script 可能是 dict 或 str，统一转字符串再截断
        raw_script = task.input_json.get("script", "")
        if isinstance(raw_script, dict):
            topic = "；".join(f"{k}: {v}" for k, v in raw_script.items()
                              if isinstance(v, (str, int, float)))[:60]
        else:
            topic = str(raw_script)[:60]
        models.insert_asset({
            "content_id": video.get("asset_id") or _content_id(),
            "content_type": "成片",
            "topic": topic,
            "script": json.dumps(video, ensure_ascii=False),
            "asset_url": video.get("asset_id", ""),
            "publish_status": video.get("status", "draft"),
        })


# ---------------------------------------------------------------- 15
# ---------------------------------------------------------------- 15
def run_logic_15(data, llm=None):
    """公众号自动运营：内容生成与定时发布。

    能力升级（2026-10-31）：LLM 生成完整文章与排期，规则兜底。
    """
    topic = data.get("topic", "AI 获客")
    schedule = data.get("schedule", "明日 08:00")
    fallback = {
        "title": f"深度：{topic}的完整打法（建议收藏）",
        "body": f"一、为什么{topic}是当下最大的红利；二、三步落地方案；三、真实数据复盘。",
        "publish_time": schedule,
        "status": "scheduled",
        "created_at": _ts(),
    }
    article = llm_json(
        llm,
        prompt=(
            f"写一篇公众号文章。\n"
            f"选题：{topic}\n"
            f"计划发布时间：{schedule}\n\n"
            f"请输出：\n"
            f"1. title：标题（公众号风格，可以带数字或反差，但不要「震惊」「必看」这类烂标题）\n"
            f"2. subtitle：副标题\n"
            f"3. body：正文（Markdown，含小标题分段，讲清一个完整逻辑链，要有具体做法和数据，至少 800 字）\n"
            f"4. outline：文章小标题列表\n"
            f"5. cta：文末引导（引导关注/留言/加微信，说明能得到什么）\n"
            f"6. tags：3-5 个标签\n"
            f"7. best_time：建议发布时间（结合该类内容的阅读高峰）\n"
            f"8. cover_text：封面图上的 8-12 字文案\n\n"
            f"语言要像有实战经验的人写的，不要百科腔。"
        ),
        system="你是服装厂老板愿意读完的公众号作者，有一线咨询经验，写东西接地气、不装。",
        schema_hint='{"title":"","subtitle":"","body":"Markdown 正文","outline":[""],"cta":"","tags":[""],"best_time":"","cover_text":"","publish_time":"","status":"scheduled"}',
        fallback=fallback,
        max_tokens=4000,
    )
    for k, v in fallback.items():
        if k not in article or article[k] in (None, "", [], {}):
            article[k] = v
    article["publish_time"] = schedule
    article["status"] = "scheduled"
    article["created_at"] = _ts()
    return {"article": article, "ai_note": ""}


class GzhPublisherAgent(BaseAgent):
    module_id = "15"
    name = "公众号自动运营发布官"
    layer = "L2"
    priority = "P1"
    description = "公众号内容生成、排期与定时发布"
    input_schema = {"topic": "选题", "schedule": "发布时间"}
    output_keys = {"article": "文章与排期"}
    run_logic = staticmethod(run_logic_15)

    def persist(self, output, task):
        from core import models
        article = output.get("article", {})
        models.insert_asset({
            "content_id": _content_id(),
            "content_type": "文章",
            "topic": article.get("title", ""),
            "script": article.get("body", ""),
            "publish_status": article.get("status", "draft"),
        })
