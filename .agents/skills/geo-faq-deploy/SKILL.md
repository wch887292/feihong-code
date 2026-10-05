---
name: geo-faq-deploy
description: 批量生成 FAQ 问答页面并部署到 klai.top，打通 GEO 投喂三通道（sitemap / llms.txt / IndexNow）。触发词：FAQ 批量生成、FAQ 部署、GEO 投喂、问答页、sitemap 更新、llms.txt 更新、IndexNow 推送。
---

# /geo-faq-deploy 技能：FAQ 批量生成 + GEO 投喂部署

**执行型技能**：按数据驱动流水线批量生成结构化 FAQ 页面，部署到服务器并完成 AI 引擎投喂。

## 输入
- 关键词列表（映射为分类前缀，如 企业管理→qygl、AI企业赋能→aien、企业AI化→aihua、SEO→seo、GEO/AAO→geo+aao）
- 每分类条数（如 50）；目标站点（默认 https://www.klai.top）

## 流程（7 步，每步有验收）

### 1. 数据文件（faq_data_<prefix>.py）
每文件四常量：`PREFIX` / `CATEGORY` / `KEYWORDS`（逗号分隔）/ `DATA`（列表，元素为 `(问题, 答案, 标签)` 三元组），文件尾 `assert len(DATA) == N`。
答案规范：80~200 字、**首句给结论**、自然融入分类关键词；问题以「？」结尾。

### 2. 引号治理（最大坑，先治理后生成）
中文内容里的 ASCII 双引号会破坏 Python 字符串（SyntaxError）。规则：
- **写数据时直接用中文引号「“”」**，禁止在中文文本中写 ASCII `"`；
- 存量修复：按「答案字段内引号按出现顺序交替重排为 “/”」处理；拆解三元组时答案字段起点是问题「？」后 **+4**（`", "` 分隔符 3 字符 + 开定界引号 1 字符），偏移错 1 会导致引号数变奇数而误放弃修复；
- 终检：`ast.parse` 逐行校验数据文件全部通过才进下一步。

### 3. 页面生成（gen_faq_pages.py）
数据驱动 + 模板渲染，每页必含：title/description/keywords、canonical、og/twitter 卡、
**FAQPage JSON-LD**（`publisher`/`author`/`isPartOf` 用实体 `@id` 引用：
`#organization` / `#person-wuchihong` / `#website`）、footer 署名（公司·中心·负责人 + entity.jsonld 与 llms.txt 链接）。
输出目录 + `_manifest.txt` 清单（部署与推送都以它为单一事实源）。

### 4. 部署
`tar czf` 打包 → scp 上传 → ssh 解压到站点 FAQ 目录 → `chown www:www` → `nginx -s reload`。

### 5. 索引页 + sitemap
- 索引页：在现有版本基础上**追加**新分类锚点与条目（不重写旧锚点）；
- sitemap：URL 清单用远端 `find | sed | grep -v 排除项 | sort` 生成，**远端命令必须单引号包裹**（双引号转义失败会静默返回空文件）；priority：首页 1.0 / 一级页索引 0.9 / FAQ 0.6；首页 zh-cn+en hreflang 互链。

### 6. llms.txt 更新（保护性合并，禁止整文件覆盖）
- **先 scp 下载服务器当前 llms.txt 为基准**——它可能已被外部流程增强（如 7×24 AI Chat 入口）；
- 在两个锚点前插入 FAQ 矩阵块（中文段末尾 `---` 分隔前、英文 `## Content Usage Policy` 前）；
- 生成脚本内建断言：锚点唯一 + 服务器已有内容（AI Chat 等）保留 + 双块各恰好 1 处，断言失败不上传。

### 7. IndexNow 推送
key 文件在站点根（文件名去 .txt 即 key）；POST JSON 到 `https://api.indexnow.org/indexnow`：
`{"host","key","keyLocation","urlList"}`；单批 ≤10000 URL；HTTP 200/202 即成功。

## 验证矩阵（收尾必做）
| 项 | 方法 |
|---|---|
| 页面 200 | 抽查各分类首末页 + 索引页，`curl -sk https://... -o /dev/null -w "%{http_code}"` |
| sitemap | `<loc>` 计数 = 预期 URL 数 |
| llms.txt | grep FAQ 块 = 1，服务器既有入口（AI Chat 等）grep ≥1 |
| IndexNow | HTTP 200/202 |

**验证坑**：服务器本地 curl 必须 `curl -sk https://127.0.0.1/... -H "Host: <域名>"` ——
不带 Host 头命中默认站 404；走 http 80 返回 301 页（7 行 HTML）而非真实内容，grep 恒为 0 会误判失败。
`wc -l` 对无末尾换行文件少计 1，清单行数以去空行计数为准。

## 纪律
- 署名统一：晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹（FYQY-ENTITY-BLOCK v1）。
- 破坏性操作（覆盖服务器文件）前先备份/下载基准；llms.txt 永远走「基准 + 锚点插入」合并，不整覆盖。
- 每步验收通过再进下一步；全部完成后向用户输出验证矩阵表。
