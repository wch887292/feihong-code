#!/usr/bin/env python3
"""
自动调参控制器（Auto-Tuning Controller）
整合多臂老虎机（MAB，在线学习）和贝叶斯优化（BO，离线调参），
实现路由策略的自动优化。

架构：
- 在线层：MAB 根据实时反馈动态选择模型（探索-利用平衡）
- 离线层：贝叶斯优化定期优化路由超参数（阈值、权重等）
- 反馈层：收集每次调用的结果，更新 MAB 和积累 BO 训练数据
- 集成层：与现有路由引擎（model_router.py）无缝集成

使用方式：
1. 初始化：controller = AutoTuningController(model_names)
2. 选择模型：model = controller.select(instance_info)
3. 反馈结果：controller.update_feedback(instance_id, model, reward, instance_info)
4. 触发离线优化：controller.run_offline_optimization()
"""
import json
import os
import sys
import time
from collections import defaultdict, OrderedDict

BASE = os.path.join(os.path.dirname(__file__), "..")
REAL = os.path.join(BASE, "bench", "real")
CONTROLLER_STATE_FILE = os.path.join(REAL, "auto_tuning_state.json")
FEEDBACK_LOG_FILE = os.path.join(REAL, "feedback_log.jsonl")

# 导入 MAB 和贝叶斯优化器
sys.path.insert(0, os.path.dirname(__file__))
from mab_engine import ContextualBandit, load_bandit, save_bandit
from bayesian_optimizer import (BayesianOptimizer, ROUTING_PARAM_SPACE,
                                 save_optimizer, load_optimizer)


class AutoTuningController:
    """自动调参控制器。"""

    def __init__(self, model_names, use_mab=True, use_bo=True,
                 bo_trigger_threshold=50, bo_min_samples=30):
        """
        model_names: 可用模型名称列表
        use_mab: 是否启用多臂老虎机在线学习
        use_bo: 是否启用贝叶斯优化离线调参
        bo_trigger_threshold: 触发 BO 的反馈数据量阈值
        bo_min_samples: BO 最小采样数
        """
        self.model_names = model_names
        self.use_mab = use_mab
        self.use_bo = use_bo
        self.bo_trigger_threshold = bo_trigger_threshold
        self.bo_min_samples = bo_min_samples

        # 初始化 MAB
        if use_mab:
            self.bandit = load_bandit()
            if self.bandit is None or set(self.bandit.model_names) != set(model_names):
                self.bandit = ContextualBandit(model_names, algorithm="thompson")
        else:
            self.bandit = None

        # 初始化贝叶斯优化器
        if use_bo:
            self.bo = load_optimizer(ROUTING_PARAM_SPACE)
            if self.bo is None:
                self.bo = BayesianOptimizer(ROUTING_PARAM_SPACE)
        else:
            self.bo = None

        # 当前路由参数（BO 优化的结果）
        self.current_params = self._get_default_params()

        # 反馈统计
        self.feedback_count = 0
        self.feedback_since_bo = 0
        self.total_reward = 0.0
        self.model_stats = defaultdict(lambda: {"count": 0, "success": 0, "reward": 0.0})
        self.repo_stats = defaultdict(lambda: {"count": 0, "success": 0, "reward": 0.0})

        # 加载历史状态
        self._load_state()

    def _get_default_params(self):
        """获取默认路由参数。"""
        params = {}
        for name, (min_val, max_val, ptype) in ROUTING_PARAM_SPACE.items():
            if ptype == "int":
                params[name] = (min_val + max_val) // 2
            else:
                params[name] = (min_val + max_val) / 2.0
        return params

    def _estimate_complexity(self, instance_info):
        """基于当前参数估算问题复杂度。"""
        ps = instance_info.get("problem_statement", "")
        ftps = instance_info.get("fail_to_pass", [])
        ps_len = len(ps)
        test_count = len(ftps)

        ps_threshold = self.current_params.get("complexity_ps_length_threshold", 1500)
        test_threshold = self.current_params.get("complexity_test_count_threshold", 8)

        score = 0
        if ps_len > ps_threshold * 1.5:
            score += 2
        elif ps_len > ps_threshold:
            score += 1
        if test_count > test_threshold * 1.5:
            score += 2
        elif test_count > test_threshold:
            score += 1

        if score >= 3:
            return "complex"
        elif score >= 1:
            return "medium"
        else:
            return "simple"

    def _detect_problem_type(self, instance_info):
        """检测问题类型。"""
        ps = instance_info.get("problem_statement", "").lower()
        if any(kw in ps for kw in ["add ", "implement", "support", "feature", "new "]):
            return "feature_request"
        elif any(kw in ps for kw in ["refactor", "restructure", "clean up"]):
            return "refactoring"
        elif any(kw in ps for kw in ["performance", "slow", "optimize"]):
            return "performance"
        else:
            return "bug_fix"

    def _rule_based_routing(self, instance_info):
        """基于规则的路由（使用 BO 优化的参数）。"""
        repo = instance_info.get("repo", "")
        complexity = self._estimate_complexity(instance_info)
        problem_type = self._detect_problem_type(instance_info)

        # 按仓库路由
        repo_routing = {
            "django/django": "deepseek-v4-flash",
            "astropy/astropy": "deepseek-v4",
            "matplotlib/matplotlib": "deepseek-v4",
            "psf/requests": "qwen2.5-72b",
            "pydata/xarray": "deepseek-v4",
        }
        if repo in repo_routing:
            return repo_routing[repo]

        # 按复杂度路由（使用权重）
        weights = {
            "deepseek-v4-flash": self.current_params.get("weight_flash", 1.0),
            "deepseek-v4": self.current_params.get("weight_v4", 1.0),
            "qwen2.5-72b": self.current_params.get("weight_qwen", 1.0),
        }
        if complexity == "simple":
            # 简单问题偏好快速模型
            weights["deepseek-v4-flash"] *= 1.5
        elif complexity == "complex":
            # 复杂问题偏好强模型
            weights["deepseek-v4"] *= 1.5

        # 加权随机选择
        total_weight = sum(weights.values())
        r = hash(instance_info.get("instance_id", "")) % 1000 / 1000.0
        cumulative = 0
        for model, weight in weights.items():
            cumulative += weight / total_weight
            if r <= cumulative:
                return model

        return self.model_names[0]

    def select(self, instance_info):
        """选择最优模型。
        instance_info: 字典，包含 repo, problem_statement, fail_to_pass, instance_id 等
        """
        repo = instance_info.get("repo", "")
        problem_type = self._detect_problem_type(instance_info)
        complexity = self._estimate_complexity(instance_info)

        # MAB 在线选择（如果启用且有足够数据）
        if self.use_mab and self.bandit:
            mab_model = self.bandit.select(
                repo=repo, problem_type=problem_type, complexity=complexity
            )
            # MAB 数据不足时，混合规则路由
            context_key = f"repo:{repo}|type:{problem_type}|complexity:{complexity}"
            if context_key in self.bandit.bandits:
                context_bandit = self.bandit.bandits[context_key]
                if context_bandit.total_pulls >= 10:
                    return mab_model

        # 规则路由（使用 BO 优化的参数）
        return self._rule_based_routing(instance_info)

    def update_feedback(self, instance_id, model, reward, instance_info=None):
        """更新反馈结果。
        reward: 0.0 - 1.0，1.0 表示完全成功（补丁应用+测试通过）
        instance_info: 可选的实例信息，用于更新上下文 MAB
        """
        self.feedback_count += 1
        self.feedback_since_bo += 1
        self.total_reward += reward

        # 更新模型统计
        self.model_stats[model]["count"] += 1
        self.model_stats[model]["reward"] += reward
        if reward >= 0.5:
            self.model_stats[model]["success"] += 1

        # 更新仓库统计
        if instance_info:
            repo = instance_info.get("repo", "")
            if repo:
                self.repo_stats[repo]["count"] += 1
                self.repo_stats[repo]["reward"] += reward
                if reward >= 0.5:
                    self.repo_stats[repo]["success"] += 1

        # 更新 MAB
        if self.use_mab and self.bandit and instance_info:
            repo = instance_info.get("repo", "")
            problem_type = self._detect_problem_type(instance_info)
            complexity = self._estimate_complexity(instance_info)
            self.bandit.update(model, reward, repo=repo,
                               problem_type=problem_type, complexity=complexity)
            save_bandit(self.bandit)

        # 记录反馈日志
        self._log_feedback(instance_id, model, reward, instance_info)

        # 检查是否触发离线贝叶斯优化
        if (self.use_bo and self.bo and
                self.feedback_since_bo >= self.bo_trigger_threshold and
                self.feedback_count >= self.bo_min_samples):
            self.run_offline_optimization()
            self.feedback_since_bo = 0

        # 定期保存状态
        if self.feedback_count % 10 == 0:
            self._save_state()

    def _log_feedback(self, instance_id, model, reward, instance_info):
        """记录反馈日志。"""
        log_entry = {
            "timestamp": time.time(),
            "instance_id": instance_id,
            "model": model,
            "reward": reward,
            "repo": instance_info.get("repo", "") if instance_info else "",
            "complexity": self._estimate_complexity(instance_info) if instance_info else "",
        }
        os.makedirs(os.path.dirname(FEEDBACK_LOG_FILE), exist_ok=True)
        with open(FEEDBACK_LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")

    def run_offline_optimization(self, n_iterations=10):
        """运行离线贝叶斯优化。
        使用积累的反馈数据评估路由参数的性能。
        """
        print(f"[自动调参] 触发离线贝叶斯优化，反馈数据量: {self.feedback_count}")

        # 定义目标函数：基于当前反馈数据评估参数性能
        def objective(params):
            # 模拟：使用参数计算预期性能
            # 实际使用时，可以重放历史数据并计算 resolved-rate
            score = 0.0

            # 复杂度阈值适中更好
            ps_len = params["complexity_ps_length_threshold"]
            test_cnt = params["complexity_test_count_threshold"]
            score += 0.2 * (1.0 - abs(ps_len - 1500) / 1500)
            score += 0.15 * (1.0 - abs(test_cnt - 8) / 8)

            # 模型权重：根据历史表现调整
            for model, stats in self.model_stats.items():
                if stats["count"] > 0:
                    success_rate = stats["success"] / stats["count"]
                    if model == "deepseek-v4-flash":
                        score += 0.15 * success_rate * params["weight_flash"]
                    elif model == "deepseek-v4":
                        score += 0.15 * success_rate * params["weight_v4"]
                    elif model == "qwen2.5-72b":
                        score += 0.15 * success_rate * params["weight_qwen"]

            # MAB 参数适中
            score += 0.1 * (1.0 - abs(params["mab_exploration_c"] - 1.5) / 1.5)
            score += 0.1 * (1.0 - abs(params["ensemble_vote_threshold"] - 0.5) / 0.5)

            return max(0.0, min(1.0, score))

        # 运行优化
        self.bo.objective_func = objective
        best_params, best_score = self.bo.optimize(n_iterations=n_iterations)

        # 更新当前参数
        if best_params:
            self.current_params.update(best_params)
            print(f"[自动调参] 优化完成，最佳分数: {best_score:.4f}")
            print(f"[自动调参] 最佳参数: {best_params}")

        # 保存优化器状态
        save_optimizer(self.bo)
        self._save_state()

        return best_params, best_score

    def get_performance_report(self):
        """获取性能报告。"""
        report = {
            "total_feedback": self.feedback_count,
            "average_reward": self.total_reward / self.feedback_count if self.feedback_count > 0 else 0,
            "current_params": self.current_params,
            "model_stats": {
                model: {
                    "count": stats["count"],
                    "success_rate": stats["success"] / stats["count"] if stats["count"] > 0 else 0,
                    "average_reward": stats["reward"] / stats["count"] if stats["count"] > 0 else 0,
                }
                for model, stats in self.model_stats.items()
            },
            "repo_stats": {
                repo: {
                    "count": stats["count"],
                    "success_rate": stats["success"] / stats["count"] if stats["count"] > 0 else 0,
                }
                for repo, stats in self.repo_stats.items()
            },
        }
        return report

    def _save_state(self):
        """保存控制器状态。"""
        state = {
            "model_names": self.model_names,
            "use_mab": self.use_mab,
            "use_bo": self.use_bo,
            "current_params": self.current_params,
            "feedback_count": self.feedback_count,
            "feedback_since_bo": self.feedback_since_bo,
            "total_reward": self.total_reward,
            "model_stats": dict(self.model_stats),
            "repo_stats": dict(self.repo_stats),
        }
        os.makedirs(os.path.dirname(CONTROLLER_STATE_FILE), exist_ok=True)
        json.dump(state, open(CONTROLLER_STATE_FILE, "w", encoding="utf-8"),
                  indent=2, ensure_ascii=False)

    def _load_state(self):
        """加载控制器状态。"""
        if os.path.exists(CONTROLLER_STATE_FILE):
            try:
                state = json.load(open(CONTROLLER_STATE_FILE, encoding="utf-8"))
                self.current_params = state.get("current_params", self.current_params)
                self.feedback_count = state.get("feedback_count", 0)
                self.feedback_since_bo = state.get("feedback_since_bo", 0)
                self.total_reward = state.get("total_reward", 0.0)
                self.model_stats = defaultdict(lambda: {"count": 0, "success": 0, "reward": 0.0},
                                               state.get("model_stats", {}))
                self.repo_stats = defaultdict(lambda: {"count": 0, "success": 0, "reward": 0.0},
                                              state.get("repo_stats", {}))
            except Exception:
                pass


def load_controller(model_names=None):
    """加载控制器状态。"""
    if os.path.exists(CONTROLLER_STATE_FILE):
        try:
            state = json.load(open(CONTROLLER_STATE_FILE, encoding="utf-8"))
            model_names = state.get("model_names", model_names)
            if model_names:
                controller = AutoTuningController(model_names)
                controller._load_state()
                return controller
        except Exception:
            pass
    if model_names:
        return AutoTuningController(model_names)
    return None


if __name__ == "__main__":
    # 简单测试
    print("自动调参控制器测试")
    print("=" * 60)

    models = ["deepseek-v4-flash", "deepseek-v4", "qwen2.5-72b"]
    controller = AutoTuningController(models, use_mab=True, use_bo=True,
                                       bo_trigger_threshold=20, bo_min_samples=10)

    # 模拟 50 次反馈
    import random
    for i in range(50):
        instance_info = {
            "instance_id": f"test-{i}",
            "repo": "django/django" if i % 2 == 0 else "astropy/astropy",
            "problem_statement": "Fix a bug in the code" * (1 if i % 3 == 0 else 5),
            "fail_to_pass": ["test_1"] * (1 if i % 4 == 0 else 10),
        }
        model = controller.select(instance_info)
        # 模拟奖励
        if instance_info["repo"] == "django/django":
            reward = 0.8 if model == "deepseek-v4-flash" else 0.4
        else:
            reward = 0.7 if model == "deepseek-v4" else 0.3
        reward += random.uniform(-0.1, 0.1)
        reward = max(0.0, min(1.0, reward))
        controller.update_feedback(f"test-{i}", model, reward, instance_info)

    # 输出性能报告
    print("\n" + "=" * 60)
    print("性能报告")
    print("=" * 60)
    report = controller.get_performance_report()
    print(json.dumps(report, indent=2, ensure_ascii=False))

    # 保存状态
    controller._save_state()
    print(f"\n控制器状态已保存到: {CONTROLLER_STATE_FILE}")
