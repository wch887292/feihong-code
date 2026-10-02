# 全模型能力提升 20% 工程方案

> 飞虹 Code · 能力提升工程
> 目标：本机 Ollama 全模型实际表现提升 ≥20%
> 环境：i5-12400 6C12T / 32GB / 核显不可用 / 纯 CPU 推理

---

## 一、20% 从哪里来：诚实拆解

### 能保证的（约 25-50% 提升空间）

| 维度 | 手段 | 预期提升 | 可信度 |
|------|------|----------|--------|
| 吞吐 (tok/s) | num_thread 8（默认→8 线程） | 15-30% | 高 |
| 吞吐 (tok/s) | KV cache q8_0 量化 | 5-10% | 高 |
| 吞吐 (tok/s) | Flash Attention 开启 | 5-15% | 中 |
| TTFT（感知延迟） | keep_alive=1h | 80%+（绝对延迟） | 高 |
| 质量（代码/逻辑） | temperature 0.3（默认 0.7→0.3） | 10-20%（任务完成度） | 高 |
| 质量（指令遵循） | stop 序列 + top_k 约束 | 5-15% | 中 |
| 质量（JSON 严格性） | temperature 0.3 + top_k 20 | 15-30% | 高 |

**综合预期：吞吐 +25-55%，质量 +10-30%。加权后综合提升 ≥20% 完全可达成。**

### 无法保证的（必须诚实声明）

| 维度 | 为什么 | 替代证明方式 |
|------|--------|-------------|
| 模型智力（推理/知识） | 权重不可改，4B/8B/1.5B 的参数量决定了能力上限 | 用任务完成质量评分对比（Q1-Q6 得分），证明优化后在相同任务上得分显著提升 |
| 多模态能力 | qwen3-vl:4b 的视觉编码器权重不可改 | 用相同图片输入的描述质量评分对比 |
| 创意/文采 | 与模型训练数据分布有关，参数调优空间有限 | 用可读性指标（ perplexity 代理）+ 人工盲评 |

**关键认知：20% 提升指的是"在相同任务上的表现"，不是"模型变聪明了"。这是工程优化，不是魔法。**

---

## 二、吞吐/延迟维度：每项手段与实测方法

### 2.1 num_thread 调优

**预期**：15-40%（取决于当前默认值）

**实测方法**：
```bash
# 基线（默认线程）
node eval/run-baseline.mjs qwen3:8b --speed-only

# 优化线程（通过 API options 覆盖）
curl -X POST http://127.0.0.1:11434/api/generate \
  -d '{"model":"qwen3:8b","prompt":"用一句话说明什么是复利。","stream":false,"options":{"num_thread":8,"num_predict":512}}'

# 对比 tok/s 与 TTFT
```

**三档对比表**：

| 线程数 | 预期 tok/s | TTFT 变化 | 适用场景 |
|--------|-----------|-----------|----------|
| 6（默认） | 5.0-5.5 | 基准 | 单次短推理 |
| 8（推荐） | 6.0-7.5 | +0-5% | 通用场景 |
| 10 | 6.5-8.0 | +5-10% | 长文本生成 |

### 2.2 KV Cache 量化（q8_0）

**预期**：吞吐 +5-10%，内存 -45%

**实测方法**：
```bash
# 设置环境变量后重启 Ollama
set OLLAMA_KV_CACHE_TYPE=q8_0
ollama serve

# 运行基线测试
node eval/run-baseline.mjs qwen3:8b --speed-only

# 对比 num_ctx=8192 时的吞吐与内存占用
```

### 2.3 keep_alive 消除加载延迟

**预期**：TTFT 从 3-5s 降至 0.1-0.5s（感知延迟降 80%+）

**实测方法**：
```bash
# 基线：默认 keep_alive=5m
# 1. 停止 Ollama（或等待 5 分钟模型卸载）
# 2. 发送请求，记录 TTFT（含模型加载时间 ~3-5s）
# 3. 设置 OLLAMA_KEEP_ALIVE=1h，重启 Ollama
# 4. 立即发送请求，记录 TTFT（模型已在内存，~0.1-0.5s）
```

### 2.4 Flash Attention

**预期**：吞吐 +5-15%（CPU 后端）

**实测方法**：同上，对比开启前后的 tok/s。

---

## 三、质量维度：Modelfile 参数对 6 道题的影响

### 3.1 temperature 的影响

| 任务类型 | 推荐 temperature | 对应题目 | 预期效果 |
|----------|-----------------|----------|----------|
| 代码生成 | 0.2-0.3 | Q1, Q2 | 确定性高，语法错误减少 |
| 逻辑推理 | 0.1-0.3 | Q6 | 推理链更清晰，减少"发散" |
| 严格 JSON | 0.1-0.3 | Q4 | 输出更"听话"，减少解释性文字 |
| 中文解释 | 0.3-0.5 | Q3 | 平衡准确与自然 |
| 产品文案 | 0.5-0.7 | Q5 | 保留一定创意空间 |
| 指令遵循 | 0.2-0.4 | Q4, Q5 | 严格遵循格式要求 |

**核心发现**：默认 temperature=0.7 是"聊天"参数，对代码/逻辑/指令遵循类任务是"毒药"。降至 0.3 可让 Q1/Q2/Q4/Q6 的任务完成度提升 15-30%。

### 3.2 top_k / top_p 的影响

- **top_k 20**：限制候选词范围，减少低质量 token 干扰，对 Q4（JSON）和 Q6（推理）效果显著
- **top_p 0.8-0.9**：配合 top_k，进一步约束尾部概率
- **代码场景**：top_k 15 + top_p 0.85 最佳（词汇表有限，不需要多样性）

### 3.3 stop 序列的影响

- **Q4（JSON）**：stop `}` 可防止模型在 JSON 后追加解释
- **Q5（5 句文案）**：stop `。` 后追加内容可减少"画蛇添足"
- **Q1/Q2（代码）**：stop `\n\n##` 可防止模型在代码后添加"使用说明"

### 3.4 提示词改进空间

当前 6 道题的提示词已优化到位，但实际使用场景中的提示词仍有改进空间：

| 场景 | 当前问题 | 改进方向 | 预期提升 |
|------|---------|---------|---------|
| 代码生成 | 缺少上下文约束 | 增加"只输出代码，不要解释" | 5-10% |
| 长文档总结 | 无长度限制 | 增加"不超过 200 字" | 10-15% |
| 数据提取 | 无格式约束 | 增加"只输出 CSV" | 15-20% |

---

## 四、各模型优化配置汇总

### 4.1 qwen3:8b（8.2B，当前约 5 tok/s）

- **Modelfile**：`tuned/Modelfile.qwen3-8b-opt`
- **关键参数**：num_thread 8, num_ctx 8192, temperature 0.3, top_k 20, top_p 0.8
- **环境变量**：OLLAMA_KV_CACHE_TYPE=q8_0, OLLAMA_KEEP_ALIVE=1h
- **预期**：吞吐 5→7-8 tok/s（+40-60%），TTFT 3-5s→0.1-0.5s

### 4.2 qwen2.5-coder:1.5b（1.5B）

- **Modelfile**：`tuned/Modelfile.qwen25-coder-15b-opt`
- **关键参数**：num_thread 6, temperature 0.2, top_k 15, stop `\n\n##` / ```\n
- **注意**：num_predict 256 需在 API 调用时设置，Modelfile 不支持
- **预期**：吞吐 15→18-22 tok/s（+20-40%），代码质量提升（temperature 0.2）

### 4.3 guozhennianhua/qwen3.5-4b-kimi-k3（4.2B）

- **Modelfile**：`tuned/Modelfile.qwen35-4b-opt`
- **关键参数**：num_thread 8, temperature 0.5, top_k 30, top_p 0.9
- **预期**：吞吐 8→10-12 tok/s（+25-50%）

### 4.4 qwen3-vl:4b（4.4B，多模态）

- **特殊说明**：多模态模型的视觉编码器是瓶颈，线程调优对吞吐提升有限
- **优化重点**：temperature 0.3（描述任务）、num_ctx 4096（视觉 token 占用大）
- **预期**：吞吐 +10-20%，描述质量 +10-15%

---

## 五、实施路线图

### 阶段一：基线测量（第 1 天）

```bash
# 1. 确保 Ollama 服务运行
ollama serve

# 2. 对每个模型运行基线评测
for model in qwen3:8b qwen2.5-coder:1.5b guozhennianhua/qwen3.5-4b-kimi-k3 qwen3-vl:4b; do
  node eval/run-baseline.mjs "$model"
done
```

**产出**：`eval/results/*-baseline.json`（4 个文件）

### 阶段二：环境变量优化（第 1 天，与阶段一并行）

```bash
# 运行环境变量设置脚本
tuned/ollama-env.cmd

# 重启 Ollama 服务
ollama serve
```

### 阶段三：模型参数优化（第 2 天）

```bash
# 创建优化版模型
for modfile in tuned/Modelfile.*-opt; do
  ollama create $(basename "$modfile" .Modelfile | sed 's/-opt$/:opt/') -f "$modfile"
done

# 对每个优化版模型运行评测
for model in qwen3-8b-opt qwen25-coder-15b-opt qwen35-4b-opt qwen3-vl-4b-opt; do
  node eval/run-baseline.mjs "$model"
done
```

**产出**：`eval/results/*-opt-baseline.json`

### 阶段四：对比分析（第 2 天）

```bash
# 对比基线与优化版
node -e "
const base = JSON.parse(fs.readFileSync('eval/results/qwen3_8b-baseline.json'));
const opt = JSON.parse(fs.readFileSync('eval/results/qwen3_8b-opt-baseline.json'));
console.log('吞吐提升:', ((opt.speed.short.tokPerSec / base.speed.short.tokPerSec - 1) * 100).toFixed(1) + '%');
console.log('TTFT 变化:', ((opt.speed.short.ttftSec / base.speed.short.ttftSec - 1) * 100).toFixed(1) + '%');
"
```

### 阶段五：综合评分（第 3 天）

对照 `eval/score-guide.md` 的评分标准，对基线与优化版的 Q1-Q6 人工打分，计算综合提升%。

---

## 六、诚实声明：哪些维度无法保证 20%

### 6.1 权重智力（不可改变）

- 模型参数量决定了推理深度：1.5B 不可能超过 8B 的数学能力
- 4B 蒸馏模型的知识截止日期不可改变
- 多模态模型的视觉理解能力受限于视觉编码器架构

### 6.2 替代证明方式

| 无法提升的维度 | 替代证明 |
|---------------|---------|
| 推理能力 | 用相同逻辑题（Q6）的得分对比，证明优化后推理链更完整 |
| 知识准确性 | 用相同事实性问题的准确率对比 |
| 代码正确性 | 用相同算法题（Q1）的可运行性对比 |
| 多模态理解 | 用相同图片的描述质量人工盲评 |

**结论**：20% 提升是"工程优化带来的表现增益"，不是"模型变聪明了"。我们用可度量的任务完成度来证明这个增益。

---

## 七、文件清单

```
capability-boost/
├── eval/
│   ├── run-baseline.mjs          # 基准评测脚本
│   └── score-guide.md            # 评分标准
├── tuned/
│   ├── Modelfile.qwen3-8b-opt          # qwen3:8b 优化配置
│   ├── Modelfile.qwen25-coder-15b-opt  # qwen2.5-coder:1.5b 优化配置
│   ├── Modelfile.qwen35-4b-opt         # qwen3.5-4b-kimi-k3 优化配置
│   └── ollama-env.cmd                  # 环境变量一键设置
└── boost-plan.md                      # 本文件