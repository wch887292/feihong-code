#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""31 名数字员工 · 健全性 + 系统字段铁律验证脚本。

晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人：吴赐虹

验证目标：
  1) 兜底路径：所有 run_logic 在 llm=None 时静默回落 fallback，绝不崩溃。
  2) 系统字段铁律：即便 LLM 故意返回错误的 handoff_to / 编造 planned_at/date，
     代码也必须强制覆盖为 SPEC 固化值，链路不断、时间戳不污染。

用法：python verify_employees.py
"""
import io
import json
import sys
import os

TEAM = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TEAM)

from agents.registry import get_agent_classes  # noqa: E402


# 个别员工必填字段在真实场景里是「列表」，给真实形态输入，才能反映实际运行
REALISTIC = {
    "09": {"customers": [
        {"customer_id": "C1", "company_name": "客户A", "contact_name": "李总", "contact_phone": "13800000001"},
        {"customer_id": "C2", "company_name": "客户B", "contact_name": "张总", "contact_phone": "13800000002"},
    ]},
    "11": {"tasks": [
        {"module_id": "01", "task_type": "lead_scan", "priority": "P0"},
        {"module_id": "02", "task_type": "follow_up", "priority": "P1"},
    ]},
}


def sample_input(cls):
    """为单个员工构造最小合法输入（每个必填字段给占位值）。"""
    data = {k: f"（测试·{k}）" for k in cls.input_schema}
    data.update(REALISTIC.get(cls.module_id, {}))
    data.setdefault("knowledge_context", [])
    return data


def pass_fallback():
    """Pass A：llm=None，验证全部 31 名员工兜底路径不崩溃，交接对象齐全。"""
    print("═══ Pass A：兜底路径（llm=None）═══")
    classes = get_agent_classes()
    fail = 0
    for cls in classes:
        mid = cls.module_id
        try:
            out = cls.run_logic(sample_input(cls), llm=None)
        except Exception as e:  # noqa: BLE001
            print(f"  ❌ {mid} {cls.name} 抛出异常：{type(e).__name__}: {e}")
            fail += 1
            continue
        if not isinstance(out, dict):
            print(f"  ❌ {mid} {cls.name} 输出非 dict")
            fail += 1
            continue
        # 声明了 handoff_to 输出键的，必须产出非空交接对象
        if "handoff_to" in cls.output_keys:
            h = out.get("handoff_to")
            if not isinstance(h, str) or not h.strip():
                print(f"  ❌ {mid} {cls.name} handoff_to 缺失/为空")
                fail += 1
                continue
        print(f"  ✅ {mid} {cls.name:<16} handoff={out.get('handoff_to','—')}")
    print(f"  → Pass A：{len(classes)-fail}/{len(classes)} 通过\n")
    return fail


class FakeBadLLM:
    """故意返回错误交接对象 + 编造时间戳，用于验证代码强制覆盖。"""

    provider = "fake-bad"

    def __init__(self, payload):
        self.payload = payload

    def complete(self, prompt, system=None, max_tokens=4000, temperature=0.7, timeout=120):
        return json.dumps(self.payload, ensure_ascii=False)


def pass_override():
    """Pass B：恶意 LLM，验证 handoff_to / planned_at / date 强制覆盖铁律。"""
    print("═══ Pass B：系统字段铁律（恶意 LLM）═══")
    today = __import__("datetime").datetime.now().strftime("%Y-%m-%d")

    # (module_id, 恶意 payload, 期望的正确 handoff_to, 受保护的时间字段路径)
    cases = [
        ("18", {"directive": {"planned_at": "2099-01-01 00:00:00", "目标主题": "x"},
                "handoff_to": "999 错误员工"}, "1号卿听心流拍档", ("directive", "planned_at")),
        ("19", {"directive": {"planned_at": "2099-01-01 00:00:00", "业务目标": "x"},
                "handoff_to": "999 错误员工"}, "2号卿听战略拍档", ("directive", "planned_at")),
        ("20", {"directive": {"planned_at": "2099-01-01 00:00:00", "场景": "x"},
                "handoff_to": "999 错误员工"}, "3号卿听黑箱拆解使者 → 4号灵魂技能使者", ("directive", "planned_at")),
        ("22", {"diagnosis": {"planned_at": "2099-01-01", "企业画像": "x"},
                "handoff_to": "999 错误员工"}, "28 服务匹配官", ("diagnosis", "planned_at")),
        ("06", {"date": "2099-01-01", "topics": [{"title": "x", "hook": "x", "angle": "x",
                "target": "x", "pain": "x", "score": 85, "reason": "x"}]}, None, ("date",)),
    ]

    cls_map = {c.module_id: c for c in get_agent_classes()}
    fail = 0
    for mid, payload, expect_handoff, time_path in cases:
        cls = cls_map[mid]
        # 06 的输入是 persona/hot_topics；其它是各自 input_schema
        data = sample_input(cls)
        try:
            out = cls.run_logic(data, llm=FakeBadLLM(payload))
        except Exception as e:  # noqa: BLE001
            print(f"  ❌ {mid} {cls.name} 抛出异常：{type(e).__name__}: {e}")
            fail += 1
            continue

        ok = True
        if expect_handoff is not None:
            got = out.get("handoff_to")
            if got != expect_handoff:
                print(f"  ❌ {mid} handoff_to 被模型污染：得到「{got}」应为「{expect_handoff}」")
                ok = False
        # 时间字段必须是今天，不得是编造的 2099
        node = out
        for k in time_path[:-1]:
            node = node.get(k, {}) if isinstance(node, dict) else {}
        tval = node.get(time_path[-1]) if isinstance(node, dict) else None
        if not (isinstance(tval, str) and tval.startswith(today)):
            print(f"  ❌ {mid} {'.'.join(time_path)} 被污染：得到「{tval}」应为今天「{today}」开头")
            ok = False
        if ok:
            print(f"  ✅ {mid} {cls.name:<16} handoff={out.get('handoff_to','—')} {'.'.join(time_path)}={tval}")
    print(f"  → Pass B：{len(cases)-fail}/{len(cases)} 通过\n")
    return fail


def pass_malformed():
    """Pass C：类型校验拦截（从源头） + 畸形输入鲁棒性（绝不阻断链路）。"""
    print("═══ Pass C：类型校验拦截 + 畸形输入鲁棒性 ═══")
    cls_map = {c.module_id: c for c in get_agent_classes()}
    fail = 0
    total = 0
    # 1) validate_input 从源头拦截畸形类型（list/dict 字段收到标量）
    intercept = [
        ("09", {"customers": "误传的字符串"}, "list"),
        ("11", {"tasks": "误传的字符串"}, "list"),
        ("02", {"customer": "误传的字符串"}, "dict"),
    ]
    for mid, data, want in intercept:
        total += 1
        cls = cls_map[mid]
        try:
            cls(llm=None).validate_input(data)
            print(f"  ❌ {mid} validate_input 未拦截畸形类型（{want} 字段收到标量）")
            fail += 1
        except Exception as e:  # noqa: BLE001
            print(f"  ✅ {mid} validate_input 成功拦截畸形类型 → {type(e).__name__}")
    # 2) run_logic 防御性归一：即便绕过校验直接喂字符串，也不崩溃（绝不阻断链路）
    robust = [
        ("09", {"customers": "误传的字符串"}),
        ("11", {"tasks": "误传的字符串"}),
    ]
    for mid, data in robust:
        total += 1
        cls = cls_map[mid]
        try:
            out = cls.run_logic(data, llm=None)
        except Exception as e:  # noqa: BLE001
            print(f"  ❌ {mid} {cls.name} 畸形输入仍崩溃：{type(e).__name__}: {e}")
            fail += 1
            continue
        if not isinstance(out, dict):
            print(f"  ❌ {mid} {cls.name} 输出非 dict")
            fail += 1
            continue
        print(f"  ✅ {mid} {cls.name:<16} 畸形输入已回落默认，输出键={sorted(out.keys())}")
    print(f"  → Pass C：{total-fail}/{total} 通过\n")
    return fail


def pass_kb():
    """Pass D：知识库注入溯源（知识依据）——统一契约：必须位于输出【顶层】。"""
    print("═══ Pass D：知识库注入溯源（知识依据·顶层契约）═══")
    cls_map = {c.module_id: c for c in get_agent_classes()}
    fake_kb = [{
        "title": "测试制度·合伙分红70/30",
        "category": "合伙机制",
        "source": "kb",
        "content": "利润按 70/30 分配，留存发展基金，贡献积分制。",
        "chunkId": "c1", "docId": "d1", "score": 0.92,
    }]
    probe = ["18", "01", "12", "11", "22", "31"]  # 跨 L0/L1/L2/L5/L6 全层
    fail = 0
    total = 0
    for mid in probe:
        cls = cls_map[mid]
        # 有知识包：溯源必须位于【顶层】并反映注入内容
        data_kb = sample_input(cls)
        data_kb["knowledge_context"] = fake_kb
        out = cls.run_logic(data_kb, llm=None)
        total += 1
        refs = out.get("知识依据")
        if not isinstance(refs, list) or not refs or refs[0].get("文档标题") != fake_kb[0]["title"]:
            print(f"  ❌ {mid} 注入知识包后 顶层知识依据 未溯源：{refs}")
            fail += 1
        else:
            print(f"  ✅ {mid} {cls.name:<16} 顶层知识依据已溯源（{len(refs)} 条，含「{refs[0]['文档标题']}」）")
        # 回归探测：不得再嵌套在主内容对象内（统一契约）
        nested = False
        for v in out.values():
            if isinstance(v, dict) and isinstance(v.get("知识依据"), list):
                nested = True
        if nested:
            print(f"  ❌ {mid} 知识依据 仍嵌套在主内容对象内，违反顶层统一契约")
            fail += 1
        # 无知识包：溯源必须为空列表（降级安全）
        data_no = sample_input(cls)
        out_no = cls.run_logic(data_no, llm=None)
        total += 1
        if out_no.get("知识依据") != []:
            print(f"  ❌ {mid} 无知识包时 顶层知识依据 非空：{out_no.get('知识依据')}")
            fail += 1
        else:
            print(f"  ✅ {mid} 无知识包时 顶层知识依据=[]（安全降级）")
    print(f"  → Pass D：{total-fail}/{total} 通过\n")
    return fail


if __name__ == "__main__":
    f1 = pass_fallback()
    f2 = pass_override()
    f3 = pass_malformed()
    f4 = pass_kb()
    total = f1 + f2 + f3 + f4
    print("═══ 结论 ═══")
    if total == 0:
        print("✅ 全部验证通过：兜底路径健康 / 系统字段铁律生效 / 类型校验拦截畸形输入 / 知识库注入溯源可用。")
        sys.exit(0)
    else:
        print(f"❌ 发现 {total} 个问题，需修复。")
        sys.exit(1)
