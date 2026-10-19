---
name: docx
description: 生成专业 Word 文档（.docx）。触发词：生成文档、写报告、出方案、做合同、Word 排版、交付文档。适用于需要可编辑/可打印/可留痕的正式文档场景。
---

# docx 技能：专业 Word 文档生成

将需求转化为结构清晰、可直接交付的 `.docx` 文档（标题 / 目录 / 正文 / 表格 / 页眉页脚）。

## 工作流
1. **澄清要素**：文档类型（报告 / 方案 / 合同 / 说明书）、受众、篇幅、必须包含的章节、署名与版本要求。
2. **大纲**：先产出层级大纲（H1/H2/H3），与用户确认关键章节后再写正文。
3. **内容填充**：逐节生成正文，表格先用 Markdown 表格表达。
4. **生成文件**：优先 `pandoc` 将 Markdown 转 `.docx`；环境无 pandoc 时改用 `python-docx` 脚本；均无则输出 `.md` 并说明限制。
5. **校验**：回读确认标题层级、表格、署名 / 水印 / 版本号就位。

## 工具约定
- `write_file`：写出 Markdown 源或 python 生成脚本。
- `run_shell`：执行 `pandoc <src>.md -o <out>.docx` 或 `python gen_docx.py`。
- `read_file`：回读校验生成结果。

## 生成方式
### 方式 A：pandoc（推荐，保真度高）
```bash
# 先写结构化 Markdown，再转换
pandoc "<src>.md" -o "<out>.docx" --highlight-style=tango
```

### 方式 B：python-docx（无 pandoc 时）
```python
from docx import Document
from docx.shared import Pt
doc = Document()
doc.add_heading("标题", level=1)
doc.add_paragraph("正文内容……")
# doc.add_table(rows, cols) 添加表格
doc.save("<out>.docx")
```

## 纪律
- 对外交付文档必须带署名三行：**公司 / 中心 / 负责人**。
- 敏感数据自动脱敏，不写入示例密钥、真实客户信息。
- 先大纲后正文，避免一次性大段重写；破坏性操作前请求确认。
