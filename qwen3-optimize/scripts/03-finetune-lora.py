# -*- coding: utf-8 -*-
"""
qwen3:8b QLoRA 领域微调脚本（中文编程 + 企业问答场景）
署名：晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 吴赐虹

⚠️ 硬件要求：4bit QLoRA 需约 10GB 显存（RTX 3080/4090/A10 级别）。
   本机纯 CPU 无法训练——此脚本供有 GPU 的机器或云端使用。

依赖：
    pip install "transformers>=4.44" peft bitsandbytes datasets accelerate

数据格式（train.jsonl，每行一条）：
    {"instruction": "...", "input": "...", "output": "..."}

用法：
    python 03-finetune-lora.py                 # 训练
    python 03-finetune-lora.py --merge-only    # 仅合并 LoRA 并导出
"""
import argparse
import json

import torch
from datasets import Dataset
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    TrainingArguments,
    Trainer,
    DataCollatorForSeq2Seq,
    BitsAndBytesConfig,
)

BASE_MODEL = "Qwen/Qwen3-8B"
DATA_FILE = "train.jsonl"
OUTPUT_DIR = "qwen3-8b-qlora-out"
MAX_LEN = 2048


def load_jsonl(path: str) -> Dataset:
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return Dataset.from_list(rows)


def build_example(tok, ex):
    """instruction + input → output，带 loss mask（只对 output 计算 loss）"""
    prompt = f"### 指令：{ex['instruction']}\n"
    if ex.get("input"):
        prompt += f"### 输入：{ex['input']}\n"
    prompt += "### 回答：\n"
    p_ids = tok(prompt, add_special_tokens=False)["input_ids"]
    o_ids = tok(ex["output"] + tok.eos_token, add_special_tokens=False)["input_ids"]
    input_ids = (p_ids + o_ids)[:MAX_LEN]
    labels = ([-100] * len(p_ids) + o_ids)[:MAX_LEN]
    return {"input_ids": input_ids, "labels": labels, "attention_mask": [1] * len(input_ids)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--merge-only", action="store_true", help="仅合并 LoRA 导出完整权重")
    args = ap.parse_args()

    tok = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)

    if args.merge_only:
        from peft import PeftModel
        base = AutoModelForCausalLM.from_pretrained(
            BASE_MODEL, torch_dtype=torch.bfloat16, device_map="auto"
        )
        model = PeftModel.from_pretrained(base, OUTPUT_DIR)
        merged = model.merge_and_unload()
        merged.save_pretrained("qwen3-8b-merged")
        tok.save_pretrained("qwen3-8b-merged")
        print("✅ 已合并导出到 qwen3-8b-merged/（再用 llama.cpp convert_hf_to_gguf.py 转 GGUF 导入 Ollama）")
        return

    # 4bit 量化基座（QLoRA 核心）
    bnb = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL, quantization_config=bnb, device_map="auto"
    )
    model = prepare_model_for_kbit_training(model)

    lcfg = LoraConfig(
        r=16, lora_alpha=32, lora_dropout=0.05,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lcfg)
    model.print_trainable_parameters()  # 通常 <1% 参数可训练

    ds = load_jsonl(DATA_FILE).map(
        lambda ex: build_example(tok, ex),
        remove_columns=ds_column_names(),
    )

    trainer = Trainer(
        model=model,
        train_dataset=ds,
        args=TrainingArguments(
            output_dir=OUTPUT_DIR,
            per_device_train_batch_size=2,
            gradient_accumulation_steps=8,   # 等效 batch=16
            num_train_epochs=3,
            learning_rate=2e-4,
            lr_scheduler_type="cosine",
            warmup_ratio=0.05,
            bf16=True,
            logging_steps=10,
            save_strategy="epoch",
            report_to=[],
        ),
        data_collator=DataCollatorForSeq2Seq(tok, padding=True),
    )
    trainer.train()
    trainer.save_model(OUTPUT_DIR)
    print(f"✅ 训练完成，LoRA 权重在 {OUTPUT_DIR}/；合并导出：python 03-finetune-lora.py --merge-only")


def ds_column_names():
    return ["instruction", "input", "output"]


if __name__ == "__main__":
    main()
