# 短剧生成流水线详解

> Agnes AI Studio 的短剧生成模块，支持 6 步全自动流水线：提示词 → 故事梗概 → 小说扩写 → 专业剧本 → 分镜脚本 → 素材三视图 → 分镜视频 → 合并输出。

---

## 目录

1. [流水线总览](#流水线总览)
2. [状态机详解](#状态机详解)
3. [各步骤说明](#各步骤说明)
4. [暂停/确认机制](#暂停确认机制)
5. [自定义扩展](#自定义扩展)
6. [输出目录结构](#输出目录结构)

---

## 流水线总览

```
用户输入提示词
    ↓
[Step 1a] 生成故事梗概 ──→ 暂停，用户确认/编辑
    ↓ (确认后)
[Step 1b] 生成小说扩写 ──→ 暂停，用户确认/编辑
    ↓ (确认后，支持小小说/短篇/中篇)
[Step 1c] 由小说生成专业剧本
    ↓
[Step 2] 拆分分镜脚本
    ↓
[Step 3] 提取素材（角色/场景/道具）+ 生成三视图
    ↓
[暂停] 用户确认/替换参考图
    ↓
[Step 4] 逐镜头生成视频（可单独启动/重新生成）
    ↓
[Step 5] 合并所有镜头，输出最终视频
```

---

## 状态机详解

短剧任务的所有状态：

| 状态 | 说明 | 可执行操作 |
|------|------|-----------|
| `pending` | 等待中，任务已创建未开始 | - |
| `step1` | 生成故事+小说+剧本中 | - |
| `paused_story` | 故事已生成，暂停等待确认 | 确认故事 / 编辑故事 / 导入文件 |
| `paused_novel` | 小说已生成，暂停等待确认 | 确认小说 / 编辑小说 / 导入文件 |
| `step2` | 生成分镜脚本中 | - |
| `step3` | 提取素材+生成三视图中 | - |
| `paused` | 三视图已生成，暂停等待确认 | 确认参考图 / 替换素材图 / 重新提取 |
| `paused_video` | 分镜已就绪，等待逐个启动视频 | 启动单个镜头 / 批量启动 / 更新参考图 |
| `step4` | 生成视频中 | 查看进度 / 重新生成失败镜头 |
| `paused_merge` | 视频生成完成，等待合并确认 | 等待失败重试 / 直接合并 / 自定义合并 |
| `completed` | 全部完成 | 下载视频 / 查看结果 / 保存本地 |
| `failed` | 失败 | 查看错误 / 重新开始 |
| `stopped` | 用户手动停止 | - |

---

## 各步骤说明

### Step 1a: 生成故事梗概

**输入**：用户提示词
**输出**：200-500 字的故事梗概
**模型**：文本模型（默认 agnes-2.5-flash，可选 doubao-pro-32k 等）
**暂停**：是，生成后暂停等待用户确认

**系统提示词要点**：
- 生成有起承转合的完整故事
- 包含人物、场景、冲突、结局
- 适合后续改编为小说和剧本

### Step 1b: 生成小说扩写

**输入**：故事梗概 + 小说类型
**输出**：
- 小小说（mini）：1000-2000 字
- 短篇小说（short）：3000-5000 字
- 中篇小说（medium）：8000-15000 字
**暂停**：是，生成后暂停等待用户确认

**系统提示词要点**：
- 基于故事梗概扩写，保留核心情节
- 丰富人物描写、环境描写、心理活动
- 增加对话和细节，使故事更生动
- 按小说类型控制字数

### Step 1c: 由小说生成专业剧本

**输入**：确认后的小说
**输出**：专业剧本格式（场景标题 + 动作描述 + 对话）
**暂停**：否，自动继续

**系统提示词要点**：
- 将小说改编为标准剧本格式
- 每个场景包含：场景号、地点、时间、人物、动作、对话
- 适合后续拆分为分镜
- 控制场景数量（建议 5-15 个场景）

### Step 2: 拆分分镜脚本

**输入**：专业剧本
**输出**：分镜列表，每个分镜包含：
- `shot_index`: 镜头序号
- `scene_desc`: 场景描述（中文）
- `prompt_en`: 视频生成提示词（英文）
- `camera`: 镜头运动（推/拉/摇/移/固定）
- `duration`: 时长（秒）
- `characters`: 出场角色
- `location`: 场景地点

**暂停**：否，自动继续

### Step 3: 提取素材 + 生成三视图

**输入**：剧本 + 分镜
**输出**：素材列表，按类型分类：
- `characters`: 角色三视图（正面/侧面/背面，或统一形象图）
- `scenes`: 场景三视图
- `props`: 道具三视图

每个素材包含：
- `category`: 类型（characters/scenes/props）
- `name`: 名称
- `desc`: 视觉特征描述
- `image_url`: 生成的图片 URL
- `local_file`: 本地文件名

**暂停**：是，生成后暂停等待用户确认/替换

### Step 4: 逐镜头生成视频

**输入**：分镜 + 参考图
**输出**：每个镜头的视频文件
**特点**：
- 支持逐个启动，也支持批量启动
- 每个镜头独立生成，失败可单独重试
- 可修改提示词后重新生成
- 可更新参考图和提示词

**暂停**：`paused_video` 状态等待用户启动，`step4` 生成中

### Step 5: 合并输出

**输入**：所有镜头视频
**输出**：最终合并视频
**功能**：
- 自动合并所有成功的镜头
- 支持自定义合并（选择部分镜头、调整顺序）
- 支持等待失败镜头重试后再合并

---

## 暂停/确认机制

短剧流水线有 **3 个暂停点**，用户可以在每个暂停点确认或编辑内容：

### 1. 故事确认（paused_story）

**API**: `POST /api/drama/story/confirm`

```json
{
  "drama_id": "drama_xxx",
  "edited_story": ""  // 空字符串表示使用原文，非空表示使用编辑后的内容
}
```

**前端操作**：
- 点击「编辑故事」修改内容
- 点击「确认并继续生成小说」继续

### 2. 小说确认（paused_novel）

**API**: `POST /api/drama/novel/confirm`

```json
{
  "drama_id": "drama_xxx",
  "novel": ""  // 空字符串表示使用原文
}
```

**前端操作**：
- 点击「编辑小说」修改内容
- 点击「确认并继续生成剧本」继续

### 3. 参考图确认（paused）

**API**: `POST /api/drama/resume`

**前端操作**：
- 点击素材卡片上的「替换」上传自定义图片
- 点击「修改并重新生成」编辑描述后重新生成
- 点击「确认参考图」继续生成视频

---

## 自定义扩展

### 1. 新增小说类型

编辑 `src/routes/drama.py` 中的 `novel_configs` 字典：

```python
novel_configs = {
    'mini': {'name': '小小说', 'min_words': 1000, 'max_words': 2000},
    'short': {'name': '短篇小说', 'min_words': 3000, 'max_words': 5000},
    'medium': {'name': '中篇小说', 'min_words': 8000, 'max_words': 15000},
    # 新增：长篇小说
    'long': {'name': '长篇小说', 'min_words': 20000, 'max_words': 50000},
}
```

前端在 `static/index.html` 的 `dramaNovelType` 下拉框中添加对应选项。

### 2. 修改分镜时长

启动短剧时传入 `shot_duration` 参数：

```json
{
  "prompt": "...",
  "shot_duration": 10  // 每个分镜 10 秒
}
```

可选值：5 / 10 / 18 秒。

### 3. 自定义角色风格

启动短剧时传入 `character_style` 和 `custom_character_style`：

```json
{
  "prompt": "...",
  "character_style": "custom",
  "custom_character_style": "赛博朋克风格，霓虹灯光，未来都市"
}
```

内置风格：`anime`（动漫）、`realistic`（写实）、`3d`（3D 渲染）、`custom`（自定义）。

### 4. 负面提示词

启动短剧时传入 `negative_prompt`，适用于所有生图和生视频：

```json
{
  "prompt": "...",
  "negative_prompt": "模糊,低质量,变形,多余的手指,文字,水印"
}
```

### 5. 文件导入

支持导入 .txt / .md 文件作为故事、小说或剧本：

**API**: `POST /api/drama/import`（multipart/form-data）

| 字段 | 说明 |
|------|------|
| `drama_id` | 短剧 ID（可选，有则直接应用到任务） |
| `type` | 导入类型：`story` / `novel` / `script` |
| `file` | 上传的 .txt 或 .md 文件 |

导入后自动清理 Markdown 格式符号（#、**、*等）。

---

## 输出目录结构

每个短剧任务创建独立目录：

```
<app_dir>/dramas/<drama_id>/
├── images/                    # 生成的素材图片
│   ├── character_001.png
│   ├── scene_001.png
│   └── prop_001.png
├── videos/                    # 生成的分镜视频
│   ├── shot_001.mp4
│   ├── shot_002.mp4
│   └── shot_003.mp4
├── story.txt                  # 故事梗概（调用 save-local 后生成）
├── novel.txt                  # 小说内容
├── script.txt                 # 剧本
├── storyboard.json            # 分镜脚本
└── final_output.mp4           # 最终合并视频
```

**保存到本地**：调用 `POST /api/drama/save-local` 自动生成 story.txt、novel.txt、script.txt、storyboard.json。

---

## 相关 API 速查

| 操作 | API | 方法 |
|------|-----|------|
| 启动短剧 | `/api/drama/start` | POST |
| 查询状态 | `/api/drama/status/{drama_id}` | GET |
| 确认故事 | `/api/drama/story/confirm` | POST |
| 确认小说 | `/api/drama/novel/confirm` | POST |
| 确认参考图 | `/api/drama/resume` | POST |
| 导入文件 | `/api/drama/import` | POST |
| 保存本地 | `/api/drama/save-local` | POST |
| 重新提取素材 | `/api/drama/reextract-assets` | POST |
| 更新视频参考图 | `/api/drama/update-video-refs` | POST |
| 启动单个镜头 | `/api/drama/video/start` | POST |
| 合并视频 | `/api/drama/merge` | POST |
| 停止任务 | `/api/drama/stop` | POST |
