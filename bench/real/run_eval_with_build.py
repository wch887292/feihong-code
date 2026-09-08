#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""直接调用 swebench run_evaluation main()，传入 task_repo 触发镜像构建。"""
import os
import sys

os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
os.chdir(r"H:\Muse Code复刻\bench\real")

from swebench.harness.run_evaluation import main

main(
    dataset_name="SWE-bench/SWE-bench_Lite",
    split="test",
    instance_ids=["astropy__astropy-14182"],
    predictions_path="predictions_astropy_test.jsonl",
    max_workers=1,
    open_file_limit=4096,
    run_id="dsv4f_build1",
    timeout=1800,
    rewrite_reports=False,
    modal=False,
    report_dir="eval_dsv4f_build1",
    task_repo=r"H:\Muse Code复刻\bench\real\task_repo",
)
