"""单元测试：任务状态机 / 调度官 / 模块契约 / Skill 打包。

运行：python3 -m unittest discover -s tests -v
（测试使用独立临时数据库，不影响 feihongzhi.db）
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config

_TMP_DB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
config.DB_PATH = _TMP_DB.name

from core import models  # noqa: E402
from core.scheduler import Scheduler  # noqa: E402
from core.task import Task, TaskStatus  # noqa: E402
from llm.mock_llm import MockLLM  # noqa: E402
from agents.registry import instantiate_all, list_meta  # noqa: E402


class TestTaskProtocol(unittest.TestCase):
    def test_transition_ok(self):
        t = Task(task_type="lead_scan", module_id="01")
        t.transition(TaskStatus.RUNNING)
        t.transition(TaskStatus.SUCCESS)
        self.assertEqual(t.status, TaskStatus.SUCCESS)

    def test_transition_invalid(self):
        from core.task import TaskStatusError
        t = Task(task_type="lead_scan", module_id="01")
        t.transition(TaskStatus.RUNNING)
        t.transition(TaskStatus.SUCCESS)
        with self.assertRaises(TaskStatusError):
            t.transition(TaskStatus.RUNNING)  # success 不能再回 running

    def test_priority_validation(self):
        with self.assertRaises(Exception):
            Task(task_type="x", module_id="01", priority="P9")


class TestScheduler(unittest.TestCase):
    def setUp(self):
        models.init_db(config.DB_PATH)
        self.sched = Scheduler(instantiate_all(MockLLM()))

    def test_submit_and_run(self):
        t = self.sched.submit("01", "lead_scan", {"channels": ["评论区"], "keywords": "测试"})
        results = self.sched.run_once()
        self.assertEqual(len(results), 1)
        row = models.get_task(t.task_id)
        self.assertEqual(row["status"], "success")
        self.assertIn("leads", row["output_json"])

    def test_missing_input_rejected(self):
        with self.assertRaises(Exception):
            self.sched.submit("01", "lead_scan", {})  # 缺 channels

    def test_unknown_module(self):
        with self.assertRaises(ValueError):
            self.sched.submit("99", "x", {})

    def test_human_gate(self):
        t = self.sched.submit("02", "follow_up",
                              {"customer": {"company_name": "A", "contact_name": "B"}, "strategy": "s"})
        self.assertTrue(t.need_human)
        self.sched.run_once()
        row = models.get_task(t.task_id)
        self.assertEqual(row["status"], "awaiting_human")
        self.sched.approve(t.task_id)
        self.assertEqual(models.get_task(t.task_id)["status"], "success")

    def test_retry_then_blocked(self):
        from core.agent import BaseAgent

        class FailAgent(BaseAgent):
            module_id = "98"
            run_logic = staticmethod(lambda data, llm: (_ for _ in ()).throw(RuntimeError("boom")))

        self.sched.agents["98"] = FailAgent(llm=MockLLM())
        t = self.sched.submit("98", "fail", {})
        for _ in range(config.MAX_RETRY + 1):
            self.sched.run_once()
        self.assertEqual(models.get_task(t.task_id)["status"], "blocked")


class TestAgents(unittest.TestCase):
    def test_all_17_registered(self):
        metas = list_meta()
        self.assertEqual(len(metas), 17)
        ids = [m["module_id"] for m in metas]
        self.assertEqual(len(set(ids)), 17)

    def test_each_agent_runs(self):
        agents = instantiate_all(MockLLM())
        sample_inputs = {
            "01": {"channels": ["评论区"], "keywords": "k"},
            "02": {"customer": {"company_name": "A", "contact_name": "B"}, "strategy": "s"},
            "03": {"target_accounts": ["A"]},
            "04": {"transcript": "贵"},
            "05": {"competitor_accounts": ["A"]},
            "06": {"persona": "工厂老板", "hot_topics": ["AI"]},
            "07": {"market": "东南亚", "product": "P"},
            "08": {"category": "企业服务", "audience": "老板"},
            "09": {"customers": [{"customer_id": "C1", "company_name": "A", "contact_name": "B"}]},
            "10": {"region": "泉州", "business_type": "企业服务"},
            "11": {"tasks": []},
            "12": {"topic": "T", "selling_points": ["a"], "audience": "老板"},
            "13": {"account": "A"},
            "14": {"clips": ["a.mp4"], "script": "s", "template": "t"},
            "15": {"topic": "T", "schedule": "明日"},
            "16": {"industry": "企业服务", "scope": "国内"},
            "17": {"company": "A", "materials": "BP"},
        }
        for module_id, inp in sample_inputs.items():
            with self.subTest(module=module_id):
                agent = agents[module_id]
                task = Task(task_type="test", module_id=module_id, input_json=inp)
                out = agent.execute(task)
                self.assertIsInstance(out, dict)


class TestSkillPackager(unittest.TestCase):
    def test_export_generates_runpy(self):
        from skill_packager import export_skills
        with tempfile.TemporaryDirectory() as tmp:
            exported = export_skills(Path(tmp))
            self.assertEqual(len(exported), 17)
            for e in exported:
                pkg = Path(e["path"])
                self.assertTrue((pkg / "SKILL.md").exists())
                run_py = (pkg / "run.py").read_text(encoding="utf-8")
                self.assertIn("run_logic", run_py)
                self.assertIn("def main():", run_py)

    def test_exported_runpy_executes(self):
        import subprocess
        from skill_packager import export_skills
        with tempfile.TemporaryDirectory() as tmp:
            exported = export_skills(Path(tmp))
            pkg = Path(exported[0]["path"])  # 01
            r = subprocess.run(
                [sys.executable, "run.py", "--input", '{"channels": ["评论区"], "keywords": "k"}'],
                cwd=str(pkg), capture_output=True, text=True, timeout=30)
            self.assertEqual(r.returncode, 0, r.stderr)
            out = json.loads(r.stdout)
            self.assertTrue(out["ok"])


if __name__ == "__main__":
    unittest.main()
