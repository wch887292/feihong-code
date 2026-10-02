#!/usr/bin/env bash
# ============================================================
# llama.cpp server 调优启动（CPU 极限压榨方案）
# 署名：晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 吴赐虹
# 依赖：编译好的 llama.cpp（cmake -B build && cmake --build build --config Release）
# ============================================================
set -e

MODEL="${MODEL:-/path/to/qwen3-8b-q4_k_m.gguf}"

./build/bin/llama-server \
  -m "$MODEL" \
  -t 8 \                     # 线程：物理核 6 + 2（超线程对矩阵略有帮助，可 6/8/10 实测）
  -c 8192 \                  # 上下文窗口
  --mlock \                  # 锁内存，避免 swap 抖动（32GB 内存充足）
  --no-mmap \                # 启动时全量载入内存（配合 mlock 最稳）
  --cache-type-k q8_0 \      # KV cache K 量化：576MiB → 约 288MiB
  --cache-type-v q8_0 \
  --parallel 2 \             # 2 路并发槽位
  --cont-batching \          # 连续批处理
  --temp 0.3 --top-p 0.9 \   # 编程场景采样参数
  --host 127.0.0.1 --port 8080

# 对照组：Ollama 等效环境变量（二选一即可）
# export OLLAMA_KEEP_ALIVE=1h
# export OLLAMA_NUM_PARALLEL=2
# export OLLAMA_KV_CACHE_TYPE=q8_0
# export OLLAMA_FLASH_ATTENTION=1
