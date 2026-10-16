# -*- coding: utf-8 -*-
"""
自定义大模型工作处理 · 稳定调用脚本
=================================
供 custom-llm-work 技能调用。封装 work_agent.run_one，支持命令行与直接调用两种方式。

命令行示例：
  python run_work.py --type 销售跟进 --text "客户：张总，建材批发..."
  python run_work.py --type 工作总结 --input 今日记录.txt --output 总结.md
  python run_work.py --type 翻译 --text "hello world" --provider ollama
"""
import argparse
import json
import sys
from pathlib import Path

# custom_llm 模块绝对路径（与技能无关，指向本机模块）
CUSTOM_LLM_DIR = Path(r"C:\Users\Administrator\AppData\Local\Doubao\custom_llm")
if CUSTOM_LLM_DIR.exists():
    sys.path.insert(0, str(CUSTOM_LLM_DIR))
else:
    # 回退：脚本自身同级目录
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from llm_client import LLMError, load_config  # noqa: E402
from work_agent import run_one, _read_text  # noqa: E402


def process(work_type, content, provider="auto", output=None, extra_context=None):
    """处理单个工作。返回输出文件路径。"""
    cfg = load_config(CUSTOM_LLM_DIR / "config.json")
    return run_one(cfg, work_type, content, provider=provider, output=output,
                   extra_context=extra_context)


def main():
    parser = argparse.ArgumentParser(description="自定义大模型工作处理")
    parser.add_argument("--type", default="通用", help="工作类型：通用/销售跟进/获客文案/工作总结/客户分析/翻译/文案润色")
    parser.add_argument("--text", help="直接传入文本")
    parser.add_argument("--input", help="输入文件路径")
    parser.add_argument("--output", help="输出文件路径（默认自动命名到 outputs/）")
    parser.add_argument("--provider", default="auto", help="模型提供方：ollama/deepseek/openrouter/auto")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出结果")
    args = parser.parse_args()

    try:
        if args.input:
            content = _read_text(args.input)
        elif args.text:
            content = args.text
        else:
            print("错误: 请用 --text 或 --input 提供内容")
            sys.exit(1)

        out = process(args.type, content, provider=args.provider, output=args.output)
        if args.json:
            print(json.dumps({"ok": True, "type": args.type, "provider": args.provider,
                              "output": out}, ensure_ascii=False))
        else:
            print(f"OK: {out}")
    except (LLMError, ValueError, FileNotFoundError) as e:
        if args.json:
            print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        else:
            print(f"FAIL: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
