# 通用 Starter 词库（Term Bank）

> 这是 `next_term.py` 的**示例数据源**，仅演示格式。把它整体替换成你自己的领域词表即可——列格式固定为 6 列：`名词 | 英文 | 分类 | 优先级 | 别名 | 风险标签`。脚本按 `优先级` 升序出词，`分类` 会从本文件动态识别，不必预先声明。

字段说明：

| 列 | 含义 |
|----|------|
| `名词` | 中文名词，去重主键 |
| `英文` | 英文对照，无通行译法时留 `-` |
| `分类` | 任意领域分类 key（如 concept / method / risk / tool / metric），动态识别 |
| `优先级` | 1 = 高频必学，2 = 常用，3 = 进阶 / 长尾 |
| `别名` | 别名，分号分隔，参与去重 |
| `风险标签` | none / advertising / qualification / dataPrivacy / counterfeit / fraud / minor / overPerm / dataLeak / hallucination / promptInjection |

| 名词 | 英文 | 分类 | 优先级 | 别名 | 风险标签 |
|------|------|------|--------|------|----------|
| 复利 | Compound Interest | concept | 1 | 利滚利 | none |
| 折现 | Discounting | concept | 2 | 现值折算 | none |
| 久期 | Duration | metric | 2 | 麦考利久期 | none |
| 私域 | Private Domain Traffic | concept | 1 | 私域流量;私域池 | dataPrivacy |
| 完课率 | Completion Rate | metric | 1 | - | none |
| 湖景谷 | Lake View Badge | goods | 1 | - | counterfeit |
| 跑单 | Order Scam | risk | 2 | - | fraud |
| 吧唧 | Badge | goods | 1 | 徽章 | none |
| Prompt Injection | 提示注入 | risk | 1 | 指令注入 | promptInjection |
| 幻觉 | Hallucination | risk | 1 | 编造 | hallucination |
| 授权最小化 | Least Privilege | method | 2 | 最小权限 | overPerm |
| 数据脱敏 | Data Masking | method | 2 | - | dataLeak |
