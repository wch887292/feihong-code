#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
飞虹 Code（fhcode）MCP Server v1.2（安全加固 + 工具扩面 + 端点修正）
================================================================
v1.2 变更：
  - 【关键修复】DEFAULT_BASE_URL 修正为 fhcode 真实端口 18080
    （此前误连 8080 为 maxkb 容器，fhcode 工具实际未真正调用到底层）
  - 工具扩面：3 -> 10（新增语义化编程工具 + 任务管理工具）
  - 保留 v1.1 全部安全机制（危险拦截 / 路径穿越 / 审计 / goal 限长）

把底层 fhcode 编程引擎（飞虹 Code，REST API :18080）封装为 MCP 工具，
以 http-streamable 方式调用。

架构（单向，fhcode 为底层）：
    Agent --(MCP streamable HTTP)--> 本服务(127.0.0.1:8083/mcp)
        --(HMAC 签名 REST)--> fhcode(127.0.0.1:18080) 沙箱执行
"""
import os
import re
import time
import hmac
import json
import logging
import hashlib
import secrets as _secrets
from typing import Literal, Optional

import requests
from mcp.server import MCPServer

# ---------------------------------------------------------------------------
# 配置与凭据
# ---------------------------------------------------------------------------
# fhcode 真实 REST 端口（2026-09-24 实测 18080，8080 为 maxkb 容器）
DEFAULT_BASE_URL = "http://127.0.0.1:18080"
# 按优先级尝试多个 .env 路径（Linux 部署路径 + Windows 开发路径）
ENV_PATHS = [
    "/www/dk_project/livekit/agent/.env",   # Linux 生产：与 agent 共享
    os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"),  # 同目录 .env
    r"H:\Muse Code复刻\.env",                 # Windows 开发机
]
AUDIT_LOG_PATH = os.environ.get("FH_AUDIT_LOG", "/var/log/fhcode-mcp-audit.log")
MAX_GOAL_LENGTH = 5000


def _load_dotenv(path):
    data = {}
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                data[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return data


_ENV = {}
for _p in ENV_PATHS:
    _ENV = _load_dotenv(_p)
    if _ENV:
        break
BASE_URL = (os.getenv("FH_BASE_URL") or _ENV.get("FH_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
TOKEN = os.getenv("FH_WEB_TOKEN") or _ENV.get("FH_WEB_TOKEN", "")
SIGN_SECRET = os.getenv("FH_SIGN_SECRET") or _ENV.get("FH_SIGN_SECRET", "")
HOST = os.getenv("FH_MCP_HOST", "127.0.0.1")
PORT = int(os.getenv("FH_MCP_PORT", "8083"))

mcp = MCPServer("fhcode-engine", version="1.2.0")

# ---------------------------------------------------------------------------
# 审计日志
# ---------------------------------------------------------------------------
_audit_logger = logging.getLogger("fhcode_mcp_audit")
_audit_logger.setLevel(logging.INFO)
if not _audit_logger.handlers:
    try:
        _handler = logging.FileHandler(AUDIT_LOG_PATH)
        _handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
        _audit_logger.addHandler(_handler)
    except Exception:
        _handler = logging.StreamHandler()
        _handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
        _audit_logger.addHandler(_handler)


def _audit(event: str, **fields) -> None:
    entry = {"event": event, "ts": int(time.time())}
    entry.update(fields)
    _audit_logger.info(json.dumps(entry, ensure_ascii=False))


# ---------------------------------------------------------------------------
# 危险指令拦截（多层防御）
# ---------------------------------------------------------------------------
DANGEROUS_PATTERNS = [
    (r"rm\s+-rf?\s+/", "禁止根目录递归删除"),
    (r"rm\s+-rf?\s+~", "禁止用户主目录递归删除"),
    (r"rm\s+-rf?\s+\*", "禁止通配符递归删除"),
    (r"mkfs", "禁止格式化磁盘"),
    (r"dd\s+if=/dev/(zero|random|urandom)", "禁止磁盘覆写"),
    (r":\(\)\s*\{\s*:\|:&\s*\};:\s*", "禁止 fork bomb"),
    (r"curl[^|]*\|\s*(bash|sh|zsh)", "禁止远程脚本管道执行"),
    (r"wget[^|]*\|\s*(bash|sh|zsh)", "禁止远程脚本管道执行"),
    (r"\bsudo\b", "禁止 sudo 提权（fhcode 沙箱内无需 sudo）"),
    (r"chmod\s+777", "禁止 777 权限"),
    (r">\s*/dev/sd[a-z]", "禁止直接写块设备"),
    (r"shutdown\s+(-h|-r|now)", "禁止系统关机/重启"),
    (r"reboot", "禁止系统重启"),
    (r"cat\s+.*\.ssh/", "禁止读取 SSH 密钥"),
    (r"cat\s+.*\.env", "禁止读取环境变量文件（可能含密钥）"),
    (r"/etc/shadow", "禁止读取 shadow 文件"),
    (r"/etc/passwd", "禁止读取 passwd 文件"),
]


def _check_dangerous(goal: str) -> Optional[str]:
    goal_lower = goal.lower()
    for pattern, reason in DANGEROUS_PATTERNS:
        if re.search(pattern, goal_lower):
            return reason
    return None


def _validate_workspace_dir(path: str) -> str:
    if not path or not path.strip():
        return ""
    path = os.path.realpath(path.strip())
    allowed_prefixes = ["/www/dk_project", "/tmp", "/home"]
    if not any(path.startswith(prefix) for prefix in allowed_prefixes):
        raise ValueError(f"workspace_dir 不在允许的目录范围内: {path}")
    return path


# ---------------------------------------------------------------------------
# fhcode REST 客户端
# ---------------------------------------------------------------------------
def _base_headers():
    return {"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}


def _signed_headers(body_raw):
    ts = str(int(time.time() * 1000))
    nonce = _secrets.token_hex(12)
    secret = SIGN_SECRET or TOKEN
    msg = (ts + "|" + nonce + "|" + body_raw).encode("utf-8")
    sig = hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()
    h = _base_headers()
    h.update({"x-fh-ts": ts, "x-fh-nonce": nonce, "x-fh-sig": sig})
    return h


def _resolve_default_model():
    try:
        r = requests.get(BASE_URL + "/api/models", headers=_base_headers(), timeout=10)
        if r.status_code == 200:
            data = r.json()
            mid = data.get("defaultId") or ""
            if not mid:
                for m in (data.get("models") or []):
                    if m.get("default"):
                        mid = m.get("id") or ""
                        break
            return mid
    except Exception:
        pass
    return ""


def _submit_and_wait(goal, agent_type="write-code", model_id="",
                     workspace_dir="", timeout=300):
    if not TOKEN:
        raise RuntimeError("未配置 FH_WEB_TOKEN（无法调用 fhcode）")
    try:
        hc = requests.get(BASE_URL + "/api/health", headers=_base_headers(), timeout=5)
        if hc.status_code != 200:
            raise RuntimeError("fhcode 健康检查失败 HTTP " + str(hc.status_code))
    except Exception as e:
        raise RuntimeError("无法连接 fhcode 服务（%s）：%s" % (BASE_URL, e))

    model_id = (model_id or "").strip()
    if not model_id:
        model_id = _resolve_default_model()

    payload = {"goal": goal}
    if agent_type:
        payload["agentType"] = agent_type
    if model_id:
        payload["modelId"] = model_id
    if workspace_dir:
        payload["workspaceDir"] = workspace_dir
    body_raw = json.dumps(payload, ensure_ascii=False)

    resp = requests.post(BASE_URL + "/api/tasks", headers=_signed_headers(body_raw),
                         data=body_raw.encode("utf-8"), timeout=20)
    if resp.status_code in (401, 403):
        raise RuntimeError("fhcode 鉴权失败 HTTP %s：%s" % (resp.status_code, resp.text[:200]))
    if resp.status_code != 201:
        raise RuntimeError("fhcode 任务提交失败 HTTP %s：%s" % (resp.status_code, resp.text[:200]))
    task = resp.json().get("task") or {}
    task_id = task.get("id")
    if not task_id:
        raise RuntimeError("fhcode 未返回任务 ID：" + resp.text[:200])

    deadline = time.time() + int(timeout)
    last_status = task.get("status")
    while time.time() < deadline:
        g = requests.get(BASE_URL + "/api/tasks/" + task_id, headers=_base_headers(), timeout=10)
        if g.status_code != 200:
            raise RuntimeError("查询任务失败 HTTP %s：%s" % (g.status_code, g.text[:200]))
        task = g.json().get("task") or {}
        last_status = task.get("status")
        if last_status == "done":
            result = task.get("result") or {}
            answer = result.get("finalAnswer") or ""
            if not answer:
                for mm in reversed(task.get("conversation") or []):
                    if mm.get("role") == "assistant" and mm.get("content"):
                        answer = mm["content"]
                        break
            if not answer:
                answer = "fhcode 任务已完成（%s），但未返回文本结果。" % task_id
            return answer
        if last_status == "failed":
            raise RuntimeError("fhcode 任务执行失败：" + str(task.get("error") or "未知错误"))
        time.sleep(2)
    raise RuntimeError("fhcode 任务 %s 等待超时（%ss），最后状态 %s；任务仍在后台运行"
                       % (task_id, timeout, last_status))


# ---------------------------------------------------------------------------
# 统一安全执行内核（供所有编程类工具复用）
# ---------------------------------------------------------------------------
def _run_engine(goal, agent_type, workspace_dir="", model_id="", timeout=300):
    """对 goal 做安全校验并调用 fhcode 执行。所有编程类工具共用。"""
    if not goal or not str(goal).strip():
        raise ValueError("缺少 goal（任务描述）")
    goal = str(goal).strip()

    if len(goal) > MAX_GOAL_LENGTH:
        _audit("fhcode_run_rejected", reason="goal_too_long", length=len(goal), agent_type=agent_type)
        raise ValueError(f"goal 过长（{len(goal)} 字符），最大允许 {MAX_GOAL_LENGTH} 字符")

    danger = _check_dangerous(goal)
    if danger:
        _audit("fhcode_run_blocked", reason=danger, goal_preview=goal[:200], agent_type=agent_type)
        raise PermissionError(f"任务被安全策略拦截：{danger}。如需执行类似操作，请通过人工确认通道。")

    try:
        safe_ws = _validate_workspace_dir(workspace_dir or "")
    except ValueError as e:
        _audit("fhcode_run_rejected", reason=str(e), workspace_dir=workspace_dir, agent_type=agent_type)
        raise

    start_ts = time.time()
    _audit("fhcode_run_start", goal_preview=goal[:300], agent_type=agent_type,
           workspace_dir=safe_ws, timeout=timeout)
    try:
        result = _submit_and_wait(
            goal=goal, agent_type=agent_type or "write-code",
            model_id=model_id or "", workspace_dir=safe_ws,
            timeout=int(timeout) if timeout else 300,
        )
        _audit("fhcode_run_done", elapsed_sec=round(time.time() - start_ts, 2),
               result_length=len(result), agent_type=agent_type, status="success")
        return result
    except Exception as e:
        _audit("fhcode_run_failed", elapsed_sec=round(time.time() - start_ts, 2),
               error=str(e)[:300], agent_type=agent_type, status="failed")
        raise


# ---------------------------------------------------------------------------
# MCP 工具（v1.2：10 个）
# ---------------------------------------------------------------------------
@mcp.tool()
def fhcode_health() -> str:
    """检查底层 fhcode（飞虹 Code）编程引擎服务是否在线、返回版本信息。无需参数。"""
    try:
        r = requests.get(BASE_URL + "/api/health", headers=_base_headers(), timeout=8)
        if r.status_code == 200:
            d = r.json()
            return "fhcode 在线：%s v%s（ok=%s）" % (
                d.get("product", "?"), d.get("version", "?"), d.get("ok"))
        return "fhcode 健康检查异常 HTTP %s" % r.status_code
    except Exception as e:
        return "fhcode 不可用：%s" % e


@mcp.tool()
def fhcode_list_models() -> str:
    """列出 fhcode 当前配置的可用大模型，以及默认模型。用于在编程任务前确认模型。"""
    try:
        r = requests.get(BASE_URL + "/api/models", headers=_base_headers(), timeout=10)
        if r.status_code != 200:
            return "获取模型失败 HTTP %s" % r.status_code
        d = r.json()
        default_id = d.get("defaultId") or ""
        lines = []
        for m in (d.get("models") or []):
            mark = "（默认）" if m.get("default") or m.get("id") == default_id else ""
            lines.append("- %s [%s]%s" % (m.get("name"), m.get("id"), mark))
        return "可用模型：\n" + "\n".join(lines)
    except Exception as e:
        return "获取模型失败：%s" % e


@mcp.tool()
def fhcode_run(
    goal: str,
    agent_type: Literal["write-code", "fix-code", "exec-command", "code-review", "general"] = "write-code",
    workspace_dir: Optional[str] = "",
    model_id: Optional[str] = "",
    timeout: int = 300,
) -> str:
    """调用底层飞虹 Code（fhcode）在真实沙箱中执行工程级编程任务：编写/修改/重构多文件代码、
    运行测试与构建、执行命令、排查并修复 bug、做代码审查。当用户需要实际写代码、改工程文件或
    在真实项目里完成开发/排障时使用。

    参数：
      goal: 自然语言任务描述（必填，建议含文件路径、需求、验收标准）。
      agent_type: write-code=写/改代码（默认）；fix-code=修 bug；exec-command=执行命令；
                  code-review=代码审查；general=普通问答。
      workspace_dir: 任务执行的工作目录（绝对路径）；留空用 fhcode 默认目录。
      model_id: 指定模型 id；留空自动使用默认模型。
      timeout: 最长等待秒数，默认 300。
    返回：fhcode 执行完成后的最终结果文本。

    安全：危险指令拦截、路径校验、审计日志。也可用更语义化的快捷工具
    fhcode_write_code / fhcode_fix_bug / fhcode_exec_command / fhcode_code_review。
    """
    return _run_engine(goal, agent_type or "write-code", workspace_dir, model_id, timeout)


@mcp.tool()
def fhcode_write_code(
    goal: str,
    workspace_dir: Optional[str] = "",
    model_id: Optional[str] = "",
    timeout: int = 300,
) -> str:
    """【写代码】调用 fhcode 编写/修改/重构工程代码（多文件）。goal 需含文件路径、需求与验收标准。"""
    return _run_engine(goal, "write-code", workspace_dir, model_id, timeout)


@mcp.tool()
def fhcode_fix_bug(
    goal: str,
    workspace_dir: Optional[str] = "",
    model_id: Optional[str] = "",
    timeout: int = 300,
) -> str:
    """【修 bug】调用 fhcode 排查并修复工程代码中的 bug。goal 需说明现象、报错、期望行为。"""
    return _run_engine(goal, "fix-code", workspace_dir, model_id, timeout)


@mcp.tool()
def fhcode_exec_command(
    goal: str,
    workspace_dir: Optional[str] = "",
    model_id: Optional[str] = "",
    timeout: int = 300,
) -> str:
    """【执行命令】调用 fhcode 在沙箱中执行命令/脚本/构建测试。goal 描述要执行的命令与目的。
    危险命令（rm -rf /、mkfs、dd、curl|bash、sudo、shutdown 等）会被安全拦截。"""
    return _run_engine(goal, "exec-command", workspace_dir, model_id, timeout)


@mcp.tool()
def fhcode_code_review(
    goal: str,
    workspace_dir: Optional[str] = "",
    model_id: Optional[str] = "",
    timeout: int = 300,
) -> str:
    """【代码审查】调用 fhcode 对指定代码/项目做代码审查。goal 描述审查范围与关注点（安全/性能/可读性）。"""
    return _run_engine(goal, "code-review", workspace_dir, model_id, timeout)


@mcp.tool()
def fhcode_ask(
    goal: str,
    model_id: Optional[str] = "",
    timeout: int = 300,
) -> str:
    """【普通问答】调用 fhcode 做不写代码的问答/分析/方案设计。goal 为问题本身。"""
    return _run_engine(goal, "general", "", model_id, timeout)


@mcp.tool()
def fhcode_list_tasks() -> str:
    """列出 fhcode 当前所有任务（含进行中/已完成），返回任务 id、状态与摘要。用于查看后台任务。"""
    try:
        r = requests.get(BASE_URL + "/api/tasks", headers=_base_headers(), timeout=10)
        if r.status_code != 200:
            return "查询任务列表失败 HTTP %s" % r.status_code
        tasks = r.json().get("tasks") or []
        if not tasks:
            return "当前无 fhcode 任务。"
        lines = []
        for t in tasks:
            lines.append("- %s [%s] %s" % (t.get("id"), t.get("status"), (t.get("goal") or "")[:80]))
        return "fhcode 任务列表（%d 条）：\n" % len(tasks) + "\n".join(lines)
    except Exception as e:
        return "查询任务列表失败：%s" % e


@mcp.tool()
def fhcode_task_status(task_id: str) -> str:
    """查询单个 fhcode 任务的状态与结果。task_id 为任务 id（可从 fhcode_list_tasks 获取）。"""
    if not task_id or not str(task_id).strip():
        raise ValueError("缺少 task_id")
    task_id = str(task_id).strip()
    try:
        r = requests.get(BASE_URL + "/api/tasks/" + task_id, headers=_base_headers(), timeout=10)
        if r.status_code != 200:
            return "查询任务失败 HTTP %s" % r.status_code
        task = r.json().get("task") or {}
        status = task.get("status", "?")
        goal = (task.get("goal") or "")[:120]
        result = task.get("result") or {}
        answer = result.get("finalAnswer") or ""
        if not answer:
            for mm in reversed(task.get("conversation") or []):
                if mm.get("role") == "assistant" and mm.get("content"):
                    answer = mm["content"]
                    break
        out = "任务 %s\n状态：%s\n目标：%s\n" % (task_id, status, goal)
        if answer:
            out += "结果：%s" % str(answer)[:500]
        return out
    except Exception as e:
        return "查询任务失败：%s" % e


# ---------------------------------------------------------------------------
# 启动 streamable HTTP
# ---------------------------------------------------------------------------
def main():
    import uvicorn
    app = mcp.streamable_http_app(host=HOST, stateless_http=True)
    print("fhcode MCP server v1.2: http://%s:%s/mcp (streamable HTTP, stateless)" % (HOST, PORT),
          flush=True)
    print("base_url=%s token=%s sign_secret=%s audit_log=%s" % (
        BASE_URL, "已配置" if TOKEN else "缺失", "已配置" if SIGN_SECRET else "缺失", AUDIT_LOG_PATH),
        flush=True)
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    main()
