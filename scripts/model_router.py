#!/usr/bin/env python3
"""
多模型路由引擎
根据实例特征（仓库、问题类型、复杂度、历史表现）选择最优模型。
支持单模型路由和多模型集成（ensemble）。
"""
import json
import os
import sys
import re

BASE = os.path.join(os.path.dirname(__file__), "..")
REAL = os.path.join(BASE, "bench", "real")
CONFIG_FILE = os.path.join(REAL, "models_config.json")
DATA_FILE = os.path.join(REAL, "swebench_300.json")
HISTORY_FILE = os.path.join(REAL, "model_performance_history.json")


def load_config():
    """加载模型配置。"""
    if os.path.exists(CONFIG_FILE):
        return json.load(open(CONFIG_FILE, encoding="utf-8"))
    return None


def load_instance(idx):
    """加载指定索引的实例。"""
    data = json.load(open(DATA_FILE, encoding="utf-8"))
    return data[idx]


def estimate_complexity(inst):
    """估算问题复杂度。
    基于 problem_statement 长度、FAIL_TO_PASS 数量、涉及文件数等。
    """
    ps = inst.get("problem_statement", "")
    ftps = json.loads(inst.get("FAIL_TO_PASS", "[]")) if inst.get("FAIL_TO_PASS") else []
    score = 0

    # 问题描述长度
    if len(ps) > 2000:
        score += 2
    elif len(ps) > 500:
        score += 1

    # 测试数量
    if len(ftps) > 10:
        score += 2
    elif len(ftps) > 3:
        score += 1

    # 关键词检测
    complex_keywords = ["refactor", "restructure", "redesign", "performance", "optimize",
                         "complex", "multiple", "interactions", "dependency", "migration"]
    ps_lower = ps.lower()
    for kw in complex_keywords:
        if kw in ps_lower:
            score += 1
            break

    if score >= 4:
        return "complex"
    elif score >= 2:
        return "medium"
    else:
        return "simple"


def detect_problem_type(inst):
    """检测问题类型。"""
    ps = inst.get("problem_statement", "").lower()
    if any(kw in ps for kw in ["add ", "implement", "support", "feature", "new "]):
        return "feature_request"
    elif any(kw in ps for kw in ["refactor", "restructure", "clean up", "reorganize"]):
        return "refactoring"
    elif any(kw in ps for kw in ["performance", "slow", "optimize", "speed", "memory"]):
        return "performance"
    elif any(kw in ps for kw in ["document", "docstring", "comment", "readme"]):
        return "documentation"
    else:
        return "bug_fix"


def load_history():
    """加载模型历史表现。"""
    if os.path.exists(HISTORY_FILE):
        return json.load(open(HISTORY_FILE, encoding="utf-8"))
    return {"model_stats": {}, "repo_stats": {}}


def route_model(inst, config=None, use_ensemble=False):
    """路由选择模型。
    返回选定的模型 key 或集成模型列表。
    """
    if config is None:
        config = load_config()
    if config is None:
        return "deepseek-v4-flash"

    repo = inst.get("repo", "")
    complexity = estimate_complexity(inst)
    problem_type = detect_problem_type(inst)
    history = load_history()

    # 集成模式
    if use_ensemble and config.get("ensemble", {}).get("enabled", False):
        return config["ensemble"]["models"]

    # 按仓库路由
    routing = config.get("routing_rules", {})
    by_repo = routing.get("by_repo", {})
    if repo in by_repo:
        return by_repo[repo]

    # 按复杂度路由
    by_complexity = routing.get("by_complexity", {})
    if complexity in by_complexity:
        return by_complexity[complexity]

    # 按问题类型路由
    by_problem_type = routing.get("by_problem_type", {})
    if problem_type in by_problem_type:
        return by_problem_type[problem_type]

    # 基于历史表现动态选择
    model_stats = history.get("model_stats", {})
    if model_stats:
        best_model = None
        best_score = -1
        for model, stats in model_stats.items():
            success_rate = stats.get("success_rate", 0)
            count = stats.get("count", 0)
            # 置信度加权：样本数越多，权重越高
            confidence = min(count / 10.0, 1.0)
            score = success_rate * confidence
            if score > best_score:
                best_score = score
                best_model = model
        if best_model and best_score > 0.5:
            return best_model

    # 默认模型
    return routing.get("default", "deepseek-v4-flash")


def update_history(instance_id, model, success, repo=""):
    """更新模型历史表现。"""
    history = load_history()
    model_stats = history.setdefault("model_stats", {})
    stats = model_stats.setdefault(model, {"count": 0, "success": 0, "fail": 0, "success_rate": 0.0})
    stats["count"] += 1
    if success:
        stats["success"] += 1
    else:
        stats["fail"] += 1
    stats["success_rate"] = stats["success"] / stats["count"] if stats["count"] > 0 else 0.0

    # 按仓库统计
    if repo:
        repo_stats = history.setdefault("repo_stats", {})
        repo_model = repo_stats.setdefault(repo, {})
        rstats = repo_model.setdefault(model, {"count": 0, "success": 0, "success_rate": 0.0})
        rstats["count"] += 1
        if success:
            rstats["success"] += 1
        rstats["success_rate"] = rstats["success"] / rstats["count"] if rstats["count"] > 0 else 0.0

    json.dump(history, open(HISTORY_FILE, "w", encoding="utf-8"), indent=2, ensure_ascii=False)


def main():
    """命令行入口：
    python model_router.py <idx> [--ensemble]
    输出选定的模型 key。
    """
    if len(sys.argv) < 2:
        print("用法: python model_router.py <idx> [--ensemble]")
        print("示例: python model_router.py 0")
        print("      python model_router.py 0 --ensemble")
        sys.exit(1)

    idx = int(sys.argv[1])
    use_ensemble = "--ensemble" in sys.argv

    inst = load_instance(idx)
    config = load_config()

    model = route_model(inst, config, use_ensemble)

    # 输出路由信息
    complexity = estimate_complexity(inst)
    problem_type = detect_problem_type(inst)
    print(f"实例: {inst['instance_id']}")
    print(f"仓库: {inst['repo']}")
    print(f"复杂度: {complexity}")
    print(f"问题类型: {problem_type}")
    print(f"FAIL_TO_PASS 数量: {len(json.loads(inst.get('FAIL_TO_PASS', '[]')))}")
    print(f"路由模型: {model}")
    if use_ensemble:
        print(f"集成模式: {config.get('ensemble', {}).get('voting', 'majority')}")


if __name__ == "__main__":
    main()
