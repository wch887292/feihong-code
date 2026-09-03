#!/usr/bin/env python3
"""
路由包装脚本：为 run_swebench.sh 提供模型选择和反馈接口。
用法：
  python router_wrapper.py select <idx>  -> 输出选择的模型 ID
  python router_wrapper.py feedback <idx> <model> <reward>  -> 更新反馈
"""
import json
import os
import sys

BASE = os.path.join(os.path.dirname(__file__), "..")
REAL = os.path.join(BASE, "bench", "real")
DATA_FILE = os.path.join(REAL, "swebench_300.json")

sys.path.insert(0, os.path.dirname(__file__))
from routing_integration import RoutingIntegration, MODEL_CONFIG

# 全局路由器实例（单例）
_router = None


def get_router():
    global _router
    if _router is None:
        _router = RoutingIntegration()
    return _router


def get_instance_info(idx):
    """获取实例信息。"""
    data = json.load(open(DATA_FILE, encoding="utf-8"))
    inst = data[idx]
    return {
        "instance_id": inst["instance_id"],
        "repo": inst["repo"],
        "problem_statement": inst.get("problem_statement", ""),
        "fail_to_pass": json.loads(inst.get("FAIL_TO_PASS", "[]")),
        "base_commit": inst.get("base_commit", ""),
    }


def cmd_select(idx):
    """选择模型，输出模型 ID。"""
    router = get_router()
    inst_info = get_instance_info(idx)
    model_key = router.select_model(inst_info)
    model_config = MODEL_CONFIG.get(model_key, {})
    model_id = model_config.get("model_id", "deepseek-ai/DeepSeek-V4-Flash")
    # 输出模型 ID（供 bash 脚本使用）
    print(model_id)
    # 同时输出模型 key 到 stderr（供调试）
    print(f"selected: {model_key} ({model_id})", file=sys.stderr)


def cmd_feedback(idx, model_key, reward):
    """更新反馈。"""
    router = get_router()
    inst_info = get_instance_info(idx)
    reward = float(reward)
    router.update_feedback(inst_info["instance_id"], model_key, reward, inst_info)
    print(f"feedback updated: {model_key} reward={reward}", file=sys.stderr)


def main():
    if len(sys.argv) < 3:
        print("用法:")
        print("  python router_wrapper.py select <idx>")
        print("  python router_wrapper.py feedback <idx> <model_key> <reward>")
        sys.exit(1)

    command = sys.argv[1]
    idx = int(sys.argv[2])

    if command == "select":
        cmd_select(idx)
    elif command == "feedback":
        if len(sys.argv) < 5:
            print("错误: feedback 需要 model_key 和 reward 参数", file=sys.stderr)
            sys.exit(1)
        model_key = sys.argv[3]
        reward = sys.argv[4]
        cmd_feedback(idx, model_key, reward)
    else:
        print(f"未知命令: {command}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
