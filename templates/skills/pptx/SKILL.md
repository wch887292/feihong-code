---
name: pptx
description: 生成专业演示文稿（.pptx）。触发词：做PPT、生成幻灯片、出演示、汇报材料、路演。适用于产品介绍、方案汇报、培训课件等场景。
---

# pptx 技能：专业演示文稿生成

将要点转化为结构清晰的 `.pptx` 演示文稿（封面 / 目录 / 内容页 / 结尾页）。

## 工作流
1. **澄清要素**：用途（路演 / 培训 / 汇报）、页数、风格（商务 / 极简）、是否需图表页。
2. **大纲**：先定每页标题与核心信息（一页一主题，避免文字堆积）。
3. **生成文件**：优先 `python-pptx` 脚本生成；无 python 环境时输出 Markdown 大纲并说明。
4. **校验**：回读确认页码、标题层级、图表占位就位。

## 工具约定
- `write_file`：写出 python 生成脚本或 Markdown 大纲。
- `run_shell`：执行 `python gen_pptx.py`。
- `read_file`：回读校验脚本。

## 生成方式（python-pptx）
```python
from pptx import Presentation
from pptx.util import Inches
prs = Presentation()
slide = prs.slides.add_slide(prs.slide_layouts[1])
slide.shapes.title.text = "封面标题"
slide.placeholders[1].text = "副标题 / 一句话价值"
# 内容页用 bullet 列表，图表页后续可用 python-pptx 图表 API
prs.save("<out>.pptx")
```

## 纪律
- 一页一主题，正文不超过 6 行要点，字号保证可读。
- 对外汇报材料带署名页（公司 / 中心 / 负责人）。
- 先大纲后生成；图表数据需用户确认来源。
