# -*- coding: utf-8 -*-
"""
fhcode / agnes-3.0-flash 在 HumanEval+ 上的 pass@1 评测
- OpenAI 兼容 chat/completions, temperature=0
- 每题子进程隔离执行, 超时保护
- key 从环境变量 AGNES_API_KEY 读取, 不硬编码
用法:
  python eval_humaneval.py --limit 5            # 冒烟
  python eval_humaneval.py                       # 全量 164
  python eval_humaneval.py --limit 20 --workers 4
"""
import argparse, json, os, re, ssl, subprocess, sys, tempfile, time, urllib.request

BASE = os.environ.get("EVAL_BASE", "https://api.agnes-ai.cn/v1/chat/completions")
MODEL = os.environ.get("EVAL_MODEL", "agnes-3.0-flash")
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "HumanEvalPlus.jsonl")
OUT = os.path.join(HERE, "results.jsonl")

def load_items():
    items = []
    with open(DATA, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                items.append(json.loads(line))
    return items

def call_model(prompt, key):
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content":
             "You are an expert Python code completion engine. "
             "Given a Python function signature and docstring, output ONLY the indented function body that completes the function. "
             "Do NOT repeat the function signature, do NOT add explanations, do NOT use markdown code fences."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.0,
        "max_tokens": 512,
    }
    data = json.dumps(body).encode("utf-8")
    ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
    last_err = None
    for attempt in range(6):
        try:
            req = urllib.request.Request(BASE, data=data, headers={
                "Authorization": "Bearer " + key,
                "Content-Type": "application/json",
            })
            with urllib.request.urlopen(req, timeout=90, context=ctx) as r:
                resp = json.loads(r.read().decode("utf-8"))
            return resp["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            last_err = "HTTP %s" % e.code
            body_txt = ""
            try:
                body_txt = e.read().decode("utf-8", "ignore")
            except Exception:
                pass
            limited = (e.code == 429) or ("429" in body_txt) or ("RateLimit" in body_txt) or ("rate limit" in body_txt.lower())
            if limited:
                wait = min(90, 8 * (2 ** attempt))
                time.sleep(wait)
                continue
            time.sleep(3)
        except Exception as e:
            last_err = str(e)[:200]
            time.sleep(min(30, 3 * (attempt + 1)))
    raise RuntimeError("API 重试失败: " + (last_err or ""))

def normalize_completion(completion, prompt, entry_point):
    """鲁棒提取函数体: 去围栏/重复签名/docstring, 统一缩进到4格, 截到函数体外"""
    c = completion.strip()
    if c.startswith("```"):
        c = re.sub(r"^```[a-zA-Z]*\n?", "", c)
        c = re.sub(r"\n?```$", "", c)
    lines = c.split("\n")
    body_lines, started = [], False
    for ln in lines:
        stripped = ln.strip()
        if not started:
            # 跳过重复的 def entry_point 行
            if re.match(rf"\s*def\s+{re.escape(entry_point)}\b", ln):
                continue
            # 跳过重复的 docstring 起始行
            if stripped.startswith('"""') or stripped.startswith("'''"):
                continue
            started = True
        # 遇到顶格非空行 = 函数体外(测试/main/注释), 截断
        if ln and not ln[0] in (" ", "\t"):
            break
        body_lines.append(ln)
    body = "\n".join(body_lines).rstrip()
    # 统一缩进: 按最小缩进重排, 对齐到函数体4格
    indents = [len(ln) - len(ln.lstrip(" ")) for ln in body.split("\n") if ln.strip()]
    base = min(indents) if indents else 0
    fixed = []
    for ln in body.split("\n"):
        fixed.append(("    " + ln[base:]) if ln.strip() else "")
    return "\n".join(fixed)

# 子进程里执行的测试代码模板
RUNNER = r'''
import sys, json, traceback
code = sys.stdin.read()
ns = {}
try:
    exec(code, ns)
except Exception:
    print(json.dumps({"ok": False, "phase": "exec", "err": traceback.format_exc()[:800]}))
    sys.exit(0)
# 找 test 函数名
test_fn = None
for name, val in ns.items():
    if callable(val) and name in ("test", "check"):
        test_fn = name
        break
if test_fn is None:
    print(json.dumps({"ok": False, "phase": "notest", "err": "no test/check fn"}))
    sys.exit(0)
try:
    ns[test_fn](ns[ENTRY])
    print(json.dumps({"ok": True, "phase": "pass"}))
except Exception:
    print(json.dumps({"ok": False, "phase": "test", "err": traceback.format_exc()[:800]}))
'''

def run_one(item, completion):
    prompt = item["prompt"]
    entry_point = item["entry_point"]
    test = item["test"]
    body = normalize_completion(completion, prompt, entry_point)
    code = prompt + body + "\n\n" + test
    runner_code = "ENTRY = " + repr(entry_point) + "\n" + RUNNER
    # 子进程执行, 超时 12s
    try:
        p = subprocess.run(
            [sys.executable, "-c", runner_code],
            input=code, capture_output=True, text=True, timeout=12, encoding="utf-8",
        )
        out = (p.stdout or "").strip().splitlines()
        last = out[-1] if out else ""
        try:
            return json.loads(last)
        except Exception:
            return {"ok": False, "phase": "parse",
                    "err": ("stdout=" + (p.stdout or "")[:200] + " | stderr=" + (p.stderr or "")[:300])}
    except subprocess.TimeoutExpired:
        return {"ok": False, "phase": "timeout", "err": "timeout 12s"}
    except Exception as e:
        return {"ok": False, "phase": "runner", "err": str(e)[:300]}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--retry-failed", action="store_true", help="只重跑 results.jsonl 中 api 失败的题")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()

    key = os.environ.get("AGNES_API_KEY", "").strip()
    if not key:
        print("缺少环境变量 AGNES_API_KEY"); sys.exit(1)

    items = load_items()

    if args.retry_failed:
        failed_ids = set()
        if os.path.exists(OUT):
            with open(OUT, encoding="utf-8") as f:
                for line in f:
                    r = json.loads(line)
                    if r.get("phase") == "api":
                        failed_ids.add(r["task_id"])
        items = [it for it in items if it["task_id"] in failed_ids]
        print("重跑 API 失败题:", len(items))
        args.out = os.path.join(HERE, "retry_results.jsonl")

    items = items[args.start:]
    if args.limit:
        items = items[:args.limit]

    results = []
    passed = 0
    for i, it in enumerate(items):
        t0 = time.time()
        try:
            comp = call_model(it["prompt"], key)
        except Exception as e:
            res = {"ok": False, "phase": "api", "err": str(e)[:300]}
        else:
            res = run_one(it, comp)
        ok = res.get("ok", False)
        passed += int(ok)
        rec = {
            "task_id": it["task_id"], "entry_point": it["entry_point"],
            "passed": ok, "phase": res.get("phase"), "err": res.get("err", "")[:200],
            "sec": round(time.time()-t0, 1),
        }
        results.append(rec)
        flag = "PASS" if ok else "FAIL"
        print(f"[{i+1}/{len(items)}] {it['task_id']:20s} {flag:4s} {rec['phase']:8s} {rec['sec']}s", flush=True)
        with open(args.out, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        time.sleep(float(os.environ.get("EVAL_SLEEP", "2")))  # 限速, 防 429

    n = len(results)
    print(f"\n===== 本轮结果: {passed}/{n} passed = {passed/n*100:.1f}% =====")

if __name__ == "__main__":
    main()
