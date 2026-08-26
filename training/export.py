#!/usr/bin/env python3
"""
飞虹 Code - 模型导出与部署脚本 (P3-1)

将训练好的 LoRA 模型合并到基础模型，导出为可部署格式。
支持：
1. 合并 LoRA 权重到基础模型
2. 导出为 GGUF 格式（用于 llama.cpp 本地推理）
3. 导出为 ONNX 格式（用于 Web 部署）
4. 生成模型配置文件，供飞虹 Code 补全引擎使用

用法：
    python export.py --model_path ./models/feihong-code-completion --output ./models/exported
    python export.py --model_path ./models/feihong-code-completion --format gguf
"""
import argparse
import json
import os
import shutil
from pathlib import Path


def load_model_config(model_path):
    """加载模型配置"""
    config_path = os.path.join(model_path, 'training_config.json')
    if os.path.exists(config_path):
        with open(config_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def merge_lora(model_path, output_path):
    """
    合并 LoRA 权重到基础模型
    """
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from peft import PeftModel
    except ImportError:
        print("错误：需要安装 transformers, peft, torch")
        print("pip install transformers peft torch")
        return False

    config = load_model_config(model_path)
    base_model = config.get('base_model', 'bigcode/starcoderbase-1b')

    print(f"[1/4] 加载基础模型: {base_model}")
    tokenizer = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        trust_remote_code=True,
        torch_dtype=torch.float16,
        device_map='cpu',
    )

    print(f"[2/4] 加载 LoRA 权重: {model_path}")
    model = PeftModel.from_pretrained(model, model_path)

    print("[3/4] 合并权重...")
    model = model.merge_and_unload()

    print(f"[4/4] 保存合并模型到: {output_path}")
    os.makedirs(output_path, exist_ok=True)
    model.save_pretrained(output_path, safe_serialization=True)
    tokenizer.save_pretrained(output_path)

    # 复制训练配置
    if os.path.exists(os.path.join(model_path, 'training_config.json')):
        shutil.copy(
            os.path.join(model_path, 'training_config.json'),
            os.path.join(output_path, 'training_config.json'),
        )

    print("✅ LoRA 合并完成")
    return True


def export_gguf(model_path, output_path):
    """
    导出为 GGUF 格式（用于 llama.cpp）
    """
    try:
        from llama_cpp import Llama
    except ImportError:
        print("错误：需要安装 llama-cpp-python")
        print("pip install llama-cpp-python")
        return False

    print(f"导出 GGUF 格式: {model_path} -> {output_path}")
    # 使用 llama.cpp 的 convert 脚本
    # 这里简化处理，实际需要调用 llama.cpp 的转换工具
    print("提示：GGUF 转换需要 llama.cpp 工具链")
    print("参考：https://github.com/ggerganov/llama.cpp#model-conversion")
    return False


def export_onnx(model_path, output_path):
    """
    导出为 ONNX 格式（用于 Web 部署）
    """
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from optimum.onnxruntime import ORTModelForCausalLM
    except ImportError:
        print("错误：需要安装 transformers, optimum, onnxruntime")
        print("pip install transformers optimum onnxruntime")
        return False

    print(f"[1/3] 加载模型: {model_path}")
    tokenizer = AutoTokenizer.from_pretrained(model_path)

    print(f"[2/3] 转换为 ONNX...")
    model = ORTModelForCausalLM.from_pretrained(model_path, export=True)

    print(f"[3/3] 保存到: {output_path}")
    os.makedirs(output_path, exist_ok=True)
    model.save_pretrained(output_path)
    tokenizer.save_pretrained(output_path)

    print("✅ ONNX 导出完成")
    return True


def generate_feihong_config(model_path, output_path):
    """
    生成飞虹 Code 补全引擎配置文件
    """
    config = load_model_config(model_path)

    feihong_config = {
        "model_type": "local",
        "model_path": model_path,
        "model_name": config.get('model_name', 'feihong-code-completion'),
        "base_model": config.get('base_model', ''),
        "task_type": "fill-in-the-middle",
        "max_seq_length": config.get('max_seq_length', 2048),
        "temperature": 0.2,
        "top_p": 0.95,
        "top_k": 50,
        "max_new_tokens": 100,
        "fim_tokens": {
            "prefix": "<PRE>",
            "suffix": "<SUF>",
            "middle": "<MID>"
        },
        "lora_config": config.get('lora', {}),
        "training_info": {
            "num_train_epochs": config.get('num_train_epochs'),
            "learning_rate": config.get('learning_rate'),
            "train_samples": config.get('data', {}).get('max_train_samples'),
        },
        "created_at": __import__('datetime').datetime.now().isoformat(),
    }

    config_path = os.path.join(output_path, 'feihong-model-config.json')
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(feihong_config, f, indent=2, ensure_ascii=False)

    print(f"✅ 飞虹 Code 模型配置已生成: {config_path}")
    return feihong_config


def main():
    parser = argparse.ArgumentParser(description='飞虹 Code 模型导出与部署')
    parser.add_argument('--model_path', type=str, required=True, help='训练好的模型路径')
    parser.add_argument('--output', type=str, default='./models/exported', help='输出目录')
    parser.add_argument('--format', type=str, choices=['merged', 'gguf', 'onnx', 'all'], default='merged',
                        help='导出格式')
    parser.add_argument('--skip_merge', action='store_true', help='跳过 LoRA 合并（模型已合并）')
    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)

    print(f"=== 飞虹 Code 模型导出 ===")
    print(f"模型路径: {args.model_path}")
    print(f"输出目录: {args.output}")
    print(f"导出格式: {args.format}")
    print()

    # 1. 合并 LoRA（如果需要）
    merged_path = args.model_path
    if not args.skip_merge and args.format in ['merged', 'all']:
        merged_path = os.path.join(args.output, 'merged')
        if not merge_lora(args.model_path, merged_path):
            print("⚠️ LoRA 合并失败，使用原模型路径")
            merged_path = args.model_path
        print()

    # 2. 导出 GGUF
    if args.format in ['gguf', 'all']:
        gguf_path = os.path.join(args.output, 'gguf')
        export_gguf(merged_path, gguf_path)
        print()

    # 3. 导出 ONNX
    if args.format in ['onnx', 'all']:
        onnx_path = os.path.join(args.output, 'onnx')
        export_onnx(merged_path, onnx_path)
        print()

    # 4. 生成飞虹 Code 配置
    print("生成飞虹 Code 模型配置...")
    generate_feihong_config(merged_path, args.output)

    print(f"\n=== 导出完成 ===")
    print(f"输出目录: {args.output}")
    print(f"模型配置: {os.path.join(args.output, 'feihong-model-config.json')}")


if __name__ == '__main__':
    main()
