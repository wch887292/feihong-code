#!/usr/bin/env python3
"""
贝叶斯优化器（Bayesian Optimizer）
用于离线优化路由超参数，基于高斯过程代理模型和 Expected Improvement 采集函数。
纯 numpy 实现，无需 scikit-learn 依赖。

优化目标：最大化整体 resolved-rate
优化参数：
- 复杂度判定阈值（问题描述长度、测试数量）
- 模型权重（各模型在路由中的优先级）
- MAB 探索参数
- 路由策略权重
"""
import json
import os
import sys
import math
import numpy as np
from collections import OrderedDict

BASE = os.path.join(os.path.dirname(__file__), "..")
REAL = os.path.join(BASE, "bench", "real")
BO_STATE_FILE = os.path.join(REAL, "bayesian_optimization_state.json")
HISTORY_FILE = os.path.join(REAL, "optimization_history.json")


class GaussianProcessRegressor:
    """简化版高斯过程回归，使用 RBF 核。"""

    def __init__(self, length_scale=1.0, alpha=1e-6, noise=1e-4):
        self.length_scale = length_scale
        self.alpha = alpha  # 噪声项
        self.noise = noise
        self.X_train = None
        self.y_train = None
        self.K_inv = None

    def _rbf_kernel(self, X1, X2):
        """RBF (高斯) 核函数。"""
        # 计算平方距离
        sq_dist = np.sum(X1**2, axis=1)[:, np.newaxis] + \
                  np.sum(X2**2, axis=1)[np.newaxis, :] - \
                  2 * np.dot(X1, X2.T)
        sq_dist = np.maximum(sq_dist, 0)
        return np.exp(-0.5 * sq_dist / (self.length_scale ** 2))

    def fit(self, X, y):
        """拟合高斯过程。"""
        self.X_train = np.array(X)
        self.y_train = np.array(y)
        n = len(X)
        K = self._rbf_kernel(self.X_train, self.X_train)
        K += (self.alpha + self.noise) * np.eye(n)
        self.K_inv = np.linalg.inv(K)

    def predict(self, X):
        """预测均值和方差。"""
        X = np.array(X)
        K_s = self._rbf_kernel(self.X_train, X)
        K_ss = self._rbf_kernel(X, X)

        mu = K_s.T.dot(self.K_inv).dot(self.y_train)
        cov = K_ss - K_s.T.dot(self.K_inv).dot(K_s)
        sigma = np.sqrt(np.maximum(np.diag(cov), 1e-10))

        return mu, sigma


class BayesianOptimizer:
    """贝叶斯优化器。"""

    def __init__(self, param_space, objective_func=None, n_initial=5,
                 acquisition="ei", xi=0.01):
        """
        param_space: 参数空间，OrderedDict，key=参数名，value=(min, max, type)
                     type: "float" 或 "int"
        objective_func: 目标函数，输入参数字典，输出性能分数（越大越好）
        n_initial: 初始随机采样点数
        acquisition: 采集函数，"ei" (Expected Improvement) 或 "ucb"
        xi: EI 的探索-利用平衡参数
        """
        self.param_space = OrderedDict(param_space)
        self.param_names = list(self.param_space.keys())
        self.objective_func = objective_func
        self.n_initial = n_initial
        self.acquisition = acquisition
        self.xi = xi

        self.X_observed = []  # 已观测的参数点
        self.y_observed = []  # 已观测的性能分数
        self.gp = None
        self.best_params = None
        self.best_score = -float("inf")

    def _normalize(self, params_dict):
        """将参数字典归一化到 [0, 1] 空间。"""
        x = []
        for name in self.param_names:
            min_val, max_val, ptype = self.param_space[name]
            val = params_dict[name]
            if ptype == "int":
                val = float(val)
            x.append((val - min_val) / (max_val - min_val) if max_val > min_val else 0.5)
        return np.array(x)

    def _denormalize(self, x):
        """将归一化向量还原为参数字典。"""
        params = {}
        for i, name in enumerate(self.param_names):
            min_val, max_val, ptype = self.param_space[name]
            val = min_val + x[i] * (max_val - min_val)
            if ptype == "int":
                val = int(round(val))
            params[name] = val
        return params

    def _random_sample(self):
        """随机采样一个参数点。"""
        params = {}
        for name in self.param_names:
            min_val, max_val, ptype = self.param_space[name]
            if ptype == "int":
                params[name] = np.random.randint(min_val, max_val + 1)
            else:
                params[name] = np.random.uniform(min_val, max_val)
        return params

    def _expected_improvement(self, X):
        """Expected Improvement 采集函数。"""
        if self.gp is None or len(self.X_observed) == 0:
            return np.ones(len(X))

        mu, sigma = self.gp.predict(X)
        best_y = np.max(self.y_observed)

        # EI = (mu - best - xi) * Phi(z) + sigma * phi(z)
        with np.errstate(divide='warn'):
            z = (mu - best_y - self.xi) / sigma
            ei = (mu - best_y - self.xi) * self._norm_cdf(z) + \
                 sigma * self._norm_pdf(z)
            ei[sigma == 0] = 0

        return ei

    def _ucb(self, X, beta=2.0):
        """UCB 采集函数。"""
        if self.gp is None or len(self.X_observed) == 0:
            return np.ones(len(X))
        mu, sigma = self.gp.predict(X)
        return mu + beta * sigma

    def _norm_pdf(self, x):
        """标准正态分布概率密度函数。"""
        return np.exp(-0.5 * x**2) / np.sqrt(2 * np.pi)

    def _norm_cdf(self, x):
        """标准正态分布累积分布函数。"""
        return 0.5 * (1 + np.vectorize(math.erf)(x / np.sqrt(2)))

    def _propose_next(self, n_candidates=1000):
        """建议下一个评估点。"""
        # 初始阶段随机采样
        if len(self.X_observed) < self.n_initial:
            return self._random_sample()

        # 随机生成候选点
        candidates = [self._random_sample() for _ in range(n_candidates)]
        X_candidates = np.array([self._normalize(c) for c in candidates])

        # 计算采集函数值
        if self.acquisition == "ei":
            scores = self._expected_improvement(X_candidates)
        else:
            scores = self._ucb(X_candidates)

        # 选择最优候选
        best_idx = np.argmax(scores)
        return candidates[best_idx]

    def observe(self, params, score):
        """观测一个参数点的性能。"""
        x = self._normalize(params)
        self.X_observed.append(x)
        self.y_observed.append(score)

        if score > self.best_score:
            self.best_score = score
            self.best_params = params.copy()

        # 重新拟合高斯过程
        if len(self.X_observed) >= 2:
            self.gp = GaussianProcessRegressor(length_scale=1.0)
            self.gp.fit(self.X_observed, self.y_observed)

    def optimize(self, n_iterations=20):
        """执行优化循环。
        需要 objective_func 已设置。
        """
        if self.objective_func is None:
            raise ValueError("objective_func 未设置")

        for i in range(n_iterations):
            params = self._propose_next()
            score = self.objective_func(params)
            self.observe(params, score)
            print(f"迭代 {i+1}/{n_iterations}: score={score:.4f}, best={self.best_score:.4f}")

        return self.best_params, self.best_score

    def get_optimization_history(self):
        """获取优化历史。"""
        history = []
        for i, (x, y) in enumerate(zip(self.X_observed, self.y_observed)):
            params = self._denormalize(x)
            history.append({
                "iteration": i + 1,
                "params": params,
                "score": float(y),
                "is_best": y == self.best_score,
            })
        return history

    def to_dict(self):
        return {
            "param_space": {k: list(v) for k, v in self.param_space.items()},
            "n_initial": self.n_initial,
            "acquisition": self.acquisition,
            "xi": self.xi,
            "X_observed": [list(x) for x in self.X_observed],
            "y_observed": [float(y) for y in self.y_observed],
            "best_params": self.best_params,
            "best_score": float(self.best_score) if self.best_score != -float("inf") else None,
        }

    @classmethod
    def from_dict(cls, data):
        param_space = OrderedDict(
            (k, tuple(v)) for k, v in data.get("param_space", {}).items()
        )
        bo = cls(param_space, n_initial=data.get("n_initial", 5),
                 acquisition=data.get("acquisition", "ei"), xi=data.get("xi", 0.01))
        bo.X_observed = [np.array(x) for x in data.get("X_observed", [])]
        bo.y_observed = data.get("y_observed", [])
        bo.best_params = data.get("best_params")
        bo.best_score = data.get("best_score", -float("inf"))
        if bo.X_observed and len(bo.X_observed) >= 2:
            bo.gp = GaussianProcessRegressor()
            bo.gp.fit(bo.X_observed, bo.y_observed)
        return bo


def save_optimizer(optimizer):
    """保存贝叶斯优化器状态。"""
    os.makedirs(os.path.dirname(BO_STATE_FILE), exist_ok=True)
    json.dump(optimizer.to_dict(), open(BO_STATE_FILE, "w", encoding="utf-8"),
              indent=2, ensure_ascii=False)


def load_optimizer(param_space=None):
    """加载贝叶斯优化器状态。"""
    if os.path.exists(BO_STATE_FILE):
        try:
            data = json.load(open(BO_STATE_FILE, encoding="utf-8"))
            return BayesianOptimizer.from_dict(data)
        except Exception:
            pass
    if param_space:
        return BayesianOptimizer(param_space)
    return None


# ==================== 路由超参数优化空间定义 ====================

ROUTING_PARAM_SPACE = OrderedDict([
    # 复杂度判定阈值
    ("complexity_ps_length_threshold", (500, 3000, "int")),  # 问题描述长度阈值
    ("complexity_test_count_threshold", (3, 15, "int")),     # 测试数量阈值
    # 模型权重（路由优先级）
    ("weight_flash", (0.5, 2.0, "float")),     # DeepSeek-V4-Flash 权重
    ("weight_v4", (0.5, 2.0, "float")),         # DeepSeek-V4 权重
    ("weight_qwen", (0.5, 2.0, "float")),       # Qwen2.5-72B 权重
    # MAB 参数
    ("mab_exploration_c", (0.5, 3.0, "float")),  # UCB 探索参数
    ("mab_xi", (0.001, 0.1, "float")),           # EI 探索参数
    # 集成策略
    ("ensemble_vote_threshold", (0.3, 0.7, "float")),  # 集成投票阈值
])


def evaluate_routing_params(params, eval_instances=None):
    """评估路由参数的性能（模拟目标函数）。
    在实际使用中，这应该运行一组评估实例并计算 resolved-rate。
    这里提供一个基于历史数据的模拟评估。
    """
    # 模拟：基于参数的合理性计算分数
    # 实际使用时替换为真实的评估
    score = 0.0

    # 复杂度阈值适中更好
    ps_len = params["complexity_ps_length_threshold"]
    test_cnt = params["complexity_test_count_threshold"]
    score += 0.3 * (1.0 - abs(ps_len - 1500) / 1500)
    score += 0.2 * (1.0 - abs(test_cnt - 8) / 8)

    # 模型权重均衡更好
    weights = [params["weight_flash"], params["weight_v4"], params["weight_qwen"]]
    weight_std = np.std(weights)
    score += 0.2 * (1.0 - weight_std)

    # MAB 探索参数适中
    score += 0.15 * (1.0 - abs(params["mab_exploration_c"] - 1.5) / 1.5)
    score += 0.15 * (1.0 - abs(params["ensemble_vote_threshold"] - 0.5) / 0.5)

    return max(0.0, min(1.0, score))


if __name__ == "__main__":
    # 简单测试
    print("贝叶斯优化器测试")
    print("=" * 50)

    optimizer = BayesianOptimizer(ROUTING_PARAM_SPACE, objective_func=evaluate_routing_params)
    best_params, best_score = optimizer.optimize(n_iterations=15)

    print("\n" + "=" * 50)
    print("优化结果")
    print("=" * 50)
    print(f"最佳分数: {best_score:.4f}")
    print("最佳参数:")
    for k, v in best_params.items():
        print(f"  {k}: {v}")

    # 保存状态
    save_optimizer(optimizer)
    print(f"\n优化状态已保存到: {BO_STATE_FILE}")
