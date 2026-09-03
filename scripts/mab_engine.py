#!/usr/bin/env python3
"""
多臂老虎机（Multi-Armed Bandit）引擎
用于在线动态选择最优模型，支持 Thompson Sampling 和 UCB 算法。
按仓库、问题类型、复杂度等维度维护独立的 MAB 实例，实现细粒度路由优化。
"""
import json
import os
import math
import random
from collections import defaultdict

BASE = os.path.join(os.path.dirname(__file__), "..")
REAL = os.path.join(BASE, "bench", "real")
MAB_STATE_FILE = os.path.join(REAL, "mab_state.json")


class Arm:
    """单个臂（模型）的状态。"""
    def __init__(self, name):
        self.name = name
        self.successes = 0  # 成功次数（Beta 分布的 alpha）
        self.failures = 0   # 失败次数（Beta 分布的 beta）
        self.total_reward = 0.0  # 累计奖励（用于 UCB）
        self.pulls = 0  # 拉动次数

    @property
    def mean_reward(self):
        """平均奖励。"""
        if self.pulls == 0:
            return 0.0
        return self.total_reward / self.pulls

    @property
    def success_rate(self):
        """成功率。"""
        total = self.successes + self.failures
        if total == 0:
            return 0.5  # 无数据时默认 0.5
        return self.successes / total

    def update(self, reward):
        """更新臂的状态。
        reward: 0.0 - 1.0，1.0 表示完全成功
        """
        self.pulls += 1
        self.total_reward += reward
        if reward >= 0.5:
            self.successes += 1
        else:
            self.failures += 1

    def to_dict(self):
        return {
            "successes": self.successes,
            "failures": self.failures,
            "total_reward": self.total_reward,
            "pulls": self.pulls,
        }

    @classmethod
    def from_dict(cls, name, data):
        arm = cls(name)
        arm.successes = data.get("successes", 0)
        arm.failures = data.get("failures", 0)
        arm.total_reward = data.get("total_reward", 0.0)
        arm.pulls = data.get("pulls", 0)
        return arm


class MultiArmedBandit:
    """多臂老虎机引擎。
    支持 Thompson Sampling 和 UCB 两种算法。
    """

    def __init__(self, model_names, algorithm="thompson", c=2.0):
        """
        model_names: 模型名称列表
        algorithm: "thompson" 或 "ucb"
        c: UCB 探索参数（越大越探索）
        """
        self.arms = {name: Arm(name) for name in model_names}
        self.algorithm = algorithm
        self.c = c
        self.total_pulls = 0

    def select(self, context=None):
        """选择一个臂（模型）。
        context: 可选的上下文信息（目前未使用，预留上下文老虎机扩展）
        """
        if self.algorithm == "thompson":
            return self._thompson_sampling()
        elif self.algorithm == "ucb":
            return self._ucb()
        else:
            return self._epsilon_greedy()

    def _thompson_sampling(self):
        """Thompson Sampling：从每个臂的 Beta 分布中采样，选择最大值。"""
        best_arm = None
        best_sample = -1

        for name, arm in self.arms.items():
            # Beta(alpha=successes+1, beta=failures+1)
            alpha = arm.successes + 1
            beta = arm.failures + 1
            sample = random.betavariate(alpha, beta)
            if sample > best_sample:
                best_sample = sample
                best_arm = name

        return best_arm

    def _ucb(self):
        """UCB1：上置信界算法，平衡探索与利用。"""
        self.total_pulls += 1
        best_arm = None
        best_ucb = -float("inf")

        for name, arm in self.arms.items():
            if arm.pulls == 0:
                # 未拉动过的臂优先探索
                return name

            # UCB = mean + c * sqrt(log(N) / n)
            exploitation = arm.mean_reward
            exploration = self.c * math.sqrt(math.log(self.total_pulls) / arm.pulls)
            ucb = exploitation + exploration

            if ucb > best_ucb:
                best_ucb = ucb
                best_arm = name

        return best_arm

    def _epsilon_greedy(self, epsilon=0.1):
        """ε-greedy：以 epsilon 概率随机探索，否则选择最优。"""
        if random.random() < epsilon:
            return random.choice(list(self.arms.keys()))
        else:
            return max(self.arms.items(), key=lambda x: x[1].mean_reward)[0]

    def update(self, arm_name, reward):
        """更新指定臂的奖励。"""
        if arm_name in self.arms:
            self.arms[arm_name].update(reward)

    def get_stats(self):
        """获取所有臂的统计信息。"""
        return {
            name: {
                "pulls": arm.pulls,
                "successes": arm.successes,
                "failures": arm.failures,
                "success_rate": arm.success_rate,
                "mean_reward": arm.mean_reward,
            }
            for name, arm in self.arms.items()
        }

    def to_dict(self):
        return {
            "algorithm": self.algorithm,
            "c": self.c,
            "total_pulls": self.total_pulls,
            "arms": {name: arm.to_dict() for name, arm in self.arms.items()},
        }

    @classmethod
    def from_dict(cls, data):
        model_names = list(data.get("arms", {}).keys())
        mab = cls(model_names, algorithm=data.get("algorithm", "thompson"),
                   c=data.get("c", 2.0))
        mab.total_pulls = data.get("total_pulls", 0)
        for name, arm_data in data.get("arms", {}).items():
            if name in mab.arms:
                mab.arms[name] = Arm.from_dict(name, arm_data)
        return mab


class ContextualBandit:
    """上下文老虎机：按上下文维度（仓库、问题类型、复杂度）维护独立的 MAB。"""

    def __init__(self, model_names, algorithm="thompson"):
        self.model_names = model_names
        self.algorithm = algorithm
        self.bandits = {}  # context_key -> MultiArmedBandit
        self.global_bandit = MultiArmedBandit(model_names, algorithm)

    def _make_context_key(self, repo="", problem_type="", complexity=""):
        """生成上下文键。"""
        parts = []
        if repo:
            parts.append(f"repo:{repo}")
        if problem_type:
            parts.append(f"type:{problem_type}")
        if complexity:
            parts.append(f"complexity:{complexity}")
        return "|".join(parts) if parts else "global"

    def select(self, repo="", problem_type="", complexity=""):
        """根据上下文选择模型。"""
        key = self._make_context_key(repo, problem_type, complexity)

        # 优先使用上下文特定的 MAB
        if key in self.bandits:
            bandit = self.bandits[key]
            # 如果上下文 MAB 数据不足，回退到全局
            if bandit.total_pulls < 5:
                return self.global_bandit.select()
            return bandit.select()

        # 新上下文，创建 MAB 但先用全局推荐
        self.bandits[key] = MultiArmedBandit(self.model_names, self.algorithm)
        return self.global_bandit.select()

    def update(self, arm_name, reward, repo="", problem_type="", complexity=""):
        """更新指定上下文的奖励。"""
        key = self._make_context_key(repo, problem_type, complexity)

        # 更新上下文 MAB
        if key not in self.bandits:
            self.bandits[key] = MultiArmedBandit(self.model_names, self.algorithm)
        self.bandits[key].update(arm_name, reward)

        # 同时更新全局 MAB
        self.global_bandit.update(arm_name, reward)

    def get_stats(self):
        """获取所有 MAB 的统计信息。"""
        return {
            "global": self.global_bandit.get_stats(),
            "contexts": {
                key: bandit.get_stats()
                for key, bandit in self.bandits.items()
            },
        }

    def to_dict(self):
        return {
            "model_names": self.model_names,
            "algorithm": self.algorithm,
            "global": self.global_bandit.to_dict(),
            "contexts": {
                key: bandit.to_dict()
                for key, bandit in self.bandits.items()
            },
        }

    @classmethod
    def from_dict(cls, data):
        model_names = data.get("model_names", [])
        algorithm = data.get("algorithm", "thompson")
        cb = cls(model_names, algorithm)
        if "global" in data:
            cb.global_bandit = MultiArmedBandit.from_dict(data["global"])
        for key, bandit_data in data.get("contexts", {}).items():
            cb.bandits[key] = MultiArmedBandit.from_dict(bandit_data)
        return cb


def load_bandit():
    """加载持久化的上下文老虎机。"""
    if os.path.exists(MAB_STATE_FILE):
        try:
            data = json.load(open(MAB_STATE_FILE, encoding="utf-8"))
            return ContextualBandit.from_dict(data)
        except Exception:
            pass
    return None


def save_bandit(bandit):
    """保存上下文老虎机状态。"""
    os.makedirs(os.path.dirname(MAB_STATE_FILE), exist_ok=True)
    json.dump(bandit.to_dict(), open(MAB_STATE_FILE, "w", encoding="utf-8"),
              indent=2, ensure_ascii=False)


if __name__ == "__main__":
    # 简单测试
    models = ["deepseek-v4-flash", "deepseek-v4", "qwen2.5-72b"]
    bandit = ContextualBandit(models, algorithm="thompson")

    # 模拟一些反馈
    for i in range(100):
        repo = "django/django" if i % 2 == 0 else "astropy/astropy"
        model = bandit.select(repo=repo, problem_type="bug_fix", complexity="simple")
        # 模拟奖励：deepseek-v4 在 astropy 上更好，flash 在 django 上更好
        if repo == "django/django":
            reward = 0.8 if model == "deepseek-v4-flash" else 0.4
        else:
            reward = 0.7 if model == "deepseek-v4" else 0.3
        bandit.update(model, reward, repo=repo, problem_type="bug_fix", complexity="simple")

    print("MAB 测试完成")
    print(json.dumps(bandit.get_stats(), indent=2))
