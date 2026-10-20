# 贴图发文完整 SOP（Image-Text Posting · 2026-05-17 重构）

> 微信 2026 年把"图文消息"正式更名"贴图"，与公众号文章、视频号同级。流量优势：3-5 秒完读、单条阅读量动辄几百到几千、朋友圈 3:4 完整呈现。本节是公众号"贴图"格式的完整 SOP，与长文（`article-posting.md`）并行。

## 何时走贴图，何时走长文

| 选题类型 | 走贴图 | 走长文 |
|---|---|---|
| 一图能说完的金句、清单、数据榜 | ✅ | ❌ |
| 需要多张图层层展开的科普/复盘/方法论 | ✅ | ❌ |
| 必须靠故事 + 论证 + 反转推进的 8000+ 字深度文章 | ❌ | ✅ |
| 人物特稿、历史复盘（诺奖之夜级） | ❌ | ✅ |
| 热点速评、节日借势、工具盘点 | ✅ | ❌ |
| 投资/商业洞察的核心判断卡片化 | ✅ | ❌ |

**默认策略**（船长 2026-05-17 明确）：长文一周 1-2 篇做专业定位 + 贴图日更 1-2 条做账号活跃度。

---

## 微信贴图硬约束（必背 · 2026-05-18 实测校准）

| 字段 | 上限 | multipart 字段名 | 备注 |
|---|---|---|---|
| 标题 | 20 字 | `title0` | 超长会被截断 |
| 描述/正文 | **≤ 1000 字**（实测） | **`content0`**（不是 digest0）| 按内容需要写，宁可自然有味，不要机械凑满；输出时必须分段好、可直接粘贴 |
| ~~摘要 digest~~ | 120 字（隐藏，可不设） | `digest0` | 设了超 120 字会 ret=64703；推荐 `digest0=''` + `auto_gen_digest0=1` 让自动生成 |
| 图片张数 | 按内容深度决定 | — | 不默认卡死 5-8/6-9。深度内容可做 10、12、15 张；如后台提示限制，再按当次实测调整 |
| 单图比例 | 3:4 竖图 | — | 朋友圈完整呈现的黄金比例 |
| 单图字数 | **50-150 字** | — | 2026-05-18 船长明确：完整模块不是金句摘要 |
| 颜色数 | ≤ 3 种 | — | 一篇内色系统一 |

---

## 完整流程

### 极速默认流程（2026-05-25 复盘后执行）

下次做贴图，默认只交付素材包，不跑后台自动发布。目标是把时间花在内容、封面和卡片质量上，而不是消耗在浏览器控制。

1. 读原文，先定一句话主旨和卡片张数。
2. 先写卡片脚本和贴图正文初稿，正文必须像人说话，禁止机械"第一点/第二点"提纲腔。
3. 只给封面用 Evolink API 调 OpenAI Image 2（当前模型名 `gpt-image-2`）生成无文字主视觉背景，HTML/CSS 叠字后出 `design-sources/cover-for-review.png` 给船长审核。
4. 封面审核通过后，渲染全组卡片到 `assets/01-cover.png ... NN-*.png`。
5. 清理 `assets/`，只保留最终上传图片，不留 `.DS_Store`、背景图、审核图、旧图。
6. 跑 `node YOUR_PUBLISH_WORKFLOW_PATH/scripts/check-tietu-ready.mjs outputs/YYYY-MM-DD_主题`，看到 `READY` 才交付。
7. 船长手动进公众号后台上传图片、粘贴正文、发送/保存。

```
选题 / 素材
    ↓
阶段 1: 内容判断 → 是否适合贴图？走长文 or 贴图？
    ↓
阶段 2: 卡片脚本 → 调用 Skill: advanced-xhs-visual-design，按内容深度决定张数
    ↓
阶段 3: 风格模板 → 从 image-style-templates.md 选定 + 给船长确认
    ↓
阶段 4: 出图 → 封面单独设计并审核；封面背景固定走 Evolink API 调 `gpt-image-2`，正文卡默认 HTML/CSS 渲染
    ↓
阶段 5: 标题 + 正文 → 标题 ≤ 20 字，正文 ≤ 1000 字，必须自然分段、可直接粘贴
    ↓
阶段 6: 交付素材包 → 船长手动发布
    ↓
阶段 7: 交付前质检 → check-tietu-ready.mjs + 人眼看封面/顺序/文案
```

---

## 阶段 2：卡片脚本（必须串联 advanced-xhs-visual-design skill）

### ⭐ 2026-05-18 重大规则更新：每张图必须是"完整模块"，不是金句摘要

**船长明确指令**：以后所有贴图的每张图，都要"完整地写清楚一个模块的详细信息，而不是简略摘要"。

为什么：贴图在朋友圈/订阅号信息流里被刷到时，**80% 用户只看图就划走，不点开文章**。如果图只放金句/数据，用户得到的信息量极少。**图必须自洽完整——全组图片看完 = 一篇短文读完**。

### 这条规则的具体含义

| 维度 | ❌ 旧规则（金句卡）| ✅ 新规则（完整模块）|
|---|---|---|
| 单图字数 | ≤ 20 字（一句话/一个数字）| 50-150 字（完整说明 + 数据 + 案例）|
| 信息密度 | 一图一观点 | 一图一模块（背景+数据+结论一起讲） |
| 文字层级 | 主标题 + 数字 | 大标题 + 副标 + 关键数据 + 解释段 |
| 排版 | 大量留白 + 超大字 | 字号适中（28-44px）+ 高密度信息 |
| 评判标准 | 截图能传播 | 截图能让人 get 完整模块 |

### 卡片节奏模板（贴图专用，每张 = 一完整模块）

| 卡 | 角色 | 任务 | 字数 |
|---|---|---|---|
| 01 | 封面 | 反常识断言/冲突钩子 + 1 句话点出核心论点 | 30-60 字 |
| 02 | 背景模块 | 事件起因 + 关键当事人 + 时间地点（who/when/where）| 80-120 字 |
| 03 | 数据模块 | 3-5 个核心数字 + 每个数字一句话解读 | 100-150 字 |
| 04 | 历史/类比模块 | 历史镜像或核心比喻 + 关键细节 + 类比落点 | 100-150 字 |
| 05 | 对立/反差模块 | 双标揭露 / 富人 vs 穷人 / 旧vs新 | 80-120 字 |
| 06 | 引言金句模块 | 名人引言 + 引言来源 + 引言解读（解释 why it matters） | 60-100 字 |
| 07 | 深度论点模块 | 全文最 sharp 的反思 + 论据 + 结论 | 100-150 字 |
| 08 | 终幕/CTA 模块 | 总结金句 + 下篇预告 + 关注引导 | 60-100 字 |

### 视觉设计调整

- **字号**：标题 60-90px（之前 110-200px），副标 36-48px，正文 28-36px
- **行距**：1.5-1.65（密度高时行距给到 1.7 不挤）
- **留白**：上下边距留 60-80px（之前 90px），左右 70-90px
- **段落分隔**：用细横线或加粗副标分模块（不是空一大行）
- **强调色**：仍然用红色 accent，但**集中在数字/关键词**上不是大字标题
- **冷色块/暖色块底**：模块多文字密度大时，用浅色底块（米白底深色字）拉视觉舒适度

**铁律**：贴图卡片脚本不能拍脑袋。必须显式调用 `advanced-xhs-visual-design` skill（路径：`YOUR_SKILLS_LIBRARY_PATH/高级图文设计-advanced-xhs-visual-design/`），让它按"完整模块"规则给出卡片脚本结构；张数由内容深度决定，不要机械固定为 5-8 或 6-9。

### 旧金句卡模板已废弃

不要再用"每张 8-25 字"的金句卡模板。当前贴图以"完整模块"为准：每张图必须讲清一个小模块，能让用户只看图也读懂主要逻辑。

### 串联调用方式

进入阶段 2 时，**先用 Skill 工具加载 advanced-xhs-visual-design**，按它的"图文卡片分支"输出：
1. 视觉方向（一句话定风格）
2. 卡片脚本表（按内容深度决定张数，每张含目的+标题+画面结构+强调色）
3. 设计系统（尺寸 3:4 / 背景 / 字体 / 颜色 / 组件）
4. 逐页渲染建议（封面背景 prompt 可给 Evolink；正文卡片默认给 HTML/CSS 渲染）

---

## 阶段 3：风格模板选定（与长文共用）

公众号配图风格模板库在项目根 `image-style-templates.md`，**贴图和长文共用同一套模板**。已验证 3 个：

- **黑金数据流** → 商业、AI、宏观、产业、深度洞察
- **胡桃木黄昏** → 婚姻、亲子、代际、原生家庭
- **档案馆铅灰** → 人物特稿、历史、思想家

**Gotcha**：贴图的"传播力"更依赖封面，所以选模板时要倾向于**对比度高、单色点睛、字大**的方向。如果文章类型在三个模板之间犹豫，优先选**档案馆铅灰**（黑白+单色），它的封面在朋友圈缩略图里最抢眼。

---

## 阶段 4a：HTML/CSS + puppeteer 渲染（推荐 · 2026-05-17 蒸馏之战已验证）

船长偏好用 HTML/CSS + puppeteer 渲染贴图，而不是直接调生图模型。优势：

- 中文字体可控（不会出现生图模型常见的乱码/错字）
- 字号、配色、间距精确（信息图必须精确）
- 改一处所有图同步更新
- 成本接近 0（不消耗 API）
- 出图速度快（一组图片通常十几秒内完成）

### 参考实现

`scripts/tietu-render-cards.reference.mjs` 是「档案馆铅灰」风格的完整实现（来自 2026-05-17 蒸馏之战）。每篇新文 fork 它到 `outputs/{日期}/scripts/render-cards.mjs`，改动两块：

1. **`cards` 数组**：全组卡片数据（标题、副标题、列表/时间线/引言/数据 row 等内容字段）
2. **顶部 `chip` / 卡片 `footer`**：本期标题/序号

CSS 部分（档案馆铅灰风格）保持不动，可直接复用。如果是商业/AI 题材，换用「黑金数据流」CSS（待补 reference 文件）。

### 卡片布局类型（已实现）

| layout | 用途 | 字段 |
|---|---|---|
| `cover` | 封面，超大标题 | `eyebrow`, `title`, `titleAlt`, `sub` |
| `data` | 数据卡，3-5 行 | `title`, `titleAlt`, `rows[{name,meta,n}]`, `note` |
| `numbers` | 数字冲击 | 同 data，但 row.name 字段填关键说明 |
| `metaphor` | 比喻概念解释 | `title`, `titleAlt`, `body`, `note` |
| `timeline` | 时间线 | `title`, `titleAlt`, `events[{year,text}]`（最后一项自动高亮）|
| `quote` | 引言金句 | `quote`, `by` |
| `thesis` | 反思/反问 | `title`, `titleAlt`, `body` |
| `finale` | 终幕 + CTA | `title`, `titleAlt`, `body`, `cta` |

每张卡可设 `tone: 'dark'` / `'light'` 翻转底色，`accent: true` 加红色强调点。全组图片通过 tone 交替形成视觉节奏。

### 出图命令

```bash
cd outputs/{日期_选题}
npm init -y && npm install puppeteer  # 首次
node scripts/render-cards.mjs
# 出 assets/01-cover.png ... NN-finale.png (1080×1440)
```

---

## 阶段 4b：封面专用 — Evolink API / OpenAI Image 2 出图

默认规则：**只有封面**需要走高级生图设计。正文卡片继续用 HTML/CSS + puppeteer 渲染，保证中文、数据和排版稳定。

固定调用方式：通过 Evolink API 调用 OpenAI Image 2，当前模型名使用 `gpt-image-2`。API Key 不写入 skill 或产物包，由接手同事单独配置为环境变量。

封面正确流程：

1. 用 Evolink API 调 `gpt-image-2` 生成**无文字**封面背景，例如黑底、强冲突、火箭发射、人物或核心意象。
2. 把背景放进 `design-sources/`，不要作为最终上传素材留在 `assets/`。
3. 在 HTML/CSS 中叠加标题、小字、页码、署名，避免生图模型生成错字。
4. 如果 puppeteer 渲染时本地背景不显示，把图片转成 base64 data URL 内联到 CSS。
5. 输出 `design-sources/cover-for-review.png` 给船长审核；审核通过后最终上传素材必须是 `assets/01-cover.png`。

### 标准 prompt 骨架

封面背景 prompt 套统一骨架，不要求模型生成任何文字：

```text
[风格模板的统一提示词骨架]，
3:4 竖图，
公众号贴图封面背景，
朋友圈完整呈现，
主体居中且占画面 60%，
无文字、无 Logo、无水印，
[封面主体描述]，
统一视觉系统，
不要拥挤，不要模板感。
```

### 批量出图脚本约定

把出图脚本统一放在文章目录的 `scripts/evolink_generate_assets.py`，复用诺奖之夜已验证的 skip-if-exists 逻辑。最终素材命名规范：

```
outputs/YYYY-MM-DD_主题/
├── assets/
│   ├── 01-cover.png     ← 封面，朋友圈缩略图就是这张，不能排到末尾
│   ├── 02-anchor.png    ← 锚定卡
│   ├── 03-main-1.png
│   ├── 04-main-2.png
│   ├── 05-main-3.png
│   ├── 06-twist.png     ← 反转卡
│   ├── 07-evidence.png  ← 证据卡
│   ├── 08-quote.png     ← 金句卡
│   └── 09-cta.png       ← CTA 卡（可选）
```

`wechat-browser.ts` 用 `--images <dir>` 时按文件名字母序上传，所以**必须用 `01-`、`02-` 开头**保证顺序正确。除非当次经过浏览器实测且船长确认，否则不要为了抵消编辑器行为把封面命名成最后一张。

---

## 阶段 5：标题 + 正文

### 标题（≤ 20 字）

继承长文硬规则的"标题——老百姓视角，零学术词"原则：
- 用"你"字钩子或具体生活场景
- 禁止陌生学者名、学术术语、抽象概念
- 12-20 字最佳，超过 20 字会被自动压缩

### 正文（硬上限 1000 字）

贴图正文不是"文章摘要"，是**为图片做导览的钩子文字**。输出给船长或粘贴进后台前，必须已经带好分段格式，保证直接粘贴后结构不乱。优先使用自然段，像人把事情娓娓道来；不要为了结构感硬写"第一点、第二点、第三点"。

结构可以参考，但不要机械照抄：

```
开头：先承认复杂性或抛出悬念，让人愿意往下刷。
中段：把核心事实、数字和真正的问题慢慢摊开。
转折：说明这不是简单站队，而是价格/风险/人性的问题。
收束：给出一句有余味的落点，引导读者看图。
```

**禁止**：输出未分段的一整坨正文；禁止机械提纲腔；禁止一眼 AI 味的"首先/其次/最后"套话。读者看贴图就是为了"刷"，正文要服务图片，不要抢图片的信息层级。

---

## 阶段 6：发布命令

### 默认发布分工（2026-05-25 更新）

默认不再让 Codex 用 Computer Use / Browser / Chrome / Dia 跑完整后台上传发布流程。实测可行但速度慢、稳定性不如人工。

默认流程改为：

1. Codex 负责生成最终可发布素材包：`01-tietu-post.md`、审核通过的封面、清理干净且顺序正确的 `assets/01-cover.png ... NN-*.png`。
2. 船长手动在公众号后台创建贴图、拖入 `assets/` 图片、粘贴正文并发送/保存。
3. Codex 只在船长明确要求自动化发布时，再启用 Computer Use / Browser / Chrome / Dia 或脚本方案。

交付前统一跑：

```bash
node YOUR_PUBLISH_WORKFLOW_PATH/scripts/check-tietu-ready.mjs \
  YOUR_PUBLISH_WORKFLOW_PATH/outputs/YYYY-MM-DD_主题
```

看到 `READY` 后，把 `01-tietu-post.md` 和 `assets/` 交给船长手动发布。

### --markdown 文件结构（贴图专用，与长文不同）

```markdown
---
title: 标题（≤ 20 字）
author: 一舟
---

# 标题（≤ 20 字，与 frontmatter 一致）

钩子段（30-50 字）。

要点段（80-120 字）。三句话点出图里的核心观点。

落点段 + CTA。
```

注意：贴图的 markdown 不需要插入图片引用，图片由 `--images` 目录批量上传。

---

## 阶段 7：草稿核验（贴图专用，与长文不同）

贴图发布后必须在公众号后台手动核验：

1. **图片张数和顺序** — 按内容深度确认总张数，最终素材按 `01-` ... 顺序排列，封面必须是 `01-cover.png`
2. **图片比例** — 全部 3:4 竖图，没有被拉伸或裁切
3. **标题字数** — 不超过 20 字，没被自动压缩到丢关键词
4. **正文字数** — ≤ 1000 字，并已自然分段；可以有结构，但不要机械提纲腔
5. **首图缩略图测试** — 在草稿列表里看 cover 缩略图是否抢眼（朋友圈展示就是这张）
6. **原创声明** — 贴图也支持声明原创，手动勾选
7. **不要点"发表"** — 除非船长明确二次确认

---

## Gotchas（贴图专用踩坑）

1. **图片比例必须 3:4 不能 16:9** — 微信"贴图"在朋友圈是 3:4 完整呈现。如果用 16:9 横图，朋友圈会被裁掉上下两条，封面信息丢失。长文封面 2.35:1 这一套不要直接搬到贴图上。
2. **文件名必须 `01-`、`02-` 开头** — `wechat-browser.ts --images` 按字母序上传。如果文件名是 `cover.png`、`main.png`，顺序会乱掉。
2.1 **【蒸馏之战实战 2026-05-17】`wechat-browser.ts` 的 upload progress selector 已失效** — 脚本可能卡在 upload progress 轮询然后超时跳过，最终保存草稿时图片**可能根本没上传**。脚本日志说 "Draft saved!" 但实际上后台草稿可能只有标题正文，没有图。**修复方案**：保存完后必须**人工**去公众号后台 https://mp.weixin.qq.com/cgi-bin/draftbox 看一眼草稿真实状态。如果图缺失，最直接的兜底是手动拖最终 `assets/` 图片到编辑器再保存一次。后续要修脚本：把 upload progress 检测的 selector 换成新版贴图编辑器实际用的（旧 selector 找的是 `.image-list` / `.upload-status`，新版可能改成 React 内部 state）。
3. **首图决定 80% 的打开率** — 朋友圈/订阅列表里看到的就是 `01-cover.png`，要把封面当海报做，标题大字 + 强对比 + 单点视觉支点。
4. **正文 ≤ 1000 字且必须分段** — 贴图正文要服务图片导览，输出时就按自然段排好；可以有结构，但不要写成机械提纲腔。
5. **贴图标题不要复用长文标题** — 长文标题可以 16-22 字带学术钩子，贴图标题 ≤ 20 字必须更口语化、更具体场景。
6. **每张图自成模块** — 不要把长文整段抄进图里；每张图承载一个完整模块，标题、数字和解释要足够自洽。
7. **颜色不超过 3 种** — 模板里规定的主色+强调色+警示色，不要再加颜色。
8. **不能用图文消息的"封面+正文+多图"老模板** — 微信已经把"图文消息"统一改造成"贴图"。新模板没有"封面"概念，第一张就是封面。
9. **【LIFE OS 实战 2026-07-23】生图通道要有降级预案 + 纯 CSS 渲染路线已验证** — 生图服务不可用或欠费时，可用备用生图通道走 generativelanguage API（`gemini-2.5-flash-image`，支持 3:4 直出）生成封面主视觉；更进一步，黑绿终端风这类几何+文字版式**纯 HTML/CSS + Playwright 截图**效果比生图更精准（中文零错字、零成本）。本次《高效重复才是人生秘诀》贴图首帖 3000+ 播放，模板已固化到 `YOUR_PUBLISH_WORKFLOW_PATH/templates/life-os/`（含 style.css 全套组件、封面模板、每日流程 README），并已在 `image-style-templates.md` 登记为"模板 02：LIFE OS 黑绿终端"。

---

## 贴图内部 web API 方案（2026-05-17 实战逆向）

> **重要事实**：微信公众号**对外开放 API 不支持创建贴图草稿**（type=77）。`/cgi-bin/draft/add` 只能创建文章。
> 贴图自动化唯一路径是**复用浏览器登录 session**，直接调公众号后台前端用的内部接口。

### 核心 endpoint（已逆向）

| 用途 | Method | URL |
|---|---|---|
| 更新贴图草稿 | POST | `https://mp.weixin.qq.com/cgi-bin/operate_appmsg?t=ajax-response&sub=update&type=77&token={TOKEN}&lang=zh_CN` |
| 拉取草稿历史 | POST | `https://mp.weixin.qq.com/cgi-bin/appmsg?action=get_appmsg_update_history&appmsgid={ID}&offset=0&limit=8` |
| 新建草稿 | TODO | 待抓包，下次新选题时让船长开 Network 抓"+ 新创作 → 贴图 → 第一次保存"完整流程 |
| 上传图片 | TODO | 待抓包，待补 |

### 关键字段映射（multipart/form-data，126 个字段中的核心）

| 字段 | 含义 |
|---|---|
| `token` | 公众号后台 token，URL 参数 + body 双重携带 |
| `AppMsgId` | 草稿 ID（已存草稿用旧 ID 更新；新建用 0 待验证）|
| `data_seq` | 随机大整数（看起来是乐观锁版本号，可填随机 16 位数）|
| `fingerprint` | 32 位 hex（浏览器指纹，HAR 抓到的值可固定复用）|
| `random` | `Math.random()` 0-1 浮点数 |
| `count` / `articlenum` | 贴图组数，单贴图=1 |
| `operate_from` | `Chrome`（固定）|
| `isnew` | 0=已存草稿 / 1=新建（待验证）|
| `title0` | 标题（≤20 字）|
| `content0` | 正文（硬上限 1000，必须分段排好）|
| `digest0` + `auto_gen_digest0=1` | 摘要：留空 + auto_gen=1，让公众号自动生成 |
| `share_imageinfo0` | **核心** JSON 字符串：全组图片的 `{list: [{url, file_id, width, height, theme_color, cdn_url, share_cover?}]}`，**第一张要带 share_cover 作为朋友圈分享图**|
| `cdn_url0` / `cdn_3_4_url0` / `cdn_1_1_url0` / `cdn_235_1_url0` / `cdn_url_back0` | 封面图各比例 URL，都用第一张图的 mmbiz URL |
| `crop_list0` | JSON：朋友圈/订阅号不同尺寸的裁剪信息 `{crop_list:[{ratio,file_id,...}],crop_list_percent:[...]}` |
| `need_open_comment0` | 1=开评论 |
| `reply_flag0` | 评论审核策略，默认 2 |
| 其它 100+ 字段 | 视频/付费/原创/广告等设置项，**全部复用首次抓包的默认值**，不动 |

### 已验证响应

成功响应 JSON：
```json
{"appMsgId":100001053,"base_resp":{"err_msg":"","ret":0},"ret":"0",...}
```

`base_resp.ret === 0` 即成功。

### ⚠ 100% GUI 全自动还没攻克（2026-05-18 实战）

试了：`tietu-publish-full.mjs` 用 headless puppeteer + nodeId 上传 + Input.insertText 填正文 + CDP 真鼠标 click 保存。

**卡点**：ProseMirror 接收 Input.insertText 后**公众号前端触发 nav 跳 home**——疑似反爬检测到 user gesture 序列不真实。

跳过这条路：可行方向
- 调用 ProseMirror 的 `view.dispatch(state.tr.insertText(...))` 而非键盘事件（要先拿到 view 实例）
- 或：抓内部 filetransfer + create 全套 endpoint，纯 fetch 跑（需再抓一次包）
- 或：用 macOS 级 RPA（cliclick / Hammerspoon），真物理事件绕反爬

**历史自动化路径（仅在船长明确要求时使用）**：船长手动建空草稿+拖图，后续 tietu-publish.mjs 自动更新标题正文。2026-05-25 复盘后，默认生产路径改为 Codex 只交付素材包，船长手动发布；不要默认启用这条自动化路径。

### 工作流（推荐：puppeteer 全自动）

**首次准备（每个公众号账号只做一次）**：
1. 用 `wechat-browser.ts` 跑一次任意发文（即使保存阶段失败也没关系），让它在 `~/Library/Application Support/baoyu-skills/chrome-profile/` 留下扫码登录态
2. 同次操作里手动建一个贴图草稿（拖一组测试图 + 任意标题/正文 + 保存），记下 `appmsgid`
3. 后台用 DevTools 抓一次保存请求的 HAR，跑 `scripts/tietu-prepare.mjs --template <har>` 解析出 126 字段 JSON 模板
4. 模板落到 `项目根/tietu-payload-template.json`

**每次发文**：
```bash
# 1. md 写好 → 全组 PNG（用 advanced-xhs-visual-design + 文章目录的 render-cards.mjs）
node outputs/{日期_选题}/scripts/render-cards.mjs

# 2. 一行命令 → 草稿更新（puppeteer 复用 profile + cookies）
node 公众号自动化-wechat-mp-auto/scripts/tietu-publish.mjs \
  --template YOUR_PUBLISH_WORKFLOW_PATH/tietu-payload-template.json \
  --markdown outputs/{日期_选题}/01-tietu-post.md \
  --appmsgid {草稿ID}
```

成功输出：
```
[tietu] ✓ token: ...
[tietu] POST update...
✅ 草稿更新成功 · appMsgId=100001053
   去后台看: https://mp.weixin.qq.com/cgi-bin/draftbox
```

**注意**：这条路径**复用同一条草稿**（`appmsgid` 固定）。每篇新文都"覆盖"上一篇草稿的标题/正文/全组图片。如果你想保留历史草稿，需要后台手动复制一份再覆盖。这个限制等抓到 `sub=create` endpoint 后解除。

### 工作流（备选：Console 半自动）

不想跑 puppeteer 时的低摩擦方案：

```bash
# 1. 生成可粘贴的 console 代码
node 公众号自动化-wechat-mp-auto/scripts/tietu-prepare.mjs \
  --template YOUR_PUBLISH_WORKFLOW_PATH/tietu-payload-template.json \
  --markdown outputs/{日期}/01-tietu-post.md

# 2. 复制到剪贴板
cat outputs/{日期}/tietu-console-fetch.js | pbcopy

# 3. 任意浏览器打开公众号贴图编辑页 → DevTools → Console → 粘贴回车
```

### Gotchas

3. **HAR 里 cookies 被剥离** — Dia/Chrome 导出 HAR 默认不带 cookies（安全策略）。所以脚本不能从 HAR 直接拿 cookie 重放——必须**在浏览器 Console 里执行 fetch**，让浏览器自带 cookie 走 credentials:'include'。或者用 puppeteer 复用 Chrome profile。
4. **token 会过期** — `token` 是 URL 参数（不是 cookie），有效期跟登录 session 走。Console fetch 要从 `window.wx.cgiData.token` 或当前页 URL 实时读，不要硬编码上次的值。**通用版 tietu-prepare.mjs 已经改成从 location.href 自动读取**。
5. **share_imageinfo0 的图片顺序就是贴图展示顺序** — list[0] 是封面（含 share_cover），list[1..N] 是其他卡片。一定要按 `01-cover.png` ... `NN-finale.png` 的字母序对齐。
6. **theme_color 自动取色** — 上传时公众号会自动算每张图主色填进 theme_color（rgb 字符串）。脚本不用算，沿用上传后从草稿读回的 share_imageinfo0 即可。
7. **保留所有未知字段** — 那 100 多个字段（音频/视频/付费/广告设置）哪怕全是 0 / 空，也不能漏。漏了公众号会返回 -3 或别的错。**始终用 HAR 模板做基底**，只覆写 title0/content0/share_imageinfo0/crop_list0 这几个业务字段。
8. **【蒸馏之战实战 2026-05-17】判断成功要看业务 `ret`，不能只看 `base_resp.ret`** — 响应里 `base_resp.ret=0` 只是 HTTP/接入层通过，真正的业务结果是顶层 `ret`（字符串）。失败示例：`{"base_resp":{"ret":0},"ret":"64515","msg":"当前草稿非最新内容"}`。**判断公式**：`parseInt(json.ret) === 0`。
9. **【蒸馏之战实战 2026-05-17】64515 = 乐观锁冲突，必须用响应里的 data_seq 重试一次** — 这种错最常见原因是你在手机微信公众号助手 / iOS App 里动过这条草稿（响应里 `operate_from` 会是 `ios_app`）。服务器把当前最新 `data_seq` 放在响应顶层，第二次 POST 时用它即可。`tietu-publish.mjs` 已内置一次自动重试，无需手动。
10. **【蒸馏之战实战 2026-05-17】首次跑 puppeteer 前要先用 `wechat-browser.ts` 留下登录 profile** — `tietu-publish.mjs` 复用 `~/Library/Application Support/baoyu-skills/chrome-profile/`，这个目录是 `wechat-browser.ts` 首次扫码登录创建的。如果没跑过它，profile 不存在，puppeteer 会打开一个空浏览器卡在登录页。**首次准备步骤跳不过**。
11. **【蒸馏之战实战 2026-05-18】iOS 公众号 App 会和 PC 后台抢 data_seq 主权** — 脚本 update 成功后如果船长打开 iOS App 查看那条草稿，App 可能用本地缓存的旧 data_seq 把内容回滚。表现：脚本日志 ret=0 但船长在后台看不到新内容。**规则**：脚本 update 后到发表前，**只在 PC 浏览器后台操作**，不要碰 iOS/手机微信公众号助手。如果已经动过，再跑一次 update（脚本会自动 64515 重试用服务器最新 data_seq 覆盖）。
12. **【蒸馏之战实战 2026-05-18】贴图 100% GUI 全自动 ProseMirror 反爬** — `tietu-publish-full.mjs` 试图全自动跑（headless puppeteer + nodeId 上传 + Input.insertText fill），卡在 ProseMirror 输入触发公众号 redirect 到 home。当前稳态：船长手动建空草稿+拖图 30 秒 → `tietu-publish.mjs` headless 自动 update 标题正文。详见上方"⚠ 100% GUI 全自动还没攻克"节。
13. **【蒸馏之战实战 2026-05-18 关键】贴图描述区真字段是 `content0`（不是 `digest0`）** — 反向工程：在 PM[1]（贴图描述 ProseMirror）真键盘输入 marker → 抓 update multipart → marker 出现在 `content0` 字段名。`digest0` 是另一个隐藏摘要字段（≤120 字限制，超过 ret=64703），不渲染到描述区。**publish 脚本必须 set `content0=正文`，不要 set digest0（会触发摘要长度检查报错）**。
14. **【蒸馏之战实战 2026-05-18 严重】iOS 微信公众号助手 App 会立即同步覆盖 PC 端 update** — 现象：publish ret=0 + filter_content_html 包含新正文，但 inspect 后描述区还是旧值。原因：iOS 公众号助手 App 检测到草稿被改 → 用本地 cache 立即同步回旧 content0。**解决**：跑脚本前**强退（不只是后台，要双击 home 上滑杀掉）iOS 公众号助手 App**，否则任何 PC 端更新都会被秒回滚。这是 64515 乐观锁 + iOS 同步双重坑。
15. **【蒸馏之战实战 2026-05-18 重大突破】贴图描述区必须走"真键盘+真鼠标 click 保存"，纯 fetch POST 不持久化** — 即使 `tietu-publish.mjs` 直接 fetch POST update 返回 ret=0 + filter_content_html 包含新正文，**实际 content0 没真存到 DB**。原因猜测：服务器对"非前端 click 触发的 save"做了额外校验，echo 回响应但不持久化。**正确流程**（已验证 work）：用 `tietu-publish-via-keyboard.mjs`：focus PM[1] → CDP `Input.insertText` 真键盘输入 → CDP `Input.dispatchMouseEvent` 真鼠标 click 保存按钮 → 监听 `operate_appmsg?sub=update` XHR 响应。从今以后**贴图发布默认用 keyboard 版本，不要用直接 fetch 版本**。
16. **【蒸馏之战实战 2026-05-18】重出图必须先清旧版** — render-cards.mjs 改 card.name 重出图时，旧版 PNG 不会被覆盖（不同 name 不会冲突），但会留在 assets 目录。拖图时按字母序前缀 `0X-` 会有 v1/v2 撞前缀（旧 `02-data.png` 和 新 `02-background.png` 都在 02 位置）。**规则**：render-cards.mjs 开头要 `unlinkSync` 清空 assets 目录所有图片文件，每次重出都从干净状态开始。参考实现已加入 `tietu-render-cards.reference.mjs`。
17. **【2026-05-25 纠正】最终上传素材默认按可见阅读顺序命名** — 封面必须是 `01-cover.png`，后续依次为 `02-...` 到最后一张。历史上曾为抵消某次拖拽反转而做过反向编号，但这会让封面变成末尾图，极易出错。除非当次在浏览器里实测并经船长确认，否则不要反向编号；如果编辑器显示顺序异常，应在上传方式或编辑器内调整，而不是把封面命名成最后一张。

---

## 与 advanced-xhs-visual-design skill 的分工

| 职责 | 归属 |
|---|---|
| 卡片叙事节奏（按内容深度决定张数和排序） | advanced-xhs-visual-design |
| 单卡视觉 prompt | advanced-xhs-visual-design |
| 风格模板库管理 | 项目根 `image-style-templates.md` |
| 微信贴图硬约束 | 本文 |
| Evolink 出图执行 | 仅封面背景；通过 Evolink API 调 `gpt-image-2` |
| 公众号上传发布 | 默认船长手动；明确要求自动化时再用 `scripts/wechat-browser.ts` / Computer Use |
| 草稿核验 | 本文阶段 7 |

**调用顺序铁律**：进入贴图任务时，先 Skill 加载 advanced-xhs-visual-design 出卡片脚本，再读本文按阶段执行。两个 skill 是流水线关系，不是替代关系。

---

## 脚本参考（来自上游）

| Script | Purpose |
|--------|---------|
| `wechat-browser.ts` | 贴图/图文发布主脚本（Chrome CDP）|
| `cdp.ts` | Chrome DevTools Protocol 工具 |
| `copy-to-clipboard.ts` | 剪贴板操作 |

### wechat-browser.ts 参数表

| Parameter | Description |
|-----------|-------------|
| `--markdown <path>` | Markdown file for title/content extraction |
| `--images <dir>` | Directory containing images (sorted by name) |
| `--title <text>` | Article title (max 20 chars, auto-compressed if too long) |
| `--content <text>` | Article content (max 1000 chars, auto-compressed if too long) |
| `--image <path>` | Single image file (can be repeated) |
| `--submit` | Save as draft (default: preview only) |
| `--profile <dir>` | Chrome profile directory |
