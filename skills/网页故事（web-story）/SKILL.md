---
name: web-story
description: 把一个选题、想法或研究目标做成单页叙事网页（手机+电脑双端适配）。当用户说"把这个选题做成网页"、"做个网页介绍"、"把研究结果做成网站"、"做个观察站/指南页/落地页"、"网页故事"、或给出一个主题要生成可视化网页时触发。轻流程：接题 → 拆叙事 → 套模板做视觉 → 双端验收 → 平台内生优先部署。不适用于 PPT/slides、多页复杂站点、海报/平面设计。
---

# 网页故事 web-story

把一个选题变成一个能给人看的单页网页：叙事清楚、视觉干净、交互简单，手机和电脑都适配，并且能交付到对方打得开的地方。

## 核心定位

- 产物形态：**单页叙事长滚动**——一个 `index.html`，hero + 锚点导航 + 5~9 个章节 + 页脚。
- 适用：研究观察站、指南/榜单、项目/网站介绍、课程专题页、活动落地页。
- 不适用：PPT/slides、多页站点、需要后端/登录/支付的应用、海报平面设计。

## 工作流

### 1. 接题

开工前锁定三件事：**给谁看**、**必须出现的事实**（数据要真实并标来源）、**看完想要什么行动**。能从上下文确认的信息不要反问用户。

### 2. 拆叙事

读 `references/narrative-patterns.md`，按选题类型选一类骨架（研究站 / 指南榜 / 项目介绍 / 课件专题），拆成 5~9 个章节，每章一个论点，配锚点导航。先确认大纲再做视觉。

### 3. 套模板做视觉

1. 复制 `assets/template/` 作为项目起点（模板已内置移动优先布局、锚点导航、卡片、页脚）。
2. 视觉原则读 `references/design-system.md`（一页框架清单）。
3. 移动优先写 CSS，桌面端做加法；动效用 CSS transition 级别的最轻方案。
4. 动手前过一遍 `references/pitfalls.md` 的避坑清单。

### 4. 验收（建议执行）

需要 Node.js，并先在项目里装一次 playwright（`npm i playwright`）：

```bash
node <skill>/scripts/validate-content.mjs --root .
node <skill>/scripts/web-qa.mjs --root .
```

通过标准：桌面 1440、平板 768、手机 430/390/375/320 无横向溢出；控制台零错误；图片全部加载成功；可点元素高度 ≥42px；截图自动存入项目 `EVIDENCE/`。有特定探针时在项目根写 `qa.expect.json`（选择器 → 预期数量），web-qa 自动比对。

### 5. 部署路由（平台内生优先，逐级降级）

先干跑确认走哪条路：`node <skill>/scripts/deploy-plan.mjs --root .`

| 优先级 | 条件 | 动作 |
|---|---|---|
| a | 当前环境有内生网页能力（如 Agent 平台自带托管） | 直接生成平台内可访问网页 |
| b | 环境能生成公网链接（内置分享或隧道） | 生成公网 URL 并验证 |
| c | 项目 `settings.json` 配置了自有域名/云存储 | 走正规部署（对象存储+CDN，或 Vercel） |
| d | 都没有 | 交付本地 `index.html` 并打开预览，附上线指引 |

详见 `references/deployment.md`。凭证只读本机已有配置，不要写进任何项目文件；公网部署后必须读回验证（状态码 + 字节数）。

## 输出格式

最终交付：页面文件路径、验收结果（各视口通过情况）、部署方式与访问地址（或本地打开方式）、已知缺口。

## 什么时候读 references/

| 时机 | 必读文件 |
|---|---|
| 拆章节大纲前 | `references/narrative-patterns.md` |
| 做视觉前 | `references/design-system.md` |
| 写 CSS/调布局前 | `references/pitfalls.md` |
| 部署前 | `references/deployment.md` |

## Gotchas

- 不要直接改 skill 里的模板——先复制到项目目录再动。
- 手机端验收必须覆盖 320px，很多溢出只在 320 才暴露。
- 首屏关键图用 `loading="eager"`；首屏高度用 `min-height:min(88svh, 860px)` 这种带上限的写法。
- 页面 JS 渲染完成后设 `document.documentElement.dataset.ready='true'`，验收脚本靠它判断页面就绪。
