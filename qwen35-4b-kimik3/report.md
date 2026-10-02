# Qwen3.5-4B-Kimi-K3 社区蒸馏模型优化提升方案

> 目标模型：guozhennianhua/qwen3.5-4b-kimi-k3（4.2B / Q4_K_M / 2.52GB）
> 运行环境：Intel i5-12400（6C12T）/ 32GB RAM / UHD 730 核显不可用 / 纯 CPU 推理

---

## 0. 模型现状勘察（ollama show 实测）

| 项目 | 实测值 |
|------|--------|
| 架构 | qwen35（Qwen3.5） |
| 参数量 | 4.2B |
| 量化档位 | Q4_K_M（file_type=15） |
| 上下文长度 | 262144（256K） |
| 嵌入维度 | 2560 |
| 层数 | 32 |
| 注意力头数 | 16（GQA，KV 头=4） |
| FFN 维度 | 9216 |
| 混合架构 | SSM（Mamba 风格） |
| 分词器 | GPT2-style，词表 248320 |
| 微调来源 | kimi-k3-merged-hf |
| 许可证 | Apache-2.0 + CC-BY-4.0 |
| 当前参数 | temperature=1, top_k=20, top_p=0.95, presence_penalty=1.5 |

**关键发现**：
1. Qwen3.5 架构，原生 256K 上下文，带 SSM 混合层。
2. 许可证声明未使用 Kimi API 输出，模型名为用户自选标签。
3. presence_penalty=1.5 偏激进，top_k=20 偏窄。
4. 模板为裸 {{ .Prompt }}，切换到 llama.cpp 需手动提供 chat template。

---

## 1. 量化压缩

### 1.1 现状与权衡

| 档位 | 预估体积 | 相对 Q4_K_M 精度提升 | CPU 推理速度影响 |
|------|----------|---------------------|------------------|
| Q4_K_M（现） | ~2.5GB | 基准 | 基准 |
| Q5_K_M | ~3.1GB | +3~5%（逻辑/数学） | -8~12% |
| Q6_K | ~3.7GB | +5~8%（代码生成） | -15~20% |
| Q8_0 | ~5.0GB | +8~10% | -30~40% |

**结论**：Q4_K_M 已是精度/体积甜点。Q5_K_M 是性价比最优升级。

### 1.2 重新量化注意事项

严禁从 Q4_K_M 反量化再量化（double quantization error）。正确做法：
1. 优先找官方/作者发布的其他档位（Ollama Library 搜索 :q5_k_m 或 :q6_k tag）。
2. 若需自行量化，必须从原始 FP16 权重开始，用 llama.cpp 的 llama-quantize 一次到位。
3. 原始权重获取路径：HuggingFace Qwen/Qwen3.5-4B（官方，Apache-2.0）。

### 1.3 推荐行动

- 短期：保持 Q4_K_M，通过参数调优提升体验。
- 中期：下载 Qwen/Qwen3.5-4B 原始权重，用同一微调数据合并，量化到 Q5_K_M。
- 长期：商业交付可直接使用官方 qwen3.5:4b，消除许可风险。