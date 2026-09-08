#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""飞虹智 · AI 员工军团系统 — 命令行入口。

命令：
    init-db          初始化数据库
    list-agents      查看 17 个 AI 员工清单
    submit           提交单个任务（--module 编号 --type 类型 --input JSON）
    run-once         执行一轮 pending 任务
    run-loop         持续执行（--times N）
    approve          人工确认任务（--task-id --no 表示驳回）
    stats            任务统计
    demo-pipeline    M1 销售闭环演示（01→02→04→09）
    export-skills    导出 17 个 Skill 包到 skills/
    install-skills   安装 Skill 包到指定 Skill 根目录
"""
import argparse
import json
import logging
import sys
from pathlib import Path

from config import BASE_DIR

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def _get_llm():
    from llm import get_llm
    return get_llm()


def _get_scheduler():
    from core import models
    from core.scheduler import Scheduler
    from agents.registry import instantiate_all
    llm = _get_llm()
    agents = instantiate_all(llm)
    return Scheduler(agents)


def cmd_init_db(args):
    from core import models
    import config as cfg
    models.init_db()
    print("数据库已初始化:", cfg.DB_PATH)


def cmd_list_agents(args):
    from agents.registry import list_meta
    metas = list_meta()
    print(f"{'编号':<4}{'模块':<22}{'层级':<5}{'优先级':<5}说明")
    print("-" * 90)
    for m in metas:
        print(f"{m['module_id']:<4}{m['name']:<22}{m['layer']:<5}{m['priority']:<5}{m['description']}")
    print(f"\n共 {len(metas)} 个 AI 员工")


def cmd_submit(args):
    sched = _get_scheduler()
    data = json.loads(args.input) if args.input else {}
    task = sched.submit(module_id=args.module, task_type=args.type,
                        input_data=data, priority=args.priority,
                        need_human=None if args.no_human_gate is False else None)
    print(json.dumps({"ok": True, "task_id": task.task_id, "status": task.status.value,
                      "need_human": task.need_human}, ensure_ascii=False))


def cmd_run_once(args):
    sched = _get_scheduler()
    results = sched.run_once(limit=args.limit)
    for r in results:
        print(json.dumps(r, ensure_ascii=False))
    print(f"\n共执行 {len(results)} 个任务")


def cmd_run_loop(args):
    sched = _get_scheduler()
    for i in range(args.times):
        n = len(sched.run_once(limit=args.limit))
        print(f"第 {i + 1} 轮执行 {n} 个任务")
        if n == 0:
            break


def cmd_approve(args):
    sched = _get_scheduler()
    result = sched.approve(args.task_id, approved=not args.no)
    print(json.dumps(result, ensure_ascii=False))


def cmd_stats(args):
    from core import models
    sched = _get_scheduler()
    st = sched.stats()
    print("任务状态分布:", json.dumps(st["task_counts"], ensure_ascii=False))
    print("各模块任务数:", json.dumps(st["by_module"], ensure_ascii=False))
    print(f"在线模块数: {st['agents_online']}，失败重试上限: {st['max_retry']}")
    print(f"线索数: {len(models.list_leads())}，客户数: {len(models.list_customers())}")


def cmd_demo_pipeline(args):
    """M1 销售闭环演示：01 线索雷达 → 02 跟进销冠(人工闸) → 04 成交分析 → 09 私域分层。"""
    sched = _get_scheduler()
    steps = [
        {"module_id": "01", "task_type": "lead_scan",
         "input": {"channels": ["评论区", "小红书", "公众号"], "keywords": "AI 获客"}, "priority": "P0"},
        {"module_id": "02", "task_type": "follow_up",
         "input": {"customer": {"company_name": "示例制造公司", "contact_name": "王总"},
                   "strategy": "标准 3 触达"}, "priority": "P0"},
        {"module_id": "04", "task_type": "chat_analysis",
         "input": {"transcript": "客户：价格有点高；销售：可以谈；客户：我再想想。"}, "priority": "P0"},
        {"module_id": "09", "task_type": "tiering",
         "input": {"customers": [
             {"customer_id": "C1", "company_name": "示例制造公司", "contact_name": "王总", "contact_phone": "13800000001"},
             {"customer_id": "C2", "company_name": "示例贸易公司", "contact_name": "李总", "contact_phone": "13800000002"},
         ]}, "priority": "P0"},
    ]
    ids = sched.create_pipeline(steps)
    print("已提交销售闭环链路:", ids)
    sched.run_once(limit=10)
    # 02 任务进入人工确认，演示人工闸
    for tid in ids:
        t = _task(tid)
        if t and t["status"] == "awaiting_human":
            print(f"任务 {tid} 等待人工确认 -> 自动批准")
            sched.approve(tid, approved=True)
    sched.run_once(limit=10)
    _print_pipeline_summary(ids)


def _task(task_id):
    from core import models
    return models.get_task(task_id)


def _print_pipeline_summary(ids):
    from core import models
    print("\n===== 销售闭环执行结果 =====")
    for tid in ids:
        t = models.get_task(tid)
        out = t.get("output_json", {})
        brief = ""
        if "leads" in out:
            brief = f"线索 {out['total']} 条"
        elif "follow_up" in out:
            brief = f"跟进对象 {out['follow_up'].get('target', '')}"
        elif "diagnosis" in out:
            brief = "卡点: " + "、".join(out["diagnosis"].get("blockers", []))
        elif "tiers" in out:
            brief = f"分层 {len(out['tiers'])} 个客户"
        print(f"  {t['module_id']} {t['task_type']:<16} -> {t['status']:<16} {brief}")
    print(f"\n线索库: {len(models.list_leads())} 条；客户库: {len(models.list_customers())} 条")


def cmd_export_skills(args):
    from skill_packager import export_skills
    outdir = Path(args.outdir)
    exported = export_skills(outdir)
    print(f"已导出 {len(exported)} 个 Skill 包到 {outdir.resolve()}/")
    for e in exported:
        print(f"  [{e['module_id']}] {e['name']} -> {e['path']}")


def cmd_install_skills(args):
    from skill_packager import install_skills
    source = Path(args.source)
    target = Path(args.target)
    installed = install_skills(source, target)
    print(f"已安装 {len(installed)} 个 Skill 到 {target.resolve()}/")
    for i in installed:
        print(f"  {i['name']} -> {i['path']}")


def build_parser():
    p = argparse.ArgumentParser(prog="feihongzhi", description="飞虹智 · AI 员工军团系统")
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("init-db", help="初始化数据库")
    sub.add_parser("list-agents", help="查看 AI 员工清单")

    sp = sub.add_parser("submit", help="提交任务")
    sp.add_argument("--module", required=True, help="模块编号 01-17")
    sp.add_argument("--type", default="manual", help="任务类型")
    sp.add_argument("--input", default="", help="输入 JSON")
    sp.add_argument("--priority", default="P1", choices=["P0", "P1", "P2", "P3"])
    sp.add_argument("--no-human-gate", action="store_true", help="关闭人工确认闸（测试用）")

    rp = sub.add_parser("run-once", help="执行一轮 pending 任务")
    rp.add_argument("--limit", type=int, default=10)

    lp = sub.add_parser("run-loop", help="持续执行")
    lp.add_argument("--times", type=int, default=3)
    lp.add_argument("--limit", type=int, default=10)

    ap = sub.add_parser("approve", help="人工确认任务")
    ap.add_argument("--task-id", required=True)
    ap.add_argument("--no", action="store_true", help="驳回")

    sub.add_parser("stats", help="统计")
    sub.add_parser("demo-pipeline", help="M1 销售闭环演示")

    ep = sub.add_parser("export-skills", help="导出 Skill 包")
    ep.add_argument("--outdir", default=str(BASE_DIR / "skills"))

    ip = sub.add_parser("install-skills", help="安装 Skill 包")
    ip.add_argument("--source", default=str(BASE_DIR / "skills"))
    ip.add_argument("--target", default=str(Path.home() / ".doubao/agent_mode/workspace/.user_skills"))
    return p


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    dispatch = {
        "init-db": cmd_init_db,
        "list-agents": cmd_list_agents,
        "submit": cmd_submit,
        "run-once": cmd_run_once,
        "run-loop": cmd_run_loop,
        "approve": cmd_approve,
        "stats": cmd_stats,
        "demo-pipeline": cmd_demo_pipeline,
        "export-skills": cmd_export_skills,
        "install-skills": cmd_install_skills,
    }
    try:
        dispatch[args.command](args)
    except Exception as e:  # noqa: BLE001
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
