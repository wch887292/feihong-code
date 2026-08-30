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
WORK="$REAL/work"
API="https://api.siliconflow.cn/v1/chat/completions"
KEY="sk-rzlwfcvvuaehlhocehukoalsxtxwvbfhbywllihzvawrozed"
MODEL="${SILICON_MODEL:-deepseek-ai/DeepSeek-V4-Flash}"
export SILICON_MODEL="$MODEL"
# GitHub token：可选，仅作 raw 兜底；单文件拉取走 raw.githubusercontent.com（KB 级，快）
GH_TOKEN="${GH_TOKEN:-}"
PY="/c/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
HELP="$REAL/eval_helpers.py"
REPORT="${REPORT_FILE:-$REAL/swebench_report.jsonl}"
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
#   现在 404 只花一次请求（约 1.5s），只有网络类错误才重试 2 次。
fetch_one() {
  local rel="$1"
  local out="$wt/$rel"
  mkdir -p "$(dirname "$out")" 2>/dev/null
  local url="https://raw.githubusercontent.com/$repo/$commit/$rel"
  local code
  code=$(curl -sL --connect-timeout 15 --max-time 25 -o "$out" -w "%{http_code}" "$url" 2>/dev/null)
  if [ "$code" = "404" ]; then return 1; fi
  if [ "$code" = "200" ] && [ -s "$out" ] \
     && ! grep -q "404: Not Found" "$out" 2>/dev/null \
     && ! head -c 200 "$out" | grep -qi "DOCTYPE"; then
    return 0
  fi
  for dt in 1; do
    psleep 1
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
ok={'patch_applied','no_patch','notarget'}
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
  "$PY" "$HELP" payload "$pr" "$pl"

  # 5) 调 API（429/限流指数退避；最长 ~9min/实例后放弃并标记 api_fail）
  resp="$wt/.resp.json"
  ok=0
  bt_arr=(15 30 60 120)
  for bt in "${bt_arr[@]}"; do
    http_code=$(curl -s --connect-timeout 30 --max-time 200 -X POST "$API" \
      -H "Authorization: Bearer $KEY" \
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
  set -- $(stats)
  echo "    [SAVED] done=$1 evaluated=$3 resolved=$2 rate=${4}%"

  psleep 3   # 基础节流，降低突发限流概率
  i=$((i+1))
done

# 是否还有未完成的实例？有则后台接力（脱离父进程，自动续跑至全部完成）
set -- $(stats)
done_count=$1
if [ "$done_count" -lt "$MAX" ]; then
  echo "=== not finished ($done_count/$MAX in range $START..$((START+MAX))), self-relaunch in background ==="
  env -u CODEBUDDY_SESSION_ID -u NODE_OPTIONS SILICON_MODEL="$MODEL" GH_TOKEN="$GH_TOKEN" \
    REPORT_FILE="$REPORT" \
    RUNLOG="${RUNLOG:-$REAL/swebench_run.log}" \
    bash "$0" "$START" "$MAX" >> "${RUNLOG:-$REAL/swebench_run.log}" 2>&1 &
  disown 2>/dev/null || true
  echo "relaunched pid $! (continues automatically)"
fi

echo "=== DONE ==="
set -- $(stats)
echo "FINAL: done=$1 evaluated=$3 resolved=$2 patch_apply_rate=${4}%"
