"""模块注册表：集中注册 17 个 AI 员工，支持按 module_id 查询与实例化。"""
from typing import Dict, List, Optional

from core.agent import BaseAgent

from agents.l1_acquisition import (
    CommentOpportunityAgent, DailyTopicAgent, ForeignTradeAgent,
    LeadRadarAgent, XiaohongshuAgent,
)
from agents.l2_content import (
    AutoEditorAgent, BloggerTeardownAgent, GzhPublisherAgent,
    VideoScriptAgent, ViralRadarAgent,
)
from agents.l3_conversion import ChatAnalysisAgent, FollowUpAgent, TieringAgent
from agents.l4_analysis import GeoDiagnosisAgent, IndustryAnalystAgent, InvestResearchAgent
from agents.l5_management import DispatcherAgent

# 模块类注册表（顺序即展示顺序）
AGENT_CLASSES: List[type] = [
    LeadRadarAgent,        # 01
    FollowUpAgent,         # 02
    CommentOpportunityAgent,  # 03
    ChatAnalysisAgent,     # 04
    ViralRadarAgent,       # 05
    DailyTopicAgent,       # 06
    ForeignTradeAgent,     # 07
    XiaohongshuAgent,      # 08
    TieringAgent,          # 09
    GeoDiagnosisAgent,     # 10
    DispatcherAgent,       # 11
    VideoScriptAgent,      # 12
    BloggerTeardownAgent,  # 13
    AutoEditorAgent,       # 14
    GzhPublisherAgent,     # 15
    IndustryAnalystAgent,  # 16
    InvestResearchAgent,   # 17
]


def get_agent_classes() -> List[type]:
    return list(AGENT_CLASSES)


def find_agent_class(module_id: str) -> Optional[type]:
    for cls in AGENT_CLASSES:
        if cls.module_id == module_id:
            return cls
    return None


def instantiate_all(llm) -> Dict[str, BaseAgent]:
    """实例化全部模块（注入同一 LLM 客户端）。"""
    agents: Dict[str, BaseAgent] = {}
    for cls in AGENT_CLASSES:
        agents[cls.module_id] = cls(llm=llm)
    return agents


def list_meta() -> List[Dict]:
    return [cls(llm=None).meta() for cls in AGENT_CLASSES]
