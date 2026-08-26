# 飞虹 Code - 专用补全模型微调指南 (P3-1)

> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹

## 目录

1. [概述](#1-概述)
2. [环境准备](#2-环境准备)
3. [数据准备](#3-数据准备)
4. [模型训练](#4-模型训练)
5. [模型评估](#5-模型评估)
6. [模型导出与部署](#6-模型导出与部署)
7. [集成到飞虹 Code](#7-集成到飞虹-code)

---

## 1. 概述

飞虹 Code 支持使用专用微调的代码补全模型，通过 FIM (Fill-In-the-Middle) 格式训练，提升代码补全的准确率和上下文理解能力。

### 1.1 技术方案

| 组件 | 说明 |
|---|---|
| **基础模型** | bigcode/starcoderbase-1b（或其他代码生成模型） |
| **微调方法** | LoRA (Low-Rank Adaptation)，仅训练少量参数 |
| **训练格式** | FIM (Fill-In-the-Middle)，prefix/suffix/middle 三部分 |
| **评估指标** | 精确匹配率、编辑相似度、前缀匹配率、延迟 |
| **部署格式** | 合并模型 / GGUF / ONNX |

### 1.2 硬件要求

| 配置 | 最低 | 推荐 |
|---|---|---|
| GPU 显存 | 8GB (RTX 3060/4060) | 16GB+ (RTX 3090/4090/A10) |
| 内存 | 16GB | 32GB+ |
| 磁盘空间 | 20GB | 50GB+ |
| 训练时间 | 4-8 小时 (1B 模型) | 1-2 小时 |

---

## 2. 环境准备

### 2.1 安装 Python 依赖

```bash
# 创建虚拟环境
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
# .venv\Scripts\activate   # Windows

# 安装 PyTorch（根据 CUDA 版本选择）
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118

# 安装训练依赖
pip install transformers peft datasets accelerate evaluate sentencepiece
pip install tensorboard wandb  # 可选：可视化工具

# 安装导出依赖（可选）
pip install optimum onnxruntime  # ONNX 导出
pip install llama-cpp-python     # GGUF 导出
```

### 2.2 验证环境

```bash
python -c "import torch; print(f'PyTorch: {torch.__version__}'); print(f'CUDA: {torch.cuda.is_available()}')"
python -c "import transformers; print(f'Transformers: {transformers.__version__}')"
python -c "import peft; print(f'PEFT: {peft.__version__}')"
```

---

## 3. 数据准备

### 3.1 使用飞虹 Code 内置数据准备工具

飞虹 Code 提供了 TypeScript 版本的 FIM 数据准备工具，可以直接从代码库生成训练数据。

```bash
# 编译项目
npm run build

# 准备 FIM 训练数据
node dist/cli/index.js fim-prepare \
  --source-dir ./your-codebase \
  --output ./data/fim/dataset.jsonl \
  --samples-per-file 10 \
  --languages typescript,javascript,python
```

### 3.2 数据格式

输出为 JSONL 格式，每行一个样本：

```json
{
  "prefix": "function calculateSum(a: number, b: number): number {\n  return ",
  "suffix": "\n}\n\n// 其他代码...",
  "middle": "a + b",
  "file_path": "src/math.ts",
  "language": "typescript",
  "cursor_offset": 1234,
  "middle_length": 5
}
```

### 3.3 数据划分

工具会自动生成三个文件：
- `dataset.train.jsonl` - 训练集（90%）
- `dataset.val.jsonl` - 验证集（10%）
- `dataset.meta.json` - 元数据（统计信息、配置）

### 3.4 数据质量建议

1. **代码质量**：使用高质量的代码库作为数据源
2. **语言覆盖**：确保覆盖目标编程语言
3. **数据量**：建议至少 10,000+ 样本
4. **去重**：避免重复或高度相似的样本
5. **过滤**：排除自动生成的代码、minified 文件、测试快照

---

## 4. 模型训练

### 4.1 配置训练参数

编辑 `training/lora-config.json`：

```json
{
  "base_model": "bigcode/starcoderbase-1b",
  "output_dir": "./models/feihong-code-completion",
  "num_train_epochs": 3,
  "per_device_train_batch_size": 4,
  "gradient_accumulation_steps": 4,
  "learning_rate": 2e-4,
  "max_seq_length": 2048,
  "lora": {
    "r": 16,
    "lora_alpha": 32,
    "lora_dropout": 0.05,
    "target_modules": ["q_proj", "v_proj", "k_proj", "o_proj"]
  }
}
```

### 4.2 关键参数说明

| 参数 | 说明 | 推荐值 |
|---|---|---|
| `num_train_epochs` | 训练轮数 | 2-5 |
| `learning_rate` | 学习率 | 1e-4 ~ 3e-4 |
| `per_device_train_batch_size` | 每设备批大小 | 2-8（根据显存） |
| `gradient_accumulation_steps` | 梯度累积步数 | 2-8 |
| `max_seq_length` | 最大序列长度 | 1024-4096 |
| `lora.r` | LoRA 秩 | 8-32 |
| `lora.lora_alpha` | LoRA alpha | 16-64（通常为 r 的 2 倍） |
| `lora.lora_dropout` | LoRA dropout | 0.05-0.1 |

### 4.3 开始训练

```bash
cd training

# 使用默认配置训练
python train.py --config lora-config.json

# 指定基础模型
python train.py --config lora-config.json --base_model bigcode/starcoderbase-3b

# 从检查点恢复
python train.py --config lora-config.json --resume ./models/feihong-code-completion/checkpoint-1000
```

### 4.4 监控训练

```bash
# TensorBoard
tensorboard --logdir ./models/feihong-code-completion/runs

# 查看训练日志
tail -f ./models/feihong-code-complement/train_log.txt
```

### 4.5 训练技巧

1. **梯度检查点**：启用 `gradient_checkpointing: true` 节省显存
2. **混合精度**：启用 `bf16: true`（Ampere 及以上 GPU）或 `fp16: true`
3. **学习率调度**：使用 cosine 调度器，warmup 比例 3%
4. **早停**：监控验证损失，3 轮无提升则停止
5. **保存最佳模型**：`load_best_model_at_end: true`

---

## 5. 模型评估

### 5.1 使用飞虹 Code 评估工具

飞虹 Code 提供了 TypeScript 版本的补全模型评估工具。

```bash
# 编译项目
npm run build

# 运行评估
node dist/cli/index.js fim-evaluate \
  --samples ./data/fim/dataset.val.jsonl \
  --model ./models/feihong-code-completion \
  --output ./evaluation/result.json \
  --max-samples 500
```

### 5.2 评估指标

| 指标 | 说明 | 目标值 |
|---|---|---|
| **精确匹配率** | 预测与期望完全一致的比例 | > 30% |
| **编辑相似度** | 1 - 编辑距离/最大长度 | > 70% |
| **前缀匹配率** | 预测前缀与期望前缀的匹配度 | > 60% |
| **首 Token 匹配率** | 第一个 token 是否匹配 | > 50% |
| **平均延迟** | 单次补全的平均耗时 | < 500ms |

### 5.3 评估结果示例

```
=== 补全模型评估结果 ===
样本数: 500
精确匹配率: 32.40%
编辑相似度: 74.56%
前缀匹配率: 62.30%
首Token匹配率: 54.80%
平均延迟: 320.50ms

--- 按语言统计 ---
typescript: 200 样本, 精确匹配 35.0%, 编辑相似度 76.2%
javascript: 150 样本, 精确匹配 30.7%, 编辑相似度 73.1%
python: 100 样本, 精确匹配 28.0%, 编辑相似度 71.5%
其他: 50 样本, 精确匹配 24.0%, 编辑相似度 68.3%
```

### 5.4 与基线模型对比

建议在相同数据集上评估基线模型（未微调），对比提升效果：

```bash
# 评估基线模型
node dist/cli/index.js fim-evaluate \
  --samples ./data/fim/dataset.val.jsonl \
  --model bigcode/starcoderbase-1b \
  --output ./evaluation/baseline.json

# 对比结果
node dist/cli/index.js fim-compare \
  --baseline ./evaluation/baseline.json \
  --finetuned ./evaluation/result.json
```

---

## 6. 模型导出与部署

### 6.1 合并 LoRA 权重

训练完成后，需要将 LoRA 权重合并到基础模型：

```bash
cd training

# 合并 LoRA 并导出
python export.py \
  --model_path ./models/feihong-code-completion \
  --output ./models/exported \
  --format merged
```

### 6.2 导出格式

| 格式 | 用途 | 命令 |
|---|---|---|
| **merged** | 通用部署（Transformers） | `--format merged` |
| **GGUF** | llama.cpp 本地推理 | `--format gguf` |
| **ONNX** | Web / 跨平台部署 | `--format onnx` |
| **all** | 导出所有格式 | `--format all` |

### 6.3 导出产物

```
models/exported/
├── merged/                    # 合并后的模型
│   ├── config.json
│   ├── model.safetensors
│   ├── tokenizer.json
│   └── training_config.json
├── gguf/                      # GGUF 格式（可选）
│   └── model.gguf
├── onnx/                      # ONNX 格式（可选）
│   ├── model.onnx
│   └── tokenizer.json
└── feihong-model-config.json  # 飞虹 Code 模型配置
```

---

## 7. 集成到飞虹 Code

### 7.1 配置本地模型

编辑飞虹 Code 配置文件（`~/.feihong-code/config.json`）：

```json
{
  "completion": {
    "provider": "local",
    "model_path": "./models/exported/merged",
    "model_config": "./models/exported/feihong-model-config.json",
    "max_tokens": 100,
    "temperature": 0.2,
    "top_p": 0.95,
    "context_window": 2048
  }
}
```

### 7.2 启动本地推理服务

```bash
# 使用飞虹 Code 内置的本地模型服务
node dist/cli/index.js serve-local-model \
  --model ./models/exported/merged \
  --port 8081

# 或使用 vLLM（推荐，性能更好）
pip install vllm
vllm serve ./models/exported/merged --port 8081 --dtype bfloat16
```

### 7.3 配置飞虹 Code 使用本地服务

```json
{
  "completion": {
    "provider": "openai-compatible",
    "base_url": "http://localhost:8081/v1",
    "model": "feihong-code-completion",
    "api_key": "not-needed"
  }
}
```

### 7.4 验证集成

```bash
# 启动飞虹 Code Web 控制台
node dist/cli/index.js serve --port 8080

# 测试补全
curl -X POST http://localhost:8080/api/completion \
  -H "Content-Type: application/json" \
  -d '{
    "filePath": "test.ts",
    "fileContent": "function sum(a: number, b: number): number { return ",
    "cursorOffset": 50,
    "language": "typescript"
  }'
```

---

## 附录：常见问题

### Q1: 训练时 OOM (Out of Memory) 怎么办？

A: 
1. 减小 `per_device_train_batch_size`（如 1 或 2）
2. 增大 `gradient_accumulation_steps` 保持有效批大小
3. 减小 `max_seq_length`（如 1024）
4. 启用 `gradient_checkpointing: true`
5. 使用更小的基础模型（如 350M 或 1B）

### Q2: 训练后模型效果不好怎么办？

A:
1. 检查数据质量，确保样本多样化且高质量
2. 增加训练轮数（如 5-10 轮）
3. 调整学习率（如 1e-4 或 5e-5）
4. 增大 LoRA rank（如 32 或 64）
5. 增加 target_modules（包含更多层）
6. 对比基线模型，确认确实有提升

### Q3: 如何支持更多编程语言？

A:
1. 在数据准备时指定 `--languages` 参数
2. 确保训练数据包含目标语言的代码
3. 使用支持多语言的基础模型（如 StarCoder、CodeLlama）
4. 评估时按语言分别统计，针对性优化

### Q4: 可以在 CPU 上训练吗？

A: 可以，但非常慢。建议：
1. 使用 Google Colab (免费 T4 GPU)
2. 使用云 GPU 服务（如 AutoDL、RunPod、Vast.ai）
3. 使用更小的模型和数据集进行验证
