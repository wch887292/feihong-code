# 暗黑科技小红书图文设计系统

用于复刻“高端科技发布页 + 终端窗口 + 信息图卡片”的小红书竖版图文效果。

## 一句话风格

像一份被拆成小红书卡片的 AI 产品发布会 release notes：黑底、荧光高亮、终端窗口、数据卡、时间线、大字号中文判断。

## 画面 DNA

### 必备元素

- 深黑背景，不是纯平黑，要有细微噪声、扫描线、暗纹或网格。
- 1 个超大中文标题，形成第一视觉锚点。
- 1 个“终端窗口 / dashboard / timeline / stats card”主组件。
- 小号英文标签：`CORE UPDATE`、`MODEL TIMELINE`、`NUMBERS`、`STRATEGY`、`RELEASE NOTES`。
- 局部荧光色：绿为主，黄/青/粉为辅助。
- 底部状态条、日期、版本号、命令行、短结论，增强“技术发布感”。

### 不要做

- 不要满屏装饰线条。
- 不要用廉价蓝紫渐变铺底。
- 不要把每个盒子都做成玻璃拟态。
- 不要放随机 3D 图标、机器人、小人、科技城市背景。
- 不要让中文文字太小或太多。

## 尺寸与网格

- 推荐尺寸：`1080 x 1440`，小红书 3:4。
- 安全边距：左右 `70-90px`，顶部 `70-110px`，底部 `80-120px`。
- 主内容宽度：`900-940px`。
- 垂直节奏：
  - 顶部标签区：60-90px 高。
  - 大标题区：220-360px 高。
  - 主组件区：350-550px 高。
  - 底部结论/状态区：80-160px 高。

## 字体规则

中文标题：

- 粗黑体、超大、压迫感。
- 字重：800-900。
- 字号：封面 120-180px；正文页 86-130px。
- 行距：0.95-1.08。

中文正文：

- 中黑体或苹方/思源黑体。
- 字号：32-44px。
- 行距：1.35-1.55。

英文与代码：

- 等宽字体。
- 字母间距可以略大。
- 字号：22-34px。
- 用于标签、命令、日期、版本、状态条。

## 色彩系统

基础色：

- 背景黑：`#070908`
- 卡片黑：`#151716`
- 边框灰：`#2B302E`
- 正文白：`#ECEEEE`
- 次级灰：`#8B9299`

强调色：

- Codex 绿：`#00F58A`
- 数据黄：`#FFD84D`
- 赛博青：`#2ED9FF`
- 警示粉：`#FF5EBB`
- Claude 橙：`#FF7A45`
- 紫蓝发光：`#A56BFF` / `#6EA8FF`

使用比例：

- 黑/灰：80-88%
- 白字：8-12%
- 主强调色：4-8%
- 辅助强调色：1-3%

## 组件库

### A. 终端窗口

适合：功能更新、操作电脑、命令流、流程演示。

结构：

- 顶部 macOS 三色圆点。
- 标题栏：`codex · background computer-use`。
- 内容区：命令行 + 输出行。
- 输出行使用箭头、勾、进度点。

示例文案结构：

```text
$ codex("打开 Figma 导出所有画板")
  -> 打开 Figma.app ✓
  -> 导出 24 个画板 ✓

$ codex("测 iOS 登录流程")
  -> 逐步点击模拟器 ...
  ✓ 3/4 用例通过
```

### B. 巨型标题页

适合：封面、强观点、章节页。

结构：

- 顶部小标签：`[ 01 / CORE UPDATE · 2026.04 ]`
- 大标题 2-3 行，关键词用绿色/青色/黄色。
- 副标题用 `//` 开头，像代码注释。
- 下方放一个宽终端框或 before/after 对比框。

### C. 时间线卡

适合：产品演进、公司战略、模型迭代。

结构：

- 5 个以内节点。
- 日期左对齐，事件右对齐。
- 最新节点加 `LATEST` 标签。
- 用细分割线保持秩序。

### D. 数据三联卡

适合：增长、速度、收入、转化、市场规模。

结构：

- 横向 3 张卡。
- 每张卡一个指标：大数字 + 2 行解释。
- 每张卡左侧一条彩色竖线。
- 绿/黄/粉分别对应用户、增长、效率。

### E. 底部结论条

适合：每页收束。

结构：

- 半透明深绿色或深灰矩形。
- 左侧放关键词，右侧放结论。
- 文案 1-2 行，不超过 40 字。

### F. Claude / Design 紫橙变体

适合：Claude、设计工具、Figma、应用构建器相关选题。

结构：

- 背景仍然深黑，但中心可以有紫蓝柔光。
- 主强调用橙色，组件边框用紫蓝霓虹。
- 适合三块功能卡、产品矩阵、下跌/冲击图。
- 注意：发光只在边框周围，不要铺满全图。

## 卡片类型模板

### 01 封面

目的：让用户停住。

必须有：

- 6-14 字主标题。
- 1 个强变化判断。
- 1 个小终端窗口或 before/after 组件。
- 3 个数字/标签可选。

标题公式：

- `X 大变身`
- `X 来了，Y 慌了`
- `不是 A，是 B`
- `一年走完 N 级跳`
- `从 A 到 B`

### 02 核心更新

目的：解释发生了什么。

结构：

- 顶部章节标签。
- 大标题：`能操作你的电脑了，不只是写代码`
- 中部终端窗口，展示 2 个具体任务。
- 底部能力标签：`COMPUTER_USE`、`BROWSER`、`IMAGE_GEN`、`MEMORY`。

### 03 时间线

目的：给变化找历史坐标。

结构：

- 大标题：`一年走完五级跳`
- 中部 timeline。
- 底部一句关键判断。

### 04 数字页

目的：证明增长或冲击。

结构：

- 大标题：`用户增长疯了`
- 3 个数据卡。
- 终端风增长列表。
- 底部 trend 状态条。

### 05 战略页

目的：给出你的独家判断。

结构：

- 大标题：`不止是写代码，这是 X 的终局`
- 中部树状结构/系统图。
- 下方引用式判断。
- 底部 next 状态条。

### 06 收束页

目的：让用户收藏/转发。

结构：

- 顶部完成状态：`[ ✓ ] UPDATE · DONE`
- 中央一句话总结。
- 3 个时间/阶段小卡。
- 底部 release notes 风格签名。

## Prompt 骨架

```text
Create a premium vertical Xiaohongshu infographic card, 1080x1440, dark technology release-notes style. Matte black background with subtle CRT scanlines, fine noise texture, faint grid, editorial spacing. Huge bold Simplified Chinese headline, clear readable text, one main dashboard/terminal/timeline component, neon green accent with small yellow/cyan/pink highlights, monospaced English labels, product launch aesthetic, high-end AI developer tool visual system.

Page content:
- Top label: "[ 01 / CORE UPDATE · 2026.04 ]"
- Main headline: "能操作你的电脑了，不只是写代码"
- Supporting line: "// Background computer use: 用自己的光标看、点、打字"
- Main component: macOS-style terminal window showing two command examples and green success outputs
- Bottom tags: "[✓] COMPUTER_USE", "[+] IN-APP BROWSER", "[+] IMAGE_GEN", "[+] MEMORY"

Design constraints: all Simplified Chinese text must be crisp and readable; strong hierarchy; generous margins; no random icons; no people; no 3D mascot; no cheap cyberpunk; no clutter; no illegible text; no overdone glow.
```

## HTML/CSS 渲染建议

如果对中文准确性要求高，优先不要纯生图。用 HTML/CSS 生成卡片：

- HTML/CSS 负责所有中文、版式、组件。
- 生图只生成背景纹理或装饰图层。
- 用 Playwright 截图导出 `1080x1440` PNG。

CSS 关键点：

```css
body {
  width: 1080px;
  height: 1440px;
  background:
    linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px),
    radial-gradient(circle at 50% 30%, rgba(0,245,138,.12), transparent 32%),
    #070908;
  background-size: 100% 4px, 100% 100%, 100% 100%;
  color: #eceeee;
  font-family: "PingFang SC", "Noto Sans CJK SC", sans-serif;
}
.mono { font-family: "SF Mono", "JetBrains Mono", monospace; }
.accent { color: #00f58a; }
.panel {
  background: #151716;
  border: 1px solid #2b302e;
  border-radius: 10px;
  box-shadow: 0 0 40px rgba(0,245,138,.06);
}
```

## 质检清单

发布前逐项检查：

- 远看 2 秒内能读出主标题。
- 每页只有一个视觉中心。
- 中文无乱码、无错字、无断行尴尬。
- 荧光色没有超过画面 10%。
- 组件之间对齐清楚，边距一致。
- 数据和日期已核验，或明确标注为示意。
- 一组图里至少 3 种页面结构，不是同一模板复制 8 次。
- 封面强，正文清楚，结尾有观点。

