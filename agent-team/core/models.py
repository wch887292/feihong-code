"""数据模型与 SQLite 数据访问层。

对齐开发文档《统一协议与数据模型》：
- leads          线索（含来源渠道、状态、分级、实时录入时间）
- customers      客户（五列格式：公司名称 / 客户姓名 / 联系电话 / 联系时间 / 备注）
- content_assets 内容资产（选题 / 脚本 / 成片 / 文章）
- tasks          任务（任务协议：状态、优先级、重试、人工确认、trace）

所有写操作使用参数化 SQL，时间字段一律记录实时时间戳。
"""
import json
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import config

_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS leads (
    lead_id        TEXT PRIMARY KEY,
    source_channel TEXT NOT NULL,
    company_name   TEXT DEFAULT '',
    contact_name   TEXT DEFAULT '',
    contact_phone  TEXT DEFAULT '',
    status         TEXT DEFAULT 'new',
    grade          TEXT DEFAULT 'C',
    remark         TEXT DEFAULT '',
    created_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
    customer_id   TEXT PRIMARY KEY,
    company_name  TEXT DEFAULT '',
    contact_name  TEXT DEFAULT '',
    contact_phone TEXT DEFAULT '',
    contact_time  TEXT DEFAULT '',
    remark        TEXT DEFAULT '',
    tier          TEXT DEFAULT 'untiered'
);
CREATE TABLE IF NOT EXISTS content_assets (
    content_id     TEXT PRIMARY KEY,
    content_type   TEXT DEFAULT '',
    topic          TEXT DEFAULT '',
    script         TEXT DEFAULT '',
    asset_url      TEXT DEFAULT '',
    publish_status TEXT DEFAULT 'draft',
    metrics        TEXT DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS tasks (
    task_id     TEXT PRIMARY KEY,
    task_type   TEXT NOT NULL,
    module_id   TEXT NOT NULL,
    status      TEXT NOT NULL,
    priority    TEXT DEFAULT 'P1',
    input_json  TEXT DEFAULT '{}',
    output_json TEXT DEFAULT '{}',
    retry_count INTEGER DEFAULT 0,
    need_human  INTEGER DEFAULT 0,
    trace       TEXT DEFAULT '[]',
    created_at  TEXT NOT NULL,
    finished_at TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
"""


def utcnow() -> str:
    """实时时间戳（本地时间，YYYY-MM-DD HH:MM:SS）。"""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _connect(db_path: Optional[str] = None) -> sqlite3.Connection:
    path = db_path or config.DB_PATH
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def init_db(db_path: Optional[str] = None) -> None:
    """初始化全部表结构（幂等）。"""
    conn = _connect(db_path)
    try:
        with _lock:
            conn.executescript(SCHEMA)
            conn.commit()
    finally:
        conn.close()


def _j(d: Any) -> str:
    return json.dumps(d, ensure_ascii=False)


def _uj(s: str) -> Any:
    try:
        return json.loads(s) if s else {}
    except (TypeError, ValueError):
        return {}


# ---------------------------------------------------------------- leads
def insert_lead(lead: Dict[str, str]) -> Dict[str, str]:
    conn = _connect()
    try:
        with _lock:
            conn.execute(
                "INSERT INTO leads (lead_id, source_channel, company_name, contact_name,"
                " contact_phone, status, grade, remark, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?)",
                (lead["lead_id"], lead.get("source_channel", ""), lead.get("company_name", ""),
                 lead.get("contact_name", ""), lead.get("contact_phone", ""),
                 lead.get("status", "new"), lead.get("grade", "C"),
                 lead.get("remark", ""), utcnow()),
            )
            conn.commit()
        return lead
    finally:
        conn.close()


def list_leads(status: Optional[str] = None) -> List[Dict[str, str]]:
    conn = _connect()
    try:
        if status:
            rows = conn.execute("SELECT * FROM leads WHERE status=? ORDER BY created_at", (status,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM leads ORDER BY created_at").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def update_lead(lead_id: str, **fields: str) -> None:
    if not fields:
        return
    conn = _connect()
    try:
        with _lock:
            cols = ", ".join(f"{k}=?" for k in fields)
            conn.execute(f"UPDATE leads SET {cols} WHERE lead_id=?", (*fields.values(), lead_id))
            conn.commit()
    finally:
        conn.close()


# ------------------------------------------------------------- customers
def insert_customer(cust: Dict[str, str]) -> Dict[str, str]:
    """客户五列格式入库：公司名称 / 客户姓名 / 联系电话 / 联系时间 / 备注。"""
    conn = _connect()
    try:
        with _lock:
            conn.execute(
                "INSERT INTO customers (customer_id, company_name, contact_name,"
                " contact_phone, contact_time, remark, tier) VALUES (?,?,?,?,?,?,?)",
                (cust["customer_id"], cust.get("company_name", ""), cust.get("contact_name", ""),
                 cust.get("contact_phone", ""), cust.get("contact_time", "") or utcnow(),
                 cust.get("remark", ""), cust.get("tier", "untiered")),
            )
            conn.commit()
        return cust
    finally:
        conn.close()


def list_customers() -> List[Dict[str, str]]:
    conn = _connect()
    try:
        return [dict(r) for r in conn.execute("SELECT * FROM customers ORDER BY contact_time").fetchall()]
    finally:
        conn.close()


def upsert_customer(company_name: str = "", contact_name: str = "",
                    contact_phone: str = "", remark: str = "",
                    tier: str = "untiered", customer_id: Optional[str] = None,
                    contact_time: Optional[str] = None) -> str:
    """按联系电话查重：存在则更新联系时间/备注/分层，不存在则新增。返回 customer_id。"""
    conn = _connect()
    try:
        with _lock:
            if contact_phone:
                row = conn.execute("SELECT customer_id FROM customers WHERE contact_phone=?",
                                   (contact_phone,)).fetchone()
            else:
                row = None
            if row:
                cid = row["customer_id"]
                now = contact_time or utcnow()
                conn.execute(
                    "UPDATE customers SET company_name=?, contact_name=?, remark=?, tier=?,"
                    " contact_time=? WHERE customer_id=?",
                    (company_name, contact_name, remark, tier, now, cid))
            else:
                cid = customer_id or f"C{int(datetime.now().timestamp())}"
                now = contact_time or utcnow()
                conn.execute(
                    "INSERT INTO customers (customer_id, company_name, contact_name,"
                    " contact_phone, contact_time, remark, tier) VALUES (?,?,?,?,?,?,?)",
                    (cid, company_name, contact_name, contact_phone, now, remark, tier))
            conn.commit()
            return cid
    finally:
        conn.close()


def update_customer(customer_id: str, **fields: str) -> None:
    if not fields:
        return
    conn = _connect()
    try:
        with _lock:
            cols = ", ".join(f"{k}=?" for k in fields)
            conn.execute(f"UPDATE customers SET {cols} WHERE customer_id=?", (*fields.values(), customer_id))
            conn.commit()
    finally:
        conn.close()


# -------------------------------------------------------- content_assets
def insert_asset(asset: Dict[str, Any]) -> Dict[str, Any]:
    conn = _connect()
    try:
        with _lock:
            conn.execute(
                "INSERT INTO content_assets (content_id, content_type, topic, script,"
                " asset_url, publish_status, metrics) VALUES (?,?,?,?,?,?,?)",
                (asset["content_id"], asset.get("content_type", ""), asset.get("topic", ""),
                 asset.get("script", ""), asset.get("asset_url", ""),
                 asset.get("publish_status", "draft"), _j(asset.get("metrics", {}))),
            )
            conn.commit()
        return asset
    finally:
        conn.close()


def list_assets(content_type: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = _connect()
    try:
        if content_type:
            rows = conn.execute("SELECT * FROM content_assets WHERE content_type=?", (content_type,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM content_assets").fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["metrics"] = _uj(d.get("metrics", "{}"))
            out.append(d)
        return out
    finally:
        conn.close()


# ----------------------------------------------------------------- tasks
def insert_task(task: Dict[str, Any]) -> Dict[str, Any]:
    conn = _connect()
    try:
        with _lock:
            conn.execute(
                "INSERT INTO tasks (task_id, task_type, module_id, status, priority,"
                " input_json, output_json, retry_count, need_human, trace, created_at, finished_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (task["task_id"], task["task_type"], task["module_id"], task["status"],
                 task.get("priority", "P1"), _j(task.get("input_json", {})),
                 _j(task.get("output_json", {})), task.get("retry_count", 0),
                 1 if task.get("need_human") else 0, _j(task.get("trace", [])),
                 task.get("created_at", utcnow()), task.get("finished_at", "")),
            )
            conn.commit()
        return task
    finally:
        conn.close()


def get_task(task_id: str) -> Optional[Dict[str, Any]]:
    conn = _connect()
    try:
        row = conn.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["input_json"] = _uj(d.get("input_json", "{}"))
        d["output_json"] = _uj(d.get("output_json", "{}"))
        d["trace"] = _uj(d.get("trace", "[]"))
        d["need_human"] = bool(d.get("need_human"))
        return d
    finally:
        conn.close()


def update_task(task_id: str, **fields: Any) -> None:
    if not fields:
        return
    conn = _connect()
    try:
        with _lock:
            cols = ", ".join(f"{k}=?" for k in fields)
            vals = []
            for v in fields.values():
                if isinstance(v, (dict, list)):
                    vals.append(_j(v))
                else:
                    vals.append(v)
            conn.execute(f"UPDATE tasks SET {cols} WHERE task_id=?", (*vals, task_id))
            conn.commit()
    finally:
        conn.close()


def list_tasks(status: Optional[str] = None, module_id: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = _connect()
    try:
        sql, args = "SELECT * FROM tasks WHERE 1=1", []
        if status:
            sql += " AND status=?"
            args.append(status)
        if module_id:
            sql += " AND module_id=?"
            args.append(module_id)
        sql += " ORDER BY created_at"
        rows = conn.execute(sql, args).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["input_json"] = _uj(d.get("input_json", "{}"))
            d["output_json"] = _uj(d.get("output_json", "{}"))
            d["trace"] = _uj(d.get("trace", "[]"))
            d["need_human"] = bool(d.get("need_human"))
            out.append(d)
        return out
    finally:
        conn.close()


def count_tasks() -> Dict[str, int]:
    conn = _connect()
    try:
        rows = conn.execute("SELECT status, COUNT(*) AS c FROM tasks GROUP BY status").fetchall()
        return {r["status"]: r["c"] for r in rows}
    finally:
        conn.close()
