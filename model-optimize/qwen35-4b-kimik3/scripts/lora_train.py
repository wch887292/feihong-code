#!/usr/bin/env python3
"""
QLoRA 微调脚本 - Qwen3.5-4B-Kimi-K3
=====================================
适用场景：4B 蒸馏模型的中文领域适配（如客服、电商、教育）
硬件要求：32GB RAM + CPU（纯 CPU 训练，或 16GB+ 显存 GPU）
数据建议：500~2000 条中文对话/指令样本

用法：
    pip install torch transformers peft accelerate datasets
    python lora_train.py --data data.json --output lora_adapter

注意：
    - 纯 CPU 训练 1000 条数据约需 2~4 小时（i5-12400）
    - 如有 GPU，添加 --bf16 --gpu 0 可加速 5~10 倍
    - 4B 模型 QLoRA 显存需求约 6~8GB（GPU），CPU 内存需求约 12~16GB
"""

import argparse
import json
import os
from pathlib import Path

# ---- 模型配置 ----
MODEL_NAME = "guozhennianhua/qwen3.5-4b-kimi-k3"
# Qwen3.5 chat template（与 Qwen3 兼容，但 Qwen3.5 使用特殊标记）
CHAT_TEMPLATE = "{% for message in messages %}{% if message['role'] == 'system' %}<|im_start|>system\n{{ message['content'] }}<|im_end|>\n{% elif message['role'] == 'user' %}<|im_start|>user\n{{ message['content'] }}<|im_end|>\n{% elif message['role'] == 'assistant' %}<|im_start|>assistant\n{{ message['content'] }}<|im_end|>\n{% endif %}{% endfor %}"

# ---- LoRA 配置 ----
LORA_CONFIG = {
    "r": 64,
    "lora_alpha": 16,
    "target_modules": ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    "lora_dropout": 0.05,
    "bias": "none",
    "task_type": "CAusal_LM",
}

# ---- QLoRA 量化配置 ----
BITS_AND_BYTES_CONFIG = {
    "load_in_4bit": True,
    "bnb_4bit_quant_type": "nf4",
    "bnb_4bit_compute_dtype": "float16",
    "bnb_4bit_use_double_quant": True,
    "bnb_4bit_quant_storage": "uint8",
}

# ---- 训练参数 ----
TRAINING_ARGS = {
    "per_device_train_batch_size": 4,
    "per_device_eval_batch_size": 4,
    "gradient_accumulation_steps": 4,
    "num_train_epochs": 3,
    "learning_rate": 2e-4,
    "warmup_ratio": 0.05,
    "weight_decay": 0.01,
    "lr_scheduler_type": "cosine",
    "logging_steps": 10,
    "save_strategy": "epoch",
    "evaluation_strategy": "steps",
    "eval_steps": 100,
    "save_total_limit": 2,
    "load_best_model_at_end": True,
    "metric_for_best_model": "eval_loss",
    "greater_is_better": False,
    "fp16": True,
    "optim": "paged_adamw_8bit",
    "group_by_length": True,
    "max_length": 2048,
    "packing": False,
    "report_to": "none",
}


def parse_args():
    parser = argparse.ArgumentParser(description="QLoRA 微调 Qwen3.5-4B-Kimi-K3")
    parser.add_argument("--data", type=str, required=True, help="训练数据 JSON 文件路径")
    parser.add_argument("--output", type=str, default="lora_adapter", help="输出目录")
    parser.add_argument("--model", type=str, default=MODEL_NAME, help="基础模型名称或路径")
    parser.add_argument("--epochs", type=int, default=3, help="训练轮数")
    parser.add_argument("--lr", type=float, default=2e-4, help="学习率")
    parser.add_argument("--max-length", type=int, default=2048, help="最大序列长度")
    parser.add_argument("--batch-size", type=int, default=4, help="每设备批大小")
    parser.add_argument("--grad-accum", type=int, default=4, help="梯度累积步数")
    parser.add_argument("--bf16", action="store_true", help="使用 BF16（需 GPU）")
    parser.add_argument("--gpu", type=int, default=-1, help="GPU 设备 ID（-1=CPU）")
    return parser.parse_args()


def load_dataset(path):
    """加载 JSON 格式数据集，支持两种格式：
    1. [{"instruction": "...", "input": "", "output": "..."}]
    2. [{"messages": [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}]
    """
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        data = data.get("data", data.get("train", []))
    return data


def format_example(example):
    """将单条数据格式化为 Qwen3.5 chat template 格式"""
    if "messages" in example:
        return {"messages": example["messages"]}
    instruction = example.get("instruction", "")
    input_text = example.get("input", "")
    output = example.get("output", "")
    user_content = instruction + ("\n\n" + input_text if input_text else "")
    return {
        "messages": [
            {"role": "user", "content": user_content},
            {"role": "assistant", "content": output},
        ]
    }


def main():
    args = parse_args()

    # 延迟导入，避免未安装时直接报错
    import torch
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
        TrainingArguments,
        Trainer,
    )
    from peft import LoraConfig, get_peft_model, prepare_model_for_int8_training
    from datasets import Dataset

    print(f"加载模型: {args.model}")
    print(f"训练数据: {args.data}")
    print(f"输出目录: {args.output}")

    # 加载 tokenizer
    tokenizer = AutoTokenizer.from_pretrained(
        args.model,
        trust_remote_code=True,
        padding_side="right",
    )
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # 加载数据
    raw_data = load_dataset(args.data)
    formatted = [format_example(ex) for ex in raw_data]
    print(f"数据量: {len(formatted)} 条")

    # 量化配置
    bnb_config = None
    if args.gpu >= 0:
        bnb_config = BitsAndBytesConfig(**BITS_AND_BYTES_CONFIG)
    else:
        # CPU 模式：不使用量化，直接加载 FP16
        print("CPU 模式：使用 FP16 加载（不量化）")

    # 加载模型
    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        quantization_config=bnb_config,
        device_map="auto" if args.gpu >= 0 else None,
        trust_remote_code=True,
        torch_dtype=torch.float16,
    )

    # 准备模型用于训练
    if args.gpu >= 0:
        model = prepare_model_for_int8_training(model)

    # 配置 LoRA
    lora_config = LoraConfig(
        r=LORA_CONFIG["r"],
        lora_alpha=LORA_CONFIG["lora_alpha"],
        target_modules=LORA_CONFIG["target_modules"],
        lora_dropout=LORA_CONFIG["lora_dropout"],
        bias=LORA_CONFIG["bias"],
        task_type=LORA_CONFIG["task_type"],
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    # 数据集格式化
    def tokenize_fn(examples):
        texts = []
        for msgs in examples["messages"]:
            text = ""
            for m in msgs:
                text += f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>\n"
            texts.append(text)
        return tokenizer(
            texts,
            truncation=True,
            max_length=args.max_length,
            padding="max_length",
            return_tensors="pt",
        )

    dataset = Dataset.from_list(formatted)
    dataset = dataset.map(tokenize_fn, batched=True, remove_columns=dataset.column_names)

    # 划分训练/验证
    split = dataset.train_test_split(test_size=0.1, seed=42)
    train_dataset = split["train"]
    eval_dataset = split["test"]

    # 训练参数
    training_args = TrainingArguments(
        output_dir=args.output,
        **TRAINING_ARGS,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        num_train_epochs=args.epochs,
        learning_rate=args.lr,
        max_length=args.max_length,
        fp16=args.gpu >= 0 and not args.bf16,
        bf16=args.bf16,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        tokenizer=tokenizer,
    )

    print("开始训练...")
    trainer.train()

    print(f"保存 LoRA adapter 到 {args.output}")
    model.save_pretrained(args.output)
    tokenizer.save_pretrained(args.output)
    print("训练完成！")


if __name__ == "__main__":
    main()