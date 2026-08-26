#!/usr/bin/env python3
"""
飞虹 Code - 专用补全模型 LoRA 微调脚本 (P3-1)

使用 FIM (Fill-In-the-Middle) 格式训练代码补全模型。
依赖：transformers, peft, datasets, torch, accelerate

用法：
    python train.py --config lora-config.json
    python train.py --config lora-config.json --base_model bigcode/starcoderbase-1b
"""
import argparse
import json
import os
import random
from pathlib import Path

import torch
from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    TrainingArguments,
    Trainer,
    DataCollatorForLanguageModeling,
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training


def load_config(config_path):
    """加载训练配置"""
    with open(config_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def fim_transform(example, tokenizer, fim_rate=0.5, fim_spm_rate=0.5):
    """
    FIM (Fill-In-the-Middle) 数据转换
    将 prefix/middle/suffix 格式转换为模型输入格式
    """
    prefix = example['prefix']
    middle = example['middle']
    suffix = example['suffix']

    # 随机决定是否使用 FIM 格式
    if random.random() < fim_rate:
        # SPM (Suffix-Prefix-Middle) 或 PSM (Prefix-Suffix-Middle)
        if random.random() < fim_spm_rate:
            # SPM: <SUF> suffix <PRE> prefix <MID> middle
            text = f'<SUF>{suffix}<PRE>{prefix}<MID>{middle}'
        else:
            # PSM: <PRE> prefix <SUF> suffix <MID> middle
            text = f'<PRE>{prefix}<SUF>{suffix}<MID>{middle}'
    else:
        # 普通格式：prefix + middle
        text = prefix + middle

    return {'text': text}


def tokenize_function(examples, tokenizer, max_length):
    """分词函数"""
    return tokenizer(
        examples['text'],
        truncation=True,
        max_length=max_length,
        return_special_tokens_mask=True,
    )


def main():
    parser = argparse.ArgumentParser(description='飞虹 Code 补全模型 LoRA 微调')
    parser.add_argument('--config', type=str, default='lora-config.json', help='训练配置文件路径')
    parser.add_argument('--base_model', type=str, default=None, help='基础模型名称（覆盖配置）')
    parser.add_argument('--output_dir', type=str, default=None, help='输出目录（覆盖配置）')
    parser.add_argument('--resume', type=str, default=None, help='从检查点恢复训练')
    args = parser.parse_args()

    # 加载配置
    config = load_config(args.config)
    if args.base_model:
        config['base_model'] = args.base_model
    if args.output_dir:
        config['output_dir'] = args.output_dir

    print(f"=== 飞虹 Code 补全模型训练 ===")
    print(f"基础模型: {config['base_model']}")
    print(f"输出目录: {config['output_dir']}")
    print(f"训练轮数: {config['num_train_epochs']}")
    print(f"学习率: {config['learning_rate']}")

    # 加载 tokenizer
    print("\n[1/5] 加载 tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(config['base_model'], trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # 添加 FIM 特殊 token
    fim_tokens = ['<PRE>', '<SUF>', '<MID>']
    num_added = tokenizer.add_special_tokens({'additional_special_tokens': fim_tokens})
    print(f"添加 FIM 特殊 token: {num_added} 个")

    # 加载数据集
    print("\n[2/5] 加载数据集...")
    data_files = {
        'train': config['data']['train_file'],
        'validation': config['data']['validation_file'],
    }
    dataset = load_dataset('json', data_files=data_files)

    # FIM 转换
    fim_rate = config.get('fim', {}).get('fim_rate', 0.5)
    fim_spm_rate = config.get('fim', {}).get('fim_spm_rate', 0.5)
    dataset = dataset.map(
        lambda x: fim_transform(x, tokenizer, fim_rate, fim_spm_rate),
        remove_columns=['prefix', 'middle', 'suffix', 'file_path', 'language', 'cursor_offset', 'middle_length'],
    )

    # 分词
    max_length = config['max_seq_length']
    tokenized_datasets = dataset.map(
        lambda x: tokenize_function(x, tokenizer, max_length),
        batched=True,
        remove_columns=['text'],
    )

    print(f"训练样本数: {len(tokenized_datasets['train'])}")
    print(f"验证样本数: {len(tokenized_datasets['validation'])}")

    # 加载模型
    print("\n[3/5] 加载模型...")
    model = AutoModelForCausalLM.from_pretrained(
        config['base_model'],
        trust_remote_code=True,
        torch_dtype=torch.bfloat16 if config.get('bf16') else torch.float32,
        device_map='auto',
    )
    model.resize_token_embeddings(len(tokenizer))

    # LoRA 配置
    print("\n[4/5] 配置 LoRA...")
    lora_config = LoraConfig(
        r=config['lora']['r'],
        lora_alpha=config['lora']['lora_alpha'],
        lora_dropout=config['lora']['lora_dropout'],
        bias=config['lora']['bias'],
        task_type=config['lora']['task_type'],
        target_modules=config['lora']['target_modules'],
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    # 训练参数
    training_args = TrainingArguments(
        output_dir=config['output_dir'],
        num_train_epochs=config['num_train_epochs'],
        per_device_train_batch_size=config['per_device_train_batch_size'],
        per_device_eval_batch_size=config['per_device_eval_batch_size'],
        gradient_accumulation_steps=config['gradient_accumulation_steps'],
        learning_rate=config['learning_rate'],
        weight_decay=config['weight_decay'],
        warmup_ratio=config['warmup_ratio'],
        lr_scheduler_type=config['lr_scheduler_type'],
        logging_steps=config['logging_steps'],
        save_steps=config['save_steps'],
        eval_steps=config['eval_steps'],
        save_total_limit=config['save_total_limit'],
        evaluation_strategy=config['evaluation_strategy'],
        load_best_model_at_end=config['load_best_model_at_end'],
        metric_for_best_model=config['metric_for_best_model'],
        greater_is_better=config['greater_is_better'],
        bf16=config.get('bf16', False),
        tf32=config.get('tf32', False),
        gradient_checkpointing=config.get('gradient_checkpointing', False),
        report_to=config.get('report_to', []),
        seed=config.get('seed', 42),
    )

    # 数据整理器
    data_collator = DataCollatorForLanguageModeling(
        tokenizer=tokenizer,
        mlm=False,
    )

    # 训练器
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized_datasets['train'],
        eval_dataset=tokenized_datasets['validation'],
        data_collator=data_collator,
    )

    # 开始训练
    print("\n[5/5] 开始训练...")
    trainer.train(resume_from_checkpoint=args.resume)

    # 保存模型
    print("\n保存最终模型...")
    trainer.save_model(config['output_dir'])
    tokenizer.save_pretrained(config['output_dir'])

    # 保存训练配置
    with open(os.path.join(config['output_dir'], 'training_config.json'), 'w') as f:
        json.dump(config, f, indent=2)

    print(f"\n=== 训练完成 ===")
    print(f"模型保存在: {config['output_dir']}")
    print(f"最佳评估损失: {trainer.state.best_metric}")


if __name__ == '__main__':
    main()
