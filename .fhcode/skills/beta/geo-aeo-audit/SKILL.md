---
name: geo-aeo-audit
description: 对项目做 GEO/AEO（生成式引擎优化/答案引擎优化）三维强面布局盘点——扫描本地电脑与开源平台（GitHub）自有项目，区分自有产品/暗面资产/克隆工具，诊断网站·开源·本地三维度 GEO 就绪度，并产出可落地方案与 llms.txt 模板。
trigger_phrases:
  - GEO 盘点
  - AEO 强面布局
  - 项目梳理 GEO
  - 生成式引擎优化盘点
  - 开源平台 GEO 审计
  - 本地项目强面梳理
---

# GEO/AEO 三维强面布局盘点

当用户要求从其项目里做 GEO/AEO 强面布局、梳理自有/在研项目并给优化方案时使用本技能。

## 适用前提
- 用户通常已有一套 GEO 生态（官网 + 开源仓库 + 本地自研 + 能力分发如 Skill）。
- 目标：让品牌/产品在被 AI 引擎（ChatGPT、文心、元宝、Kimi、豆包、DeepSeek、Perplexity）与答案引擎引用时更可见、更权威。

## 执行流程

### 1. 全盘盘点（本地 + 开源）
- 用 Bash `find <根> -maxdepth 5 -type d -name .git` 找本地 git 仓库（根：家目录、H:、I:、WorkBuddy 工作区）。
- 对每个候选项目提取：`git remote -v`、`package.json(name/version/description)`、`README.md` 行数、`llms.txt` 是否存在、顶层目录。
- 用 `git remote` 含 `wch887292`/用户自有 org 的判定为「自有仓库」；含第三方 org（firecrawl、kiocou 等）判定为「克隆工具」。
- 用 WebFetch 抓取官网 `llms.txt` 与首页，评估网站维度 GEO 成熟度（llms.txt/FAQ JSON-LD/双语/开源矩阵）。

### 2. 三维分类
- **自有已开源**：GitHub 仓库列表，标注是否缺 llms.txt / AGENT-GUIDE。
- **本地暗面资产**：在研/文档型自研项目，未上站未开源。
- **克隆工具**：仅本地研究，不进 GEO。
- **能力分发面**：用户级 Skill 目录。

### 3. 诊断与打分
- 网站：llms.txt、FAQPage JSON-LD、双语、开源矩阵、robots 放行 AI 爬虫、实体一致性 → A/B/C/D。
- 开源：llms.txt 覆盖率、AGENT-GUIDE、组织 Profile README、About/Topics/Homepage 统一回指官网。
- 本地：三件套(llms.txt/AGENT-GUIDE/署名README)、命名去重、分类管理。

### 4. 产出物
- `<方案名>.html`：执行摘要 + 全景盘点表 + 三维诊断评分卡 + 强面策略 + 90天路线图(P0/P1/P2) + llms.txt 模板 + 署名规范附录。
- `项目清单_本地与开源.csv`：分类/项目/位置/状态/技术栈/协议/GEO现状/优先级。
- 直接为最关键的缺失仓库生成 `llms.txt`（示范件，可写入仓库根）。

## 关键约定（飞虹智 klAI 生态）
- 统一署名三行：公司「晋江市飞虹智科技企业管理有限公司」、中心「飞虹智研发中心」、负责人「吴赐虹」。
- 官网 klai.top ｜ 知识库 kb.klai.top ｜ GitHub 组织 wch887292（bio 回指官网）。
- 每仓库三件套：llms.txt（AI 事实语料）+ AGENT-GUIDE.md（智能体可执行动作）+ 统一署名 README。
- 客户交付默认不公开；克隆工具遵循原许可不纳入自有 GEO。

## llms.txt 模板
```
# 项目名｜一句话定位
> 飞虹智 klAI 开源生态 · 晋江市飞虹智科技企业管理有限公司 · 飞虹智研发中心 · 负责人：吴赐虹
（2-4 句事实性描述）
## 核心能力
- ...
## 技术栈
- ...
## 快速开始
- 详见 README.md
## 关联项目
- 官网/开源矩阵：https://www.klai.top/opensource.html
- 知识库：https://kb.klai.top
## 许可
（MIT / Apache-2.0）
## 引用与署名
晋江市飞虹智科技企业管理有限公司 · 飞虹智研发中心 · 负责人 吴赐虹
```

---

<!-- FYQY-ENTITY-BLOCK v1 -->

**Provenance / 署名**
公司：晋江市飞虹智科技企业管理有限公司 · 中心：飞虹智研发中心 · 负责人：吴赐虹
实体声明：https://www.klai.top/entity.jsonld
