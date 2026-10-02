# ============================================================
# qwen3:8b 量化转换命令集（CPU 推理 · 32GB 内存机器）
# 署名：晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 吴赐虹
# ============================================================
# 前置：需要 llama.cpp（git clone https://github.com/ggerganov/llama.cpp && cmake -B build && cmake --build build）
# 或直接从 HuggingFace 下载预量化 GGUF（推荐，免编译）：
#   https://huggingface.co/Qwen/Qwen3-8B-GGUF

set -e

# ── 方案 A：有 FP16 原始权重时自行量化 ──────────────────────
# 1) HF safetensors → GGUF (FP16)
python llama.cpp/convert_hf_to_gguf.py \
  --model-dir /path/to/Qwen3-8B \
  --output-dir /path/to/out \
  --outtype f16

# 2) FP16 → Q5_K_M（推荐甜点：质量+体积平衡）
./llama.cpp/build/bin/llama-quantize \
  /path/to/out/qwen3-8b-f16.gguf \
  /path/to/out/qwen3-8b-q5_k_m.gguf \
  Q5_K_M

# 3) FP16 → Q4_K_S（更小体积 4.3GB）
./llama.cpp/build/bin/llama-quantize \
  /path/to/out/qwen3-8b-f16.gguf \
  /path/to/out/qwen3-8b-q4_k_s.gguf \
  Q4_K_S

# ── 方案 B：已有 GGUF 直接导入 Ollama ───────────────────────
cat > /tmp/qwen3-modelfile <<'EOF'
FROM /path/to/qwen3-8b-q5_k_m.gguf
EOF
ollama create qwen3:8b-q5km -f /tmp/qwen3-modelfile

# ── 方案 C：直接拉取（Ollama 仓库若有）──────────────────────
# ollama pull qwen3:8b-q5km   # 若仓库提供该量化标签

echo "完成。用 'ollama list' 确认新模型，再跑 05-benchmark.sh 对比速度。"
