# Agnes AI Studio API 接口文档

> 基础 URL: `http://127.0.0.1:5000`
> 所有请求和响应均为 JSON 格式

---

## 目录

1. [图片生成](#图片生成)
2. [视频生成](#视频生成)
3. [短剧生成](#短剧生成)
4. [数字人口播](#数字人口播)
5. [无限画布](#无限画布)
6. [配置管理](#配置管理)

---

## 图片生成

### POST /api/image/generate

文生图 / 图生图

**请求参数：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| prompt | string | 是 | 图片描述提示词 |
| model | string | 否 | 图片模型，默认 `agnes-image-2.1-flash` |
| size | string | 否 | 图片尺寸，默认 `1024x1024` |
| negative_prompt | string | 否 | 负面提示词 |
| reference_image | string | 否 | 参考图路径（图生图） |

**可用模型：**
- `agnes-image-2.1-flash` - Agnes Image 2.1 Flash（推荐）
- `agnes-image-2.0-flash` - Agnes Image 2.0 Flash
- `doubao-seedream-3-0` - 豆包 Seedream 3.0
- `minimax-image-01` - MiniMax Image 01
- `qwen-image-plus` - Qwen Image Plus

**响应示例：**
```json
{
  "success": true,
  "image_url": "https://...",
  "local_file": "generated_xxx.png",
  "model": "doubao-seedream-3-0"
}
```

---

## 视频生成

### POST /api/video/generate

文生视频 / 图生视频（异步）

**请求参数：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| prompt | string | 是 | 视频描述提示词 |
| model | string | 否 | 视频模型，默认 `agnes-video-2.5-flash` |
| duration | int | 否 | 视频时长（秒），默认 5 |
| reference_image | string | 否 | 参考图路径（图生视频） |

**可用模型：**
- `agnes-video-2.5-flash` - Agnes Video 2.5 Flash（推荐）
- `agnes-video-2.5` - Agnes Video 2.5
- `MiniMax-H3` - MiniMax H3
- `doubao-seaweed-t2v` - 豆包 Seaweed T2V
- `minimax-video-01` - MiniMax Video 01
- `qwen-video-gen` - Qwen Video Gen

**响应示例：**
```json
{
  "success": true,
  "task_id": "video_20260903_120000_abc123"
}
```

### GET /api/video/status/{task_id}

查询视频生成任务状态

**路径参数：**
- `task_id`: 视频任务 ID

**响应示例：**
```json
{
  "success": true,
  "task_id": "video_xxx",
  "status": "completed",  // pending / processing / completed / failed
  "progress": 100,
  "video_url": "https://...",
  "local_file": "video_xxx.mp4",
  "error": null
}
```

---

## 短剧生成

### POST /api/drama/start

启动短剧生成（6步流水线）

**请求参数：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| prompt | string | 是 | 短剧描述 |
| novel_type | string | 否 | 小说类型：`mini`/`short`/`medium`，默认 `short` |
| negative_prompt | string | 否 | 负面提示词 |
| shot_duration | int | 否 | 每个分镜时长（秒），默认 5 |
| text_model | string | 否 | 文本模型 |
| image_model | string | 否 | 图片模型 |
| video_model | string | 否 | 视频模型 |
| character_style | string | 否 | 角色风格：`anime`/`realistic`/`3d`/`custom` |

**响应示例：**
```json
{
  "success": true,
  "drama_id": "drama_20260903_120000_abc123",
  "status": "pending"
}
```

### GET /api/drama/status/{drama_id}

查询短剧任务状态

**响应字段：**
- `status`: 任务状态
  - `pending` - 等待中
  - `step1` - 生成故事+小说+剧本
  - `paused_story` - 暂停，等待确认故事
  - `paused_novel` - 暂停，等待确认小说
  - `step2` - 生成分镜
  - `step3` - 提取素材+生成三视图
  - `paused` - 暂停，等待确认参考图
  - `paused_video` - 暂停，等待逐个启动视频生成
  - `step4` - 生成视频
  - `completed` - 完成
  - `failed` - 失败
- `story`: 故事梗概
- `novel`: 小说内容
- `novel_type`: 小说类型
- `script`: 剧本
- `storyboard`: 分镜脚本
- `assets`: 素材三视图列表
- `video_results`: 视频生成结果列表
- `merged_video`: 合并后的视频

### POST /api/drama/story/confirm

确认/编辑故事梗概，继续生成小说

**请求参数：**
- `drama_id`: 短剧 ID
- `edited_story`: 编辑后的故事（空字符串表示使用原文）

### POST /api/drama/novel/confirm

确认/编辑小说，继续生成剧本

**请求参数：**
- `drama_id`: 短剧 ID
- `novel`: 编辑后的小说（空字符串表示使用原文）

### POST /api/drama/import

导入 .txt / .md 文件作为故事/小说/剧本

**请求方式：** multipart/form-data

**字段：**
- `drama_id`: 短剧 ID（可选）
- `type`: 导入类型：`story`/`novel`/`script`
- `file`: 上传的 .txt 或 .md 文件

### POST /api/drama/save-local

将故事/小说/剧本/分镜保存到本地 txt 文件

**请求参数：**
- `drama_id`: 短剧 ID

**响应示例：**
```json
{
  "success": true,
  "saved": ["story.txt", "novel.txt", "script.txt", "storyboard.json"],
  "dir": "C:/Users/.../dramas/drama_xxx"
}
```

### POST /api/drama/reextract-assets

重新提取素材并生成三视图

**请求参数：**
- `drama_id`: 短剧 ID

### POST /api/drama/update-video-refs

更新分镜视频的参考图和提示词

**请求参数：**
- `drama_id`: 短剧 ID

---

## 数字人口播

### POST /api/anchor/generate

生成数字人口播视频

**请求参数：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| script | string | 是 | 口播文稿内容 |
| mode | string | 否 | 画面模式：`A`/`B`/`C`，默认 `A` |
| voice | string | 否 | TTS 音色，默认 `zh-CN-XiaoxiaoNeural` |
| use_tts | bool | 否 | 是否使用 TTS 配音，默认 `true` |
| avatar_file | string | 条件必填 | 形象图片/视频文件名（mode=A/B 时必填） |
| video_prompt | string | 条件必填 | 画面风格提示词（mode=C 时必填） |
| min_duration | int | 否 | 每段最小时长（秒），默认 5 |
| text_model | string | 否 | 文本模型 |
| image_model | string | 否 | 图片模型 |
| video_model | string | 否 | 视频模型 |

**模式说明：**
- `A` - 静态形象图：上传人物图片，I2V 生成动态说话视频
- `B` - 视频素材：上传已有视频，作为口播画面
- `C` - AI 生成画面：根据提示词 AI 生成画面

**use_tts 说明：**
- `true` - 使用 TTS 配音，清晰稳定，可选音色
- `false` - 视频模型自带语音，对口型更自然，但可能有幻觉乱语

**响应示例：**
```json
{
  "success": true,
  "task_id": "anchor_20260903_120000_abc123"
}
```

### GET /api/anchor/status/{task_id}

查询数字人口播任务状态

**响应示例：**
```json
{
  "success": true,
  "task_id": "anchor_xxx",
  "status": "completed",
  "step": "merge",
  "message": "正在拼接最终视频...",
  "segments": [...],
  "output_video": "C:/Users/.../anchor/anchor_xxx/output.mp4"
}
```

### GET /api/anchor/voices

获取可用 TTS 音色列表

### GET /api/anchor/models

获取可用模型列表

### POST /api/anchor/upload

上传数字人形象图片/视频

---

## 无限画布

### GET /api/canvas/list

列出所有画布

### POST /api/canvas/save

保存画布

**请求参数：**
- `canvas_id`: 画布 ID
- `nodes`: 节点列表
- `edges`: 连线列表

### GET /api/canvas/load/{canvas_id}

加载画布

### POST /api/canvas/delete

删除画布

**请求参数：**
- `canvas_id`: 画布 ID

### POST /api/canvas/ai-continue

AI 续写画布节点内容

---

## 配置管理

### GET /api/config

获取当前配置

**响应示例：**
```json
{
  "success": true,
  "api_key_masked": "sk-xxxx...xxxx",
  "doubao_api_key_masked": "sk-xxxx...xxxx",
  "doubao_pool_enabled": true,
  "custom_models": [...],
  "default_models": {...}
}
```

### POST /api/config/save

保存配置

**请求参数：**
- `api_key`: 主 API Key
- `doubao_api_key`: 豆包 API Key
- `deepseek_api_key`: DeepSeek API Key
- `qwen_api_key`: 千问 API Key
- `minimax_api_key`: MiniMax API Key
- `custom_models`: 自定义模型列表
- `default_models`: 默认模型配置

---

## 错误响应格式

所有接口失败时统一返回：

```json
{
  "success": false,
  "error": "错误描述"
}
```

HTTP 状态码：
- `200` - 成功
- `400` - 请求参数错误
- `401` - 未授权（API Key 无效）
- `404` - 资源不存在
- `500` - 服务器内部错误
