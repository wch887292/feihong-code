#!/usr/bin/env python3
"""
next_term.py — glossary-deck 词库游标管理（领域无关）

从任意 references/*.md 词库解析名词表，按 priority 出词，跨会话去重。
词库列格式：  | 名词 | 英文 | 分类 | 优先级 | 别名 | 风险标签 |

用法:
    # 预览下一批待释义名词（不写状态）
    python3 next_term.py --peek --category concept --count 3

    # 生成完成后提交，写回已出词
    python3 next_term.py --commit --terms terms.json

    # 指定自定义词库与 ID 前缀
    python3 next_term.py --peek --bank my-bank.md --prefix fin

    # 查看当前进度 / 重置
    python3 next_term.py --status
    python3 next_term.py --reset --category concept
"""

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

# 默认分类仅作兜底；实际分类会从词库文件动态读取
DEFAULT_CATEGORIES = ["concept", "method", "risk", "tool", "metric", "other"]

SKILL_ROOT = Path(__file__).resolve().parent.parent
TERM_BANK = SKILL_ROOT / "references" / "term-bank.md"
DEFAULT_STATE = Path.home() / "glossary-deck" / "state.json"

ROW_RE = re.compile(r"^\|(.+)\|\s*$")


def load_bank(bank_path: Path):
    """解析词库 md 中的所有表格行，返回词条列表（分类动态识别）。"""
    if not bank_path.exists():
        sys.exit(f"[glossary-deck] 词库文件缺失: {bank_path}")

    terms, seen = [], set()
    categories = []
    for line in bank_path.read_text(encoding="utf-8").splitlines():
        m = ROW_RE.match(line.strip())
        if not m:
            continue
        cells = [c.strip() for c in m.group(1).split("|")]
        if len(cells) != 6:
            continue
        term_zh, term_en, category, priority, aliases, risk_flag = cells
        if not priority.isdigit():
            continue  # 跳过表头与非数据行
        if category not in categories:
            categories.append(category)
        if term_zh in seen:
            continue
        seen.add(term_zh)
        terms.append({
            "termZh": term_zh,
            "termEn": "" if term_en == "-" else term_en,
            "category": category,
            "priority": int(priority),
            "aliases": [a for a in aliases.split(";") if a and a != "-"],
            "riskFlag": risk_flag,
        })
    return terms, (categories or DEFAULT_CATEGORIES)


def load_state(state_path: Path):
    if state_path.exists():
        try:
            return json.loads(state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass  # 状态损坏时静默重建，不阻断出词
    return {"servedTerms": [], "lastId": 0, "updatedAt": None}


def save_state(state_path: Path, state: dict):
    state["updatedAt"] = datetime.now().isoformat(timespec="seconds")
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2),
                          encoding="utf-8")


def pick(terms, state, categories, category, count, exclude, prefix):
    served = set(state.get("servedTerms", [])) | set(exclude)
    pool = [t for t in terms
            if (category in (None, "all") or t["category"] == category)
            and t["termZh"] not in served
            and not (set(t["aliases"]) & served)]
    pool.sort(key=lambda t: (t["priority"], categories.index(t["category"])
                             if t["category"] in categories else 99))
    picked, next_id = [], state.get("lastId", 0)
    for t in pool[:count]:
        next_id += 1
        picked.append({**t, "termId": f"{prefix}-{next_id:04d}"})
    return picked, len(pool)


def main():
    p = argparse.ArgumentParser(description="glossary-deck 词库游标管理")
    p.add_argument("--peek", action="store_true", help="预览下一批名词，不写状态")
    p.add_argument("--commit", action="store_true", help="提交已生成词条")
    p.add_argument("--status", action="store_true", help="查看进度")
    p.add_argument("--reset", action="store_true", help="重置游标")
    p.add_argument("--category", default="all")
    p.add_argument("--count", type=int, default=1)
    p.add_argument("--exclude", nargs="*", default=[])
    p.add_argument("--terms", help="commit 模式下的 terms.json 路径")
    p.add_argument("--state", default=str(DEFAULT_STATE))
    p.add_argument("--bank", default=str(TERM_BANK), help="词库 md 路径")
    p.add_argument("--prefix", default="glo", help="生成 termId 的 3 字母前缀")
    args = p.parse_args()

    bank_path, state_path = Path(args.bank), Path(args.state).expanduser()
    terms, categories = load_bank(bank_path)
    state = load_state(state_path)

    if args.status:
        by_cat = {}
        for t in terms:
            by_cat[t["category"]] = by_cat.get(t["category"], 0) + 1
        served = set(state.get("servedTerms", []))
        out = {
            "totalTerms": len(terms),
            "servedCount": len(served),
            "remaining": len(terms) - len([t for t in terms if t["termZh"] in served]),
            "byCategory": by_cat,
            "updatedAt": state.get("updatedAt"),
            "statePath": str(state_path),
        }
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return

    if args.reset:
        if args.category == "all":
            state = {"servedTerms": [], "lastId": 0, "updatedAt": None}
        else:
            drop = {t["termZh"] for t in terms if t["category"] == args.category}
            state["servedTerms"] = [x for x in state["servedTerms"] if x not in drop]
        save_state(state_path, state)
        print(json.dumps({"reset": args.category, "statePath": str(state_path)},
                         ensure_ascii=False))
        return

    if args.commit:
        if not args.terms:
            sys.exit("[glossary-deck] --commit 需要配合 --terms <path>")
        payload = json.loads(Path(args.terms).expanduser().read_text(encoding="utf-8"))
        items = payload if isinstance(payload, list) else payload.get("terms", [])
        served = state.setdefault("servedTerms", [])
        for it in items:
            for key in [it.get("termZh"), *it.get("aliases", [])]:
                if key and key not in served:
                    served.append(key)
            num = re.sub(r"\D", "", it.get("termId", "") or "0")
            state["lastId"] = max(state.get("lastId", 0), int(num or 0))
        save_state(state_path, state)
        print(json.dumps({"committed": len(items), "servedTotal": len(served)},
                         ensure_ascii=False))
        return

    # 默认即 peek
    picked, remaining = pick(terms, state, categories, args.category,
                             max(1, args.count), args.exclude, args.prefix)
    result = {
        "mode": "peek",
        "category": args.category,
        "picked": picked,
        "remainingInPool": remaining,
        "exhausted": len(picked) == 0,
        "hint": ("词库已出完，建议换 category 或投喂 customTerms"
                 if not picked else "生成释义后请执行 --commit 写回游标"),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
