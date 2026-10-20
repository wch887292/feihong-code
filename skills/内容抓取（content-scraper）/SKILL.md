---
name: content-scraper
description: Scrapes full content from social media platforms (XHS, Weibo, Zhihu, Bilibili, X/Twitter) including truncated text, metadata, and comments when user provides a content URL or search query.
---

# 内容抓取（Content Scraper）

## 核心定位

针对主流中文和国际社交媒体平台，处理登录墙、内容截断、动态加载等平台特有问题，提取完整正文、元数据和评论，输出结构化 JSON。

依赖 browser-automation skill 作为底层执行引擎。

---

## 触发场景

- 用户提供内容 URL，要求获取全文（包括被截断的部分）
- 用户要求批量抓取多个链接
- 用户要求抓取评论区数据
- 用户要求抓取某平台的搜索结果

---

## 工作流

### Step 1：URL 解析与平台识别

```
URL 模式 → 平台：
xiaohongshu.com / xhslink.com        → 小红书（XHS）
weibo.com / m.weibo.cn / weibo.cn    → 微博
zhihu.com                            → 知乎
bilibili.com / b23.tv                → Bilibili
x.com / twitter.com                  → X/Twitter
```

短链接（b23.tv, xhslink.com）先跟随重定向获取真实 URL，再识别平台。

如 URL 不在支持列表中，告知用户并建议使用 browser-automation skill 自定义抓取。

### Step 2：登录状态检查

导航到 URL 后立即 snapshot，检查是否出现登录墙关键词：
```
["登录", "注册", "Sign in", "Log in", "继续阅读", "查看完整内容", "关注后查看"]
```

如检测到登录墙：
1. 检查真实浏览器模式下是否已有 session（重新加载页面后内容正常显示）
2. 如无 session，暂停并提示：
   ```
   {平台名} 需要登录才能查看完整内容。
   请在已打开的浏览器中完成登录，完成后告诉我继续。
   ```
3. 用户确认后，重新导航并继续

### Step 3：平台特定抓取

---

#### 小红书（XHS）

**已知限制：**
- 正文超过约 1000 字符时，帖子列表页截断，详情页显示"...展开"按钮
- 图文笔记（文字在图片中）无法从 DOM 提取文字，需标注
- PC 端（www.xiaohongshu.com）比移动端更易抓取

**抓取步骤：**
```
1. navigate(笔记 URL)，确保是详情页而非列表页
2. snapshot()
3. 检查是否有"展开"按钮 → click 展开完整正文
4. 提取：
   标题：h1 或 .note-title
   正文：.note-text（多段落需逐段拼接，保留换行）
   图片数量：轮播图中 img 标签数量
5. 提取数据指标：
   点赞：.like-wrapper .count
   收藏：.collect-wrapper .count
   评论：.comment-count
6. 提取发布时间（可能是相对时间"3天前"，记录并标注）
7. 评论抓取：
   scroll 到评论区等待加载
   提取可见评论（作者名 + 内容 + 点赞数）
   检查"查看更多评论"→ click → 继续提取
   二级回复需 click"查看回复"后提取
   建议上限：50 条评论
```

---

#### 微博（Weibo）

**已知限制：**
- 超长微博在列表页截断，必须进入详情页
- 转发微博需同时抓取原微博内容
- 评论分"热门"和"最新"两个 tab，内容不同
- 部分内容需关注博主才能查看

**抓取步骤：**
```
1. 将 m.weibo.cn URL 转换为 weibo.com（PC 端内容更完整）
2. navigate(详情页 URL)
3. snapshot()
4. 检查是否有"展开"→ click
5. 提取：
   正文：.weibo-text（注意区分正文和话题标签）
   转发结构：检查 .retweet 块；如有，分别提取转发者语和原微博
   发布时间：.time（格式多变，可能是时间戳/相对时间/完整日期）
   互动数据：转发数、评论数、点赞数
6. 评论（如需）：
   切换到"热门评论" tab → 提取 30 条
   切换到"最新评论" tab → 提取 20 条
   每条记录：作者、内容、点赞数、发布时间
```

---

#### 知乎（Zhihu）

**已知限制：**
- 问题页默认只展开 3 个回答，其余折叠
- 每个回答在问题页折叠超过约 600 字（需 click"查看全文"）
- 专栏文章通常完整展示，无需展开
- 被折叠的回答（违规内容）不应尝试展开

**问题页抓取：**
```
1. navigate(问题 URL)
2. snapshot() 识别回答列表
3. 对每个目标回答：
   click "阅读全文" 或 "查看全部" 展开
   提取：作者（姓名 + 简介）/ 正文 / 赞同数 / 评论数 / 发布时间
4. click "更多回答" 加载（最多 3 批次，避免过长）
```

**专栏/文章抓取：**
```
1. navigate(文章 URL)
2. snapshot()
3. 直接提取正文（通常无截断）
4. 提取：标题 / 作者 / 发布日期 / 阅读量 / 点赞数
5. 评论：click 展开评论区 → 提取前 30 条
```

---

#### Bilibili

**已知限制：**
- 视频简介（description）经常截断，需 click"展开"
- 弹幕和评论是两个不同数据源，用途不同
- 大会员内容可抓元数据，但无法获取视频
- 视频转写（字幕）需使用 video-transcribe skill

**视频页抓取：**
```
1. navigate(bilibili.com/video/BV... 格式的 URL)
2. snapshot()
3. 提取：
   标题：h1.video-title
   UP 主：.up-name
   播放量 / 弹幕数 / 评论数 / 发布日期
   简介：click"展开" → 提取 .desc-info 完整文本
   分 P 信息：如有多 P，记录 P 列表
4. 评论（如需）：
   scroll 到评论区等待加载（Bilibili 评论需要登录）
   提取前 20 条热门评论（作者 / 内容 / 时间 / 点赞数）
```

---

#### X / Twitter

**已知限制：**
- 未登录状态只能看有限内容
- 推文超过字数限制时有"Show more"链接
- 线程（Thread）需逐条展开，URL 通常指向最后一条
- 转推（Retweet）和引用推文（Quote Tweet）结构不同

**抓取步骤：**
```
1. navigate(x.com/username/status/ID)
2. snapshot()
3. 检查是否有"Show more"→ click 展开
4. 提取：
   正文（完整）
   作者（display name + @handle）
   发布时间（ISO 8601 格式）
   转推数 / 回复数 / 点赞数 / 书签数
   媒体类型和数量（图片/视频/链接预览）
5. 线程检测：
   检查"Show this thread"链接
   如是线程，从最早推文开始按时间顺序重建
6. 回复（如需）：
   scroll 加载回复
   提取前 20 条（作者 / 内容 / 点赞数）
```

### Step 4：限流与操作节奏

```
基本原则：
- 每次页面操作后随机等待 1-2 秒（避免规律性请求）
- 批量抓取：每 10 个 URL 暂停 30 秒
- 检测到"访问太频繁" / "操作频繁"：暂停 5 分钟后继续

绝对不做：
- 绕过验证码
- 使用代理池模拟高频请求
```

---

## 输出格式

```json
{
  "platform": "xiaohongshu",
  "url": "https://...",
  "scraped_at": "2026-04-01T10:30:00Z",
  "content": {
    "title": "标题（如有）",
    "body": "完整正文，换行保留",
    "media_count": 9,
    "media_type": "image"
  },
  "author": {
    "name": "用户昵称",
    "handle": "@username（如有）"
  },
  "metadata": {
    "published_at": "2026-03-15（或相对时间：3天前，需标注）",
    "likes": 1234,
    "comments": 89,
    "shares": 45,
    "views": 56789
  },
  "comments": [
    {
      "author": "评论者昵称",
      "body": "评论内容",
      "likes": 12,
      "time": "2天前"
    }
  ],
  "truncation_warning": null
}
```

如内容无法完整获取，在 `truncation_warning` 字段说明原因（如"需要大会员"/"内容在图片中"）。

---

## Gotchas

**XHS 图文笔记文字在图片中**
- 部分 XHS 笔记将全部文字作为图片发布，DOM 中无文本节点
- 此类内容 DOM 提取结果为空，不是 bug → 在输出中标注"内容在图片中，无法提取文字"
- 如用户需要图片文字，建议对接 OCR API 单独处理

**微博相对时间记录规范**
- "刚刚" / "X分钟前" / "X小时前" → 记录抓取时间 + 相对时间，不要转换（容易出错）
- "04-01" → 今年 4 月 1 日（非绝对时间）
- 批量抓取时统一处理策略，在输出中标注哪些时间是相对时间

**知乎违规折叠内容**
- 知乎会折叠违反社区规范的回答，显示"以下内容已被折叠"
- 此类内容不应尝试展开，直接跳过，在输出中记录"该回答已被平台折叠"

**Bilibili 评论需要登录**
- 即使视频本身可以不登录查看，评论区通常需要登录才能加载
- 如未登录状态下评论区为空 → 提示用户登录后重试，而非返回空评论

**X/Twitter 线程重建**
- 线程是同一作者连续回复自己的推文序列
- 通常 URL 指向最后一条；需要 click"Show this thread"展开全部
- 按发布时间升序排列重建线程，不要倒序

**登录 session 中途过期**
- 长时间批量任务中 session 可能过期（尤其是知乎、Bilibili）
- 每抓取 30 个 URL 后重新 snapshot 验证登录状态
- 检测方法：snapshot 中出现"登录"按钮 → session 已过期，暂停提示用户
