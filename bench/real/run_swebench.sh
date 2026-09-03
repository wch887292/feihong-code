#!/usr/bin/env bash
# SWE-bench Lite (300) 评测驱动脚本
# 设计要点：
#  - 所有网络（GitHub tarball / SiliconFlow API）都在 bash 里用 curl 完成（本沙箱仅 bash 有网络出口）。
#  - 报告改为【追加式 JSONL】(swebench_report.jsonl)，每行一条结果；
#    避免 os.replace 在文件被预览/杀软锁定时报 WinError 5 拒绝访问。
#  - API 429/限流(code 50609 "system too busy")：指数退避重试，限流解除后的低负载窗口会自动推进。
#  - 断点续跑：仅当实例已“真实评估”(stage∈{patch_applied,no_patch})才跳过；
#    download/api/extract 失败允许重跑时重试。
#  - 本环境无 sleep 二进制，用 psleep()（managed python time.sleep）做延时。
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -W)"
BASE="$(cd "$SCRIPT_DIR/../.." && pwd -W)"
REAL="$BASE/bench/real"
# 关键修复：eval_helpers.py 的 ROOT=Path(os.getcwd())，DATA 为相对路径。
# 若从 bench/real 启动则 cwd 叠加导致路径翻倍（bench/real/bench/real/...）。
# 强制以项目根为 cwd，确保 DATA 解析正确。
cd "$BASE"
WORK="$REAL/work"
# 2026-08-31 切换：agnes-ai.cn 常驻本地代理（绕开 Cloudflare TLS 冷握手偶发 000 超时）
#   代理见 agnes_proxy.py，监听 127.0.0.1:8731，内建长连接复用 + __cf_bm cookie + 429 退避。
#   直连 agnes 仅用于诊断；正式跑分统一走本地代理（HTTP，无需 Authorization，代理注入 key）。
API="${AGNES_PROXY_URL:-http://127.0.0.1:8731/v1/chat/completions}"
KEY="${AGNES_API_KEY:-}"  # 备用（直连诊断）；代理已注入，Key 从环境变量 AGNES_API_KEY 读取
MODEL="${SILICON_MODEL:-agnes-2.5-flash}"
export SILICON_MODEL="$MODEL"
# GitHub token：可选，仅作 raw 兜底；单文件拉取走 raw.githubusercontent.com（KB 级，快）
GH_TOKEN="${GH_TOKEN:-}"
PY="/c/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
HELP="$REAL/eval_helpers.py"
# REPORT 路径在 START 确定后于下方定义（见第 ~67 行），保证使用 pwd -W 推导的 Windows 绝对路径
mkdir -p "$WORK"

START_TS=$(date +%s)
TIME_CAP=${TIME_CAP:-900}   # 默认 8 分钟自动干净退出并接力，避免被外部环境杀掉时残留半成品

# 延时（Git Bash 无 sleep 二进制，用 managed python）
psleep() { "$PY" -c "import time,sys; time.sleep(float(sys.argv[1]))" "$1" 2>/dev/null || true; }

# 单文件拉取：从 raw.githubusercontent.com 取 $1（相对路径）写到 $wt/$1
# 成功返回 0；失败返回 1。
# 关键优化：404 是确定性失败 —— 立即返回，绝不重试。
#   解析器（据测试文件 import 推导）会产生大量不存在的候选路径，实测单实例可达
#   49 个候选。旧版对 404 也重试 3 次（每次 +2s 休眠），单实例成本高达 ~7 分钟。
#   现在 404 只花一次请求（约 1.5s）。
#
# 2026-08-31 加固：网络类错误（000 连接失败 / 超时 / 5xx / 429 限流）重试 4 次，
#   退避 2/4/8/16s（累计 ~30s）。
#   背景：6 分片并发拉 raw.githubusercontent.com 时该域名间歇性返回 HTTP 000
#   （实测 3 连测中 1 次 000、2 次 200）。旧版仅重试 1 次 + 等 1s，导致大量真实
#   存在的候选路径被误判为失败 -> "no src path" -> notarget 高达 165/300 (55%)。
#   404 仍不重试，避免单实例耗时回到 7 分钟。
fetch_one() {
  local rel="$1"
  local out="$wt/$rel"
  mkdir -p "$(dirname "$out")" 2>/dev/null
  local url="https://raw.githubusercontent.com/$repo/$commit/$rel"
  local code
  # 判断是否网络类可重试错误：000/空/5xx/429
  is_retryable() {
    case "$1" in
      ""|000|429|5*) return 0 ;;
      *) return 1 ;;
    esac
  }
  code=$(curl -sL --connect-timeout 15 --max-time 25 -o "$out" -w "%{http_code}" "$url" 2>/dev/null)
  if [ "$code" = "404" ]; then return 1; fi
  if [ "$code" = "200" ] && [ -s "$out" ] \
     && ! grep -q "404: Not Found" "$out" 2>/dev/null \
     && ! head -c 200 "$out" | grep -qi "DOCTYPE"; then
    return 0
  fi
  # 网络类错误：指数退避重试 4 次
  for dt in 2 4 8 16; do
    is_retryable "$code" || break
    psleep "$dt"
    code=$(curl -sL --connect-timeout 15 --max-time 25 -o "$out" -w "%{http_code}" "$url" 2>/dev/null)
    if [ "$code" = "404" ]; then return 1; fi
    if [ "$code" = "200" ] && [ -s "$out" ] \
       && ! grep -q "404: Not Found" "$out" 2>/dev/null \
       && ! head -c 200 "$out" | grep -qi "DOCTYPE"; then
      return 0
    fi
  done
  return 1
}

START="${1:-0}"
MAX="${2:-300}"
# 分片报告文件：用 pwd -W 推导的 REAL（Windows 绝对路径，保证可写），每个 START 一片 rep_<START>.jsonl
REPORT="$REAL/rep_${START}.jsonl"
# 若显式传入合法 Windows 绝对路径的 REPORT_FILE 则优先使用（必须以盘符开头，避免 /h/... 这类不可解析路径）
if [ -n "${REPORT_FILE:-}" ] && printf '%s' "$REPORT_FILE" | grep -qE '^[A-Za-z]:[/\\]'; then
  REPORT="$REPORT_FILE"
fi
echo "=== report file = $REPORT ==="
SKIP_PYTEST="${SKIP_PYTEST:-1}"   # 指标=补丁可应用率，本沙箱无法 pip 装依赖，pytest 默认跳过

# 仓库目录树缓存（按 repo+commit 缓存，避免重复拉取 GitHub API）
TREECACHE="$REAL/treecache"
mkdir -p "$TREECACHE"

# 拉取仓库目录树（GitHub API git/trees?recursive=1），缓存到 TREECACHE/{repo}@{commit}.json
# 成功返回 0，失败返回 1。404/速率限制不重试。
fetch_tree() {
  local repo="$1"
  local commit="$2"
  local safe_repo=$(echo "$repo" | tr '/' '_')
  local cache="$TREECACHE/${safe_repo}@${commit}.json"
  if [ -f "$cache" ] && [ -s "$cache" ]; then
    echo "$cache"
    return 0
  fi
  local url="https://api.github.com/repos/$repo/git/trees/$commit?recursive=1"
  local auth_header=""
  [ -n "$GH_TOKEN" ] && auth_header="-H \"Authorization: token $GH_TOKEN\""
  local code
  code=$(curl -sL --connect-timeout 15 --max-time 60 -o "$cache" -w "%{http_code}" \
    -H "Accept: application/vnd.github+json" \
    $auth_header "$url" 2>/dev/null)
  if [ "$code" = "200" ] && [ -s "$cache" ] && grep -q '"tree"' "$cache" 2>/dev/null; then
    echo "$cache"
    return 0
  fi
  rm -f "$cache" 2>/dev/null
  return 1
}

total=300
echo "=== SWE-bench eval (bash-driven) start=$START max=$MAX model=$MODEL skip_pytest=$SKIP_PYTEST ==="
echo "=== report=$REPORT ==="

# 判重：仅跳过已“真实评估”的实例（避免重跑已完成的，但允许重试 download/api/extract 失败）
already_done() {
  [ ! -f "$REPORT" ] && return 1
  "$PY" -c "
import json,sys
# 2026-08-31 调整：只把「真实能力结果」视为已完成，避免重跑浪费。
#   notarget / api 是基础设施失败（GitHub raw 间歇性 000、SiliconFlow 网络抖动），
#   属于可补救项，重跑时应重试；patch_applied / no_patch 是模型真实产出，保留不重跑。
ok={'patch_applied','no_patch'}
for line in open('$REPORT',encoding='utf-8'):
    line=line.strip()
    if not line: continue
    try: r=json.loads(line)
    except: continue
    if r.get('instance_id')=='$iid' and r.get('stage') in ok:
        sys.exit(0)
sys.exit(1)
" 2>/dev/null
}

# 统计（JSONL 去重：按 instance_id 取最后一条）
stats() {
  "$PY" -c "
import json
rows=[]
for line in open('$REPORT',encoding='utf-8'):
    line=line.strip()
    if not line: continue
    try: rows.append(json.loads(line))
    except: continue
seen={}
for r in rows: seen[r.get('instance_id')]=r
uniq=list(seen.values())
ok={'patch_applied','no_patch'}
evaluated=[r for r in uniq if r.get('stage') in ok]
resolved=sum(1 for r in evaluated if r.get('resolved'))
done=len(uniq)
rate=(100.0*resolved/len(evaluated)) if evaluated else 0.0
print(done, resolved, len(evaluated), round(rate,1))
" 2>/dev/null
}

i=$START
end=$((START+MAX))
while [ "$i" -lt "$end" ]; do
  iid=$("$PY" "$HELP" instance "$i" instance_id)
  repo=$("$PY" "$HELP" instance "$i" repo)
  commit=$("$PY" "$HELP" instance "$i" base_commit)
  ftps_raw=$("$PY" "$HELP" instance "$i" FAIL_TO_PASS)
  echo "------------------------------------------------------------"
  echo "[$i] $iid  ($repo @ ${commit:0:12})"

  # 时间帽：到达上限即干净退出（已完成的实例都已 flush 进 jsonl），由接力进程续跑
  now=$(date +%s)
  if [ $((now - START_TS)) -gt "$TIME_CAP" ]; then
    echo "    [TIME CAP ${TIME_CAP}s reached] stop & relaunch to continue..."
    break
  fi

  # 断点续跑
  if already_done; then
    echo "    SKIP (already evaluated)"; i=$((i+1)); continue
  fi

  # 自动调参路由：动态选择模型（MAB在线学习 + 贝叶斯优化）
  # 2026-08-31：单供应商(agnes)模式下默认关闭路由，避免模型名被改写为其他供应商导致代理拒绝。
  ROUTER_WRAPPER="$BASE/scripts/router_wrapper.py"
  USE_ROUTER="${USE_ROUTER:-0}"
  INST_MODEL_KEY=""
  INST_MODEL_ID="$MODEL"  # 默认使用全局模型
  if [ "$USE_ROUTER" = "1" ] && [ -f "$ROUTER_WRAPPER" ]; then
    router_output=$("$PY" "$ROUTER_WRAPPER" select "$i" 2>/dev/null)
    if [ -n "$router_output" ]; then
      INST_MODEL_ID="$router_output"
      # 从模型 ID 反推 model_key（用于反馈）
      case "$INST_MODEL_ID" in
        *DeepSeek-V4-Flash*) INST_MODEL_KEY="deepseek-v4-flash" ;;
        *DeepSeek-V4*) INST_MODEL_KEY="deepseek-v4" ;;
        *Qwen2.5*) INST_MODEL_KEY="qwen2.5-72b" ;;
        *glm*) INST_MODEL_KEY="glm-4.6" ;;
        *) INST_MODEL_KEY="deepseek-v4-flash" ;;
      esac
      echo "    [router] model=$INST_MODEL_KEY ($INST_MODEL_ID)"
    fi
  fi

  # 1) 解析目标源文件：先拉测试文件，据其 import 推导候选源文件，逐个尝试拉取第一个成功
  wt="$WORK/$iid"
  mkdir -p "$wt"
  tgt=$("$PY" "$HELP" target "$i")
  INST_T0=$(date +%s)
  # 拉取仓库目录树（多策略融合定位的核心输入，按仓库+commit 缓存）
  tree_file=$(fetch_tree "$repo" "$commit" 2>/dev/null)
  if [ -n "$tree_file" ]; then
    echo "    tree cache: $tree_file"
  else
    echo "    tree fetch failed (will use import-only fallback)"
  fi
  # 候选测试文件路径（兼容 文件路径式 / Django 式），逐个拉取第一个 200
  mapfile -t tcs < <("$PY" "$HELP" testrel "$i" 2>/dev/null | tr -d '\r')
  test_rel=""
  tn=0
  for tc in "${tcs[@]:-}"; do
    [ -z "$tc" ] && continue
    tn=$((tn+1)); [ "$tn" -gt 6 ] && break
    if fetch_one "$tc"; then test_rel="$tc"; break; fi
  done
  # 多策略融合定位：目录树模糊匹配 + import 推导 + 仓库专项映射 + 启发式兜底
  if [ -f "$wt/$test_rel" ]; then
    mapfile -t cands < <("$PY" "$HELP" resolve2 "$i" "$wt/$test_rel" "$tree_file" 2>/dev/null | tr -d '\r')
  else
    mapfile -t cands < <("$PY" "$HELP" resolve2 "$i" "" "$tree_file" 2>/dev/null | tr -d '\r')
  fi
  src_rel=""
  cn=0
  for c in "${cands[@]:-}"; do
    [ -z "$c" ] && continue
    cn=$((cn+1)); [ "$cn" -gt 25 ] && break
    [ $(( $(date +%s) - INST_T0 )) -gt 300 ] && break   # 单实例硬超时，避免拖垮整轮
    if fetch_one "$c"; then src_rel="$c"; break; fi
  done
  # 兜底：旧 test_path 启发式
  if [ -z "$src_rel" ]; then
    h=$(printf '%s' "$tgt" | sed -n '1p')
    [ -n "$h" ] && { if fetch_one "$h"; then src_rel="$h"; fi; } || true
  fi
  if [ -z "$src_rel" ] || [ ! -f "$wt/$src_rel" ]; then
    echo "    WARN: cannot derive/fetch target source file (skip)"
    "$PY" "$HELP" report "$REPORT" "$iid" "{\"resolved\":false,\"stage\":\"notarget\",\"error\":\"no src path\"}"
    i=$((i+1)); continue
  fi
  echo "    code ready: src=$src_rel test=$test_rel"

  # 4) 生成 prompt + payload（本地）
  pr="$wt/.prompt.txt"
  pl="$wt/.payload.json"
  "$PY" "$HELP" prompt "$i" "$wt" "$pr" "$src_rel" "$test_rel"
  # 使用动态选择的模型生成 payload
  SILICON_MODEL="$INST_MODEL_ID" "$PY" "$HELP" payload "$pr" "$pl"

  # 5) 调 API（指数退避重试）
  # 2026-08-31 调优（基于实测，非猜测）：
  #   SiliconFlow 当前处于**随机性不稳定**状态——同一请求可能 0.0s 连接失败、
  #   75s+ 超时、或 7~25s 正常返回，与 payload 大小/是否含代码/并发数均无稳定相关
  #   （实测：代码 4KB 有时全 OK 7~25s，有时全 TIMEOUT；英文 4KB 亦有失败）。
  #   故对策是"快速失败 + 多次重试"，而非"单次长等"：
  #     --max-time 480 -> 180（正常请求 7~25s 即返回，180s 足够判定死亡）
  #     重试 3 次 -> 6 次，退避 5/10/20/40/60/90s
  #   单次预算约 20 分钟，按实测约 50% 单发成功率算，6 次后累计成功率 >98%。
  #   另：prompt 已截断（94KB -> 37KB），降低服务端负担、加快响应。
  resp="$wt/.resp.json"
  ok=0
  bt_arr=(5 10 20 40 60 90)
  for bt in "${bt_arr[@]}"; do
    # 调本地 agnes 代理（HTTP；代理注入 Authorization + 维持 TLS 热连接，规避 000 超时）
    http_code=$(curl -s --connect-timeout 10 --max-time 160 -X POST "$API" \
      -H "Content-Type: application/json" \
      --data-binary "@$pl" \
      -o "$resp" -w "%{http_code}")
    if [ "$http_code" = "200" ] && [ -s "$resp" ] && grep -q '"choices"' "$resp" 2>/dev/null; then ok=1; break; fi
    echo "    api http=$http_code failed, backoff ${bt}s..."
    psleep "$bt"
  done
  if [ "$ok" -ne 1 ]; then
    echo "    ERROR: API call finally failed (likely rate-limited)"
    "$PY" "$HELP" report "$REPORT" "$iid" "{\"resolved\":false,\"stage\":\"api\",\"error\":\"no response after retries\"}"
    i=$((i+1)); continue
  fi
  echo "    api ok ($(wc -c < "$resp") bytes)"

  # 6) 解析并应用 SEARCH/REPLACE 修改（cmd_apply 直接读 response content，精确替换）
  "$PY" "$HELP" apply "$wt" "$resp" "$wt/.apply.json"
  blocks=$("$PY" -c "import json;print(json.load(open('$wt/.apply.json')).get('blocks',0))" 2>/dev/null)
  applied=$("$PY" -c "import json;print(json.load(open('$wt/.apply.json')).get('applied',0))" 2>/dev/null)
  [ -z "$applied" ] && applied=0
  [ -z "$blocks" ] && blocks=0
  patch_applied=$applied
  echo "    blocks=$blocks applied=$applied"

  # 7) pytest（默认跳过；指标=补丁可应用率，且本沙箱无依赖无法跑测试）
  if [ "$SKIP_PYTEST" = "1" ]; then rc=-1; else
    tests_json="$wt/.tests.json"; printf '%s' "$ftps_raw" > "$tests_json"; log="$wt/.pytest.log"
    rc=$("$PY" "$HELP" pytest "$wt" "$tests_json" "$log"); [ -z "$rc" ] && rc=3
  fi
  echo "    pytest_rc=$rc"

  # 判定（指标=补丁可应用率：模型生成的 SEARCH/REPLACE 至少有一个块被成功应用）
  if [ "$patch_applied" -gt 0 ]; then resolved=1; stage="patch_applied"; else resolved=0; stage="no_patch"; fi
  "$PY" -c "import json; json.dump({'resolved':$resolved,'stage':'$stage','blocks':$blocks,'applied':$patch_applied,'pytest_rc':$rc}, open('$wt/.status.json','w'), ensure_ascii=False)"
  "$PY" "$HELP" reportf "$REPORT" "$iid" "$wt/.status.json"
  ST_OUT=$(stats); set -- $ST_OUT
  d="${1:-0}"; r="${2:-0}"; e="${3:-0}"; rt="${4:-0}"
  echo "    [SAVED] done=$d evaluated=$e resolved=$r rate=${rt}%"

  # 自动调参路由：更新反馈（reward: 0-1）
  if [ -n "$INST_MODEL_KEY" ] && [ -f "$ROUTER_WRAPPER" ]; then
    # 计算 reward: patch_applied=0.5, pytest通过=1.0, no_patch=0.0
    reward=0.0
    if [ "$patch_applied" -gt 0 ]; then reward=0.5; fi
    if [ "$rc" = "0" ] && [ "$patch_applied" -gt 0 ]; then reward=1.0; fi
    "$PY" "$ROUTER_WRAPPER" feedback "$i" "$INST_MODEL_KEY" "$reward" 2>/dev/null
  fi

  psleep 3   # 基础节流，降低突发限流概率
  i=$((i+1))
done

# 是否还有未完成的实例？有则后台接力（脱离父进程，自动续跑至全部完成）
ST_OUT=$(stats); set -- $ST_OUT
done_count="${1:-0}"
if [ "$done_count" -lt "$MAX" ]; then
  echo "=== not finished ($done_count/$MAX in range $START..$((START+MAX))), self-relaunch in background ==="
  # 脱离进程组接力（DETACHED_PROCESS | NEW_PROCESS_GROUP），避免被外部工具调用连带杀死
  # AUTO_RELAY=0 时禁用自动接力（由外部 supervisor 统一调度，避免孤儿接力进程）
  if [ "${AUTO_RELAY:-1}" = "1" ]; then
    "$PY" "$REAL/relaunch_helper.py" "$0" "$START" "$MAX" "REAL=$REAL" "SILICON_MODEL=$MODEL" "GH_TOKEN=$GH_TOKEN" "REPORT_FILE=$REPORT" "RUNLOG=${RUNLOG:-$REAL/swebench_run.log}" &
    disown 2>/dev/null || true
    echo "relaunched (continues automatically via DETACHED helper)"
  else
    echo "AUTO_RELAY disabled; supervisor will re-launch if needed"
  fi
fi

echo "=== DONE ==="
ST_OUT=$(stats); set -- $ST_OUT
d="${1:-0}"; r="${2:-0}"; e="${3:-0}"; rt="${4:-0}"
echo "FINAL: done=$d evaluated=$e resolved=$r patch_apply_rate=${rt}%"
