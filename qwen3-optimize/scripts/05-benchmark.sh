#!/usr/bin/env bash
# ============================================================
# qwen3:8b 优化前后基准测速脚本
# 署名：晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 吴赐虹
# 用法：bash 05-benchmark.sh [模型名]   （默认 qwen3:8b，可传 qwen3:8b-opt 对比）
# ============================================================
MODEL="${1:-qwen3:8b}"
PROMPT="用 Python 写一个带类型注解的 LRU 缓存类，包含 get/put 方法，并附 3 行使用示例。"

echo "=== 模型: $MODEL ==="
echo "--- 第 1 轮（含冷加载，仅参考）---"
time curl -s http://127.0.0.1:11434/api/generate -d "{
  \"model\": \"$MODEL\",
  \"prompt\": \"$PROMPT\",
  \"stream\": false,
  \"think\": false,
  \"options\": {\"temperature\": 0.3, \"num_ctx\": 8192}
}" | python -c "
import json,sys
d=json.load(sys.stdin)
print(f\"总耗时      : {d['total_duration']/1e9:.1f}s\")
print(f\"加载耗时    : {d['load_duration']/1e9:.1f}s\")
print(f\"prompt 评估 : {d['prompt_eval_count']} tok @ {d['prompt_eval_count']/(d['prompt_eval_duration']/1e9):.1f} tok/s\")
print(f\"生成速度    : {d['eval_count']} tok @ {d['eval_count']/(d['eval_duration']/1e9):.2f} tok/s\")
"

echo "--- 第 2 轮（模型已热，真实吞吐）---"
time curl -s http://127.0.0.1:11434/api/generate -d "{
  \"model\": \"$MODEL\",
  \"prompt\": \"$PROMPT\",
  \"stream\": false,
  \"think\": false,
  \"options\": {\"temperature\": 0.3, \"num_ctx\": 8192}
}" | python -c "
import json,sys
d=json.load(sys.stdin)
print(f\"总耗时      : {d['total_duration']/1e9:.1f}s\")
print(f\"prompt 评估 : {d['prompt_eval_count']} tok @ {d['prompt_eval_count']/(d['prompt_eval_duration']/1e9):.1f} tok/s\")
print(f\"生成速度    : {d['eval_count']} tok @ {d['eval_count']/(d['eval_duration']/1e9):.2f} tok/s\")
"

echo ""
echo "提示：优化验收标准 = 第 2 轮生成速度 ≥ 基线（约 5 tok/s）且总耗时下降；"
echo "      首轮 prompt eval 时间应因 prompt cache 命中而明显缩短。"
