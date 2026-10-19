---
name: xlsx
description: 生成或处理 Excel 表格（.xlsx）。触发词：做表格、导出Excel、生成报表、数据统计表、批量填表。适用于结构化数据落表、批量生成、报表汇总场景。
---

# xlsx 技能：Excel 表格生成与处理

将结构化数据转化为可直接打开的 `.xlsx`（多 Sheet、表头样式、公式可选）。

## 工作流
1. **澄清要素**：字段清单、行数规模、是否多 Sheet、是否需要公式 / 汇总行。
2. **结构**：先定表头与每列类型（文本 / 数字 / 日期），与用户确认。
3. **生成文件**：优先 `python openpyxl`；无 python 时用 Node `exceljs` 或 SheetJS；均无则输出 CSV 并说明。
4. **校验**：回读确认表头、行数、汇总正确。

## 工具约定
- `write_file`：写出生成脚本。
- `run_shell`：执行 `python gen_xlsx.py` 或 `node gen_xlsx.mjs`。
- `read_file`：回读校验。

## 生成方式（openpyxl）
```python
from openpyxl import Workbook
wb = Workbook()
ws = wb.active
ws.append(["名称", "数量", "单价"])  # 表头
ws.append(["示例A", 3, 12.5])
# ws["C2"] = "=B2*C2" 可加公式
wb.save("<out>.xlsx")
```

## 纪律
- 大数据量先确认规模，避免一次性生成数万行卡顿。
- 金额 / 数量列明确单位；敏感数据脱敏。
- 先定表头后填数；破坏性行为前请求确认。
