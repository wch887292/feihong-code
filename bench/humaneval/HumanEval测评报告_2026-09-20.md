# 飞虹 Code（fhcode）· HumanEval+ 代码能力测评报告

> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心
> 日期：2026-09-20
> 评测模型：**agnes-3.0-flash**（fhcode 出站调用的大模型）
> 端点：https://api.agnes-ai.cn/v1（OpenAI 兼容）

---

## 0. 结论（先说重点）

**本报告全部为真实跑分数值，无任何伪造，可复现。**

| 指标 | 数值 |
|---|---|
| 基准 | HumanEval+（evalplus，164 题，HumanEval 的严格升级版） |
| **pass@1（temperature=0）** | **17 / 164 = 10.4%** |
| 编译执行成功（exec） | 157 / 164（95.7%） |
| 其中测试通过 | 17 |
| 答案错误（测试失败） | 140 |
| 代码语法/格式失败 | 7（4.3%） |

**一句话画像**：agnes-3.0-flash 能把近 96% 的题目"写出能跑的函数"，但在严格测试用例下只有约一成做对——属于"轻量模型"的典型水平，**不适合对外宣传为强代码模型**，但它补上了 fhcode 此前"零硬指标"的空白。

---

## 1. 为什么测这个

此前《fhcode 国产 IDE 横向测评报告》（2026-09-11）把"硬指标真空"列为 P0 级信誉风险：
- SWE-bench 真实修复：agnes-3.0-flash × 36 实例，**真实 resolved 0%**（会改代码但改不对 bug）；
- 函数级基准（HumanEval/MBPP）：**从未测过**。

本次补的就是函数级这一层。HumanEval 题量小（164 题）、不依赖 Docker/克隆大仓库、数小时出分，是建立"从 0 到有数字"基线的最快路径。

---

## 2. 方法与口径

| 项 | 设置 |
|---|---|
| 数据集 | HumanEvalPlus test.jsonl（164 题，含 prompt / entry_point / test） |
| 采样 | pass@1，temperature=0，max_tokens=512 |
| 调用方式 | OpenAI 兼容 chat/completions，system 要求"只输出函数体、不重复签名、不加解释" |
| 判定 | 子进程隔离执行（超时 12s），prompt+补全+官方 test，调用官方 test 函数 |
| 失败处理 | API 429 自动指数退避重试（最多 6 次），两轮跑完 164 题 |

**口径说明**：
- pass@1 = 17/164，与业界 HumanEval 标准口径一致（语法错误也算不通过）。
- 与 SWE-bench 的区别：HumanEval 考"孤立函数算法补全"，SWE-bench 考"真实仓库多文件修 bug"，后者难度远高于前者，二者不可互相替代。

---

## 3. 通过的题目（17 道）

HumanEval/7、19、27、30、31、61、68、74、77、92、105、108、128、137、143、148、149。

逐题轨迹见 `merged_results.jsonl`。

---

## 4. 怎么解读这 10.4%

1. **与 SWE-bench 结论自洽**：函数级 10.4% + 真实修复 0%，共同指向 agnes-3.0-flash 是"轻量快速"档位，而非强代码模型。这和它定位 flash（低延迟）一致。
2. **这是真实基线，不是上限**：本次为 chat 单次补全、无工具、无多轮自检。若启用 fhcode 的 Agent 多轮调试/自修复循环，实际工程能力会高于这个裸分，但需另行实测。
3. **横向定位（公开口径，仅供参考）**：顶尖代码模型 HumanEval pass@1 普遍 70–90%，中等开源模型 30–50%，轻量模型多在 10–30%。agnes-3.0-flash 落在轻量段偏低位。
4. **诚实立场**：10.4% 不粉饰。对外材料建议表述为"已建立可复现评测基线"，而非用该分数证明代码能力强。

---

## 5. 复现方式

```powershell
cd "H:\Muse Code复刻\bench\humaneval"
$env:AGNES_API_KEY = "<你的key>"
python eval_humaneval.py            # 全量
python eval_humaneval.py --limit 5  # 冒烟
python eval_humaneval.py --retry-failed  # 重跑限流失败题
python merge.py                     # 合并出 summary.json
```

产物：
- `HumanEvalPlus.jsonl`：数据集
- `results.jsonl` / `retry_results.jsonl`：两轮逐题结果
- `merged_results.jsonl`：合并后 164 题完整结果
- `summary.json`：汇总数字

---

## 6. 下一步建议

- [ ] 用同一脚本再测 **agnes-2.5-pro / agnes-2.5-pro** 模型（models 列表里有），看旗舰档能否把 pass@1 拉到 30%+，作为对外可宣传的主力模型。
- [ ] 若要硬刚竞品的 SWE 数字，把已生成的 194 个 patch 送官方 Docker harness 跑真实 resolved（此前留的 TODO）。
- [ ] 对外材料用"评测体系已建成 + 函数级基线 + 工程级实测"三段式，避免单讲一个偏低的 flash 分数。

---

*晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心*
*本报告数字来自 `merged_results.jsonl`，任何人可用上述命令复现。*
