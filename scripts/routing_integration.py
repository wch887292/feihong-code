#!/usr/bin/env python3
"""
路由引擎与自动调参集成接口
提供统一的模型选择和反馈接口，整合规则路由、MAB 在线学习和贝叶斯优化。

使用方式：
    from routing_integration import RoutingIntegration

    # 初始化
    router = RoutingIntegration()

    # 选择模型
    model = router.select_model(instance_info)

    # 反馈结果（补丁应用成功=0.5，测试通过=1.0）
    router.update_feedback(instance_id, model, reward, instance_info)

    # 获取性能报告
    report = router.get_report()
"""
import json
import os
import sys

BASE = os.path.join(os.path.dirname(__file__), "..")
REAL = os.path.join(BASE, "bench", "real")
DATA_FILE = os.path.join(REAL, "swebench_300.json")

sys.path.insert(0, os.path.dirname(__file__))
from auto_tuning_controller import AutoTuningController, load_controller
from mab_engine import ContextualBandit
from bayesian_optimizer import BayesianOptimizer, ROUTING_PARAM_SPACE


# 默认模型列表
DEFAULT_MODELS = [
    "deepseek-v4-flash",
    "deepseek-v4",
    "qwen2.5-72b",
    "glm-4.6",
]

# 模型配置
MODEL_CONFIG = {
    "deepseek-v4-flash": {
        "name": "DeepSeek-V4-Flash",
        "model_id": "deepseek-ai/DeepSeek-V4-Flash",
        "max_tokens": 4096,
        "temperature": 0.2,
        "speed": "fast",
        "cost": "low",
    },
    "deepseek-v4": {
        "name": "DeepSeek-V4",
        "model_id": "deepseek-ai/DeepSeek-V4-Pro",
        "max_tokens": 8192,
        "temperature": 0.1,
        "speed": "medium",
        "cost": "medium",
    },
    "qwen2.5-72b": {
        "name": "Qwen2.5-72B-Instruct",
        "model_id": "Qwen/Qwen2.5-72B-Instruct",
        "max_tokens": 8192,
        "temperature": 0.1,
        "speed": "medium",
        "cost": "medium",
    },
    "glm-4.6": {
        "name": "GLM-4.6",
        "model_id": "zai-org/GLM-5.2",
        "max_tokens": 8192,
        "temperature": 0.1,
        "speed": "medium",
        "cost": "medium",
    },
}


class RoutingIntegration:
    """路由集成接口。"""

    def __init__(self, model_names=None, use_mab=True, use_bo=True,
                 auto_save=True):
        """
        model_names: 可用模型列表，默认使用 DEFAULT_MODELS
        use_mab: 是否启用 MAB 在线学习
        use_bo: 是否启用贝叶斯优化离线调参
        auto_save: 是否自动保存状态
        """
        self.model_names = model_names or DEFAULT_MODELS
        self.use_mab = use_mab
        self.use_bo = use_bo
        self.auto_save = auto_save

        # 初始化自动调参控制器
        self.controller = load_controller(self.model_names)
        if self.controller is None:
            self.controller = AutoTuningController(
                self.model_names, use_mab=use_mab, use_bo=use_bo
            )

        # 调用计数
        self.call_count = 0

    def select_model(self, instance_info):
        """选择最优模型。
        instance_info: 字典，包含以下字段：
            - instance_id: 实例 ID
            - repo: 仓库名（如 "django/django"）
            - problem_statement: 问题描述
            - fail_to_pass: 失败测试列表
            - base_commit: 基础 commit
        返回: 模型 key（如 "deepseek-v4-flash"）
        """
        self.call_count += 1
        model = self.controller.select(instance_info)
        return model

    def select_model_by_idx(self, idx):
        """根据实例索引选择模型。
        idx: swebench_300.json 中的实例索引
        """
        data = json.load(open(DATA_FILE, encoding="utf-8"))
        inst = data[idx]
        instance_info = {
            "instance_id": inst["instance_id"],
            "repo": inst["repo"],
            "problem_statement": inst.get("problem_statement", ""),
            "fail_to_pass": json.loads(inst.get("FAIL_TO_PASS", "[]")),
            "base_commit": inst.get("base_commit", ""),
        }
        return self.select_model(instance_info)

    def update_feedback(self, instance_id, model, reward, instance_info=None):
        """更新反馈结果。
        reward 评分标准：
            - 0.0: 完全失败（无补丁或补丁应用失败）
            - 0.3: 补丁生成但应用失败
            - 0.5: 补丁应用成功
            - 0.7: 补丁应用成功，部分测试通过
            - 1.0: 补丁应用成功，所有 FAIL_TO_PASS 测试通过
        """
        self.controller.update_feedback(instance_id, model, reward, instance_info)

    def update_feedback_detailed(self, instance_id, model, patch_generated,
                                   patch_applied, tests_passed, tests_total,
                                   instance_info=None):
        """详细反馈接口，自动计算 reward。"""
        reward = 0.0
        if patch_generated:
            reward += 0.2
        if patch_applied:
            reward += 0.3
        if tests_total > 0:
            reward += 0.5 * (tests_passed / tests_total)
        reward = min(1.0, reward)
        self.update_feedback(instance_id, model, reward, instance_info)
        return reward

    def get_model_config(self, model_key):
        """获取模型配置。"""
        return MODEL_CONFIG.get(model_key, {})

    def get_available_models(self):
        """获取可用模型列表。"""
        return self.model_names

    def get_report(self):
        """获取性能报告。"""
        report = self.controller.get_performance_report()
        report["call_count"] = self.call_count
        report["use_mab"] = self.use_mab
        report["use_bo"] = self.use_bo
        return report

    def print_report(self):
        """打印性能报告。"""
        report = self.get_report()
        print("=" * 60)
        print("路由集成性能报告")
        print("=" * 60)
        print(f"总调用次数: {report['call_count']}")
        print(f"总反馈次数: {report['total_feedback']}")
        print(f"平均奖励: {report['average_reward']:.4f}")
        print()
        print("模型表现:")
        for model, stats in report["model_stats"].items():
            config = self.get_model_config(model)
            name = config.get("name", model)
            print(f"  {name} ({model}):")
            print(f"    调用次数: {stats['count']}")
            print(f"    成功率: {stats['success_rate']:.2%}")
            print(f"    平均奖励: {stats['average_reward']:.4f}")
        print()
        print("当前路由参数:")
        for key, value in report["current_params"].items():
            print(f"  {key}: {value}")
        print("=" * 60)

    def run_offline_optimization(self, n_iterations=10):
        """手动触发离线贝叶斯优化。"""
        return self.controller.run_offline_optimization(n_iterations)

    def save(self):
        """保存状态。"""
        self.controller._save_state()


def main():
    """命令行测试。"""
    print("路由集成接口测试")
    print("=" * 60)

    router = RoutingIntegration()

    # 测试模型选择
    print("\n测试模型选择:")
    test_instances = [
        {"repo": "django/django", "problem_statement": "Fix a simple bug", "fail_to_pass": ["test_1"]},
        {"repo": "astropy/astropy", "problem_statement": "Fix a complex bug with lots of details" * 10, "fail_to_pass": ["test_1"] * 10},
        {"repo": "psf/requests", "problem_statement": "Add a new feature", "fail_to_pass": ["test_1", "test_2"]},
    ]
    for i, inst in enumerate(test_instances):
        model = router.select_model(inst)
        print(f"  实例 {i+1} ({inst['repo']}): {model}")

    # 模拟反馈
    print("\n模拟反馈...")
    import random
    for i in range(30):
        inst = test_instances[i % len(test_instances)]
        inst["instance_id"] = f"test-{i}"
        model = router.select_model(inst)
        reward = random.uniform(0.3, 1.0)
        router.update_feedback(f"test-{i}", model, reward, inst)

    # 打印报告
    router.print_report()

    # 保存
    router.save()


if __name__ == "__main__":
    main()
