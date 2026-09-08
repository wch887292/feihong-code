"""L2 内容生产层：05 同行爆款雷达 / 12 老板短视频获客脚本官 / 13 博主账号深度拆解官 / 14 AI短视频自动剪辑师 / 15 公众号自动运营发布官。"""
import json
import time
from datetime import datetime

from core.agent import BaseAgent


def _ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------- 05
def run_logic_05(data, llm=None):
    """同行爆款雷达：监控同行爆款，提炼可复制模式。"""
    accounts = data.get("competitor_accounts") or ["同行账号A", "同行账号B"]
    days = int(data.get("days", 7))
    hot = [
        {"title": "工厂老板必看的 3 个获客真相", "views": 128000, "account": accounts[0], "days": days},
        {"title": "我靠评论区捡了 200 个客户", "views": 96000, "account": accounts[-1], "days": days},
    ]
    patterns = ["强反差标题 + 数字钩子", "真实案例收尾 + 行动号召", "评论区互动引导"]
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"近 {days} 天爆款 {json.dumps(hot, ensure_ascii=False)}，提炼 1 条可复用选题公式，不超过 60 字。",
                system="你是内容增长分析师。")
        except Exception:
            ai_note = ""
    return {"hot_contents": hot, "patterns": patterns, "ai_note": ai_note}


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
            "content_id": f"A{int(time.time()) % 100000000}",
            "content_type": "爆款分析",
            "topic": "同行爆款雷达",
            "script": json.dumps(output.get("hot_contents", []), ensure_ascii=False),
            "publish_status": "draft",
        })


# ---------------------------------------------------------------- 12
def run_logic_12(data, llm=None):
    """短视频获客脚本：生成口播 + 分镜脚本。"""
    topic = data.get("topic", "AI 获客")
    points = list(data.get("selling_points") or ["自动找客户", "降本增效"])
    while len(points) < 2:
        points.append("真实案例支撑")
    audience = data.get("audience", "工厂老板")
    script = {
        "hook": f"{audience}注意：{topic}，90% 的人都做反了。",
        "body": f"三步讲清：①{points[0]}；②{points[1]}；③真实案例。",
        "cta": "评论区扣「方案」，免费领《获客清单》。",
        "duration_sec": 45,
        "shots": ["近景口播 3s", "痛点场景 10s", "操作演示 20s", "案例收尾 10s", "CTA 2s"],
    }
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"选题 {topic}、卖点 {points}，重写黄金 3 秒钩子，不超过 40 字。",
                system="你是短视频编导。")
        except Exception:
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
            "content_id": f"A{int(time.time()) % 100000000}",
            "content_type": "脚本",
            "topic": task.input_json.get("topic", ""),
            "script": json.dumps(output.get("script", {}), ensure_ascii=False),
            "publish_status": "draft",
        })


# ---------------------------------------------------------------- 13
def run_logic_13(data, llm=None):
    """博主账号拆解：拆解对标账号的定位、选题、结构、转化路径。"""
    account = data.get("account", "对标账号A")
    report = {
        "account": account,
        "positioning": "工厂老板 IP，讲透 AI 获客",
        "topics": ["获客方法", "行业案例", "工具测评"],
        "structure": "三段式：痛点 → 方法 → 案例",
        "conversion": "评论区引流 → 私域 → 成交",
        "takedown_at": _ts(),
    }
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"拆解账号 {account}，给出 1 条可立即复用的打法，不超过 60 字。",
                system="你是账号增长拆解专家。")
        except Exception:
            ai_note = ""
    return {"report": report, "ai_note": ai_note}


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
            "content_id": f"A{int(time.time()) % 100000000}",
            "content_type": "账号拆解",
            "topic": task.input_json.get("account", ""),
            "script": json.dumps(output.get("report", {}), ensure_ascii=False),
            "publish_status": "draft",
        })


# ---------------------------------------------------------------- 14
def run_logic_14(data, llm=None):
    """AI 短视频自动剪辑：素材自动剪辑成片。"""
    clips = data.get("clips") or ["clip_a.mp4", "clip_b.mp4", "clip_c.mp4"]
    script = data.get("script", "")
    template = data.get("template", "口播标准模板")
    video = {
        "asset_id": f"V{int(time.time()) % 100000000}",
        "clips_used": clips,
        "template": template,
        "duration_sec": 45,
        "subtitles": "auto（准确率≥95%）",
        "status": "rendered",
        "rendered_at": _ts(),
    }
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"脚本要点：{script[:100]}，给出剪辑节奏建议，不超过 50 字。",
                system="你是视频剪辑师。")
        except Exception:
            ai_note = ""
    return {"video": video, "ai_note": ai_note}


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
        models.insert_asset({
            "content_id": video.get("asset_id", f"A{int(time.time()) % 100000000}"),
            "content_type": "成片",
            "topic": task.input_json.get("script", "")[:60],
            "script": json.dumps(video, ensure_ascii=False),
            "asset_url": video.get("asset_id", ""),
            "publish_status": video.get("status", "draft"),
        })


# ---------------------------------------------------------------- 15
def run_logic_15(data, llm=None):
    """公众号自动运营：内容生成与定时发布。"""
    topic = data.get("topic", "AI 获客")
    schedule = data.get("schedule", "明日 08:00")
    article = {
        "title": f"深度：{topic}的完整打法（建议收藏）",
        "body": f"一、为什么{topic}是当下最大的红利；二、三步落地方案；三、真实数据复盘。",
        "publish_time": schedule,
        "status": "scheduled",
        "created_at": _ts(),
    }
    ai_note = ""
    if llm is not None and getattr(llm, "provider", "mock") != "mock":
        try:
            ai_note = llm.complete(
                f"公众号选题 {topic}，给 1 个标题备选，不超过 40 字。",
                system="你是公众号主编。")
        except Exception:
            ai_note = ""
    return {"article": article, "ai_note": ai_note}


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
            "content_id": f"A{int(time.time()) % 100000000}",
            "content_type": "文章",
            "topic": article.get("title", ""),
            "script": article.get("body", ""),
            "publish_status": article.get("status", "draft"),
        })
