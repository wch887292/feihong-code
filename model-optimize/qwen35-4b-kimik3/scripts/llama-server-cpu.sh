#!/bin/bash
# llama.cpp server - 4B CPU 推理启动脚本
# 适用于 Intel i5-12400（6C12T）/ 32GB RAM / 纯 CPU 推理
#
# 用法：
#   chmod +x llama-server-cpu.sh
#   ./llama-server-cpu.sh
#
# 环境变量可覆盖默认值：
#   MODEL_PATH   - GGUF 模型路径（必填）
#   HOST         - 监听地址（默认 127.0.0.1）
#   PORT         - 监听端口（默认 8080）
#   CTX_SIZE     - 上下文长度（默认 8192）

set -e

MODEL_PATH="${MODEL_PATH:-H:/ollama/models/qwen3.5-4b-kimi-k3-q5_k_m.gguf}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8080}"
CTX_SIZE="${CTX_SIZE:-8192}"
THREADS="${THREADS:-6}"
BATCH_SIZE="${BATCH_SIZE:-512}"
TEMP="${TEMP:-0.7}"
TOP_P="${TOP_P:-0.9}"
TOP_K="${TOP_K:-40}"

echo "========================================"
echo "llama.cpp server - 4B CPU 推理"
echo "========================================"
echo "模型: ${MODEL_PATH}"
echo "线程: ${THREADS}"
echo "上下文: ${CTX_SIZE}"
echo "端口: ${HOST}:${PORT}"
echo "========================================"

llama-server \
  -m "${MODEL_PATH}" \
  --host "${HOST}" \
  --port "${PORT}" \
  --threads "${THREADS}" \
  --ctx-size "${CTX_SIZE}" \
  --batch-size "${BATCH_SIZE}" \
  --mlock 1 \
  --cache-type-kv Q8_0 \
  --no-mmap \
  --temp "${TEMP}" \
  --top-p "${TOP_P}" \
  --top-k "${TOP_K}" \
  --presence-penalty 1.0 \
  --seed 42 \
  --np 1 \
  --parallel 1 \
  --slots 1