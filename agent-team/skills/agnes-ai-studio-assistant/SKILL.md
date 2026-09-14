---
name: agnes-ai-studio-assistant
description: "Agnes AI Studio 综合全能助手，涵盖 API 操作、开发维护、部署运维全流程。使用场景：(1) 调用 Agnes API 生成图片/视频/短剧/数字人口播/无限画布；(2) 基于 Agnes 项目进行功能开发、Bug 修复、代码重构；(3) 环境配置、依赖安装、应用启动、故障排查、PyInstaller 打包发布；(4) 豆包 Pool 配置、多厂商 API 集成、短剧流水线定制。触发关键词：Agnes、agnes-ai-studio、生图、生视频、短剧生成、数字人口播、无限画布、豆包 pool、打包 EXE、项目报错。"
---

# Agnes AI Studio 综合全能助手

## Overview

Agnes AI Studio 是一个基于 Flask 的本地桌面 Web 应用，提供文生图、图生图、文生视频、图生视频、短剧生成、数字人口播、无限画布等功能，支持多厂商 API（Agnes / DeepSeek / Qwen / 豆包 / MiniMax / Ollama），通过 PyInstaller 打包为 EXE。

本 Skill 提供三大核心能力：**API 操作**、**开发维护**、**部署运维**，帮助 AI Agent 高效使用和扩展 Agnes AI Studio。

---

## 核心能力

### 1. API 操作助手

调用 Agnes 本地 API 自动完成各类生成任务。

**支持的功能模块：**

| 模块 | API 端点 | 说明 |
|------|---------|------|
| 文生图 | `POST /api/image/generate` | 支持 Agnes Image / 豆包 Seedream / MiniMax / Qwen |
| 图生图 | `POST /api/image/edit` | 基于参考图生成新图 |
| 文生视频 | `POST /api/video/generate` | 支持 Agnes Video / 豆包 Seaweed / MiniMax |
| 图生视频 | `POST /api/video/image-to-video` | 基于图片生成视频 |
| 视频状态 | `GET /api/video/status/<task_id>` | 查询视频生成任务状态 |
| 短剧生成 | `POST /api/drama/start` | 6步流水线：故事→小说→剧本→分镜→三视图→视频 |
| 短剧状态 | `GET /api/drama/status/<drama_id>` | 查询短剧任务状态 |
| 数字人口播 | `POST /api/anchor/generate` | 支持A静态图/B视频素材/C AI生成画面三种模式 |
| 无限画布 | `POST /api/canvas/save` | 画布节点保存/加载/AI续写 |

**API 调用示例：**

```python
import requests

BASE = "http://127.0.0.1:5000"

# 文生图
resp = requests.post(f"{BASE}/api/image/generate", json={
    "prompt": "一只可爱的橘猫坐在窗台上",
    "model": "doubao-seedream-3-0",
    "size": "1024x1024"
})
result = resp.json()
# result: {"success": true, "image_url": "...", "local_file": "..."}

# 启动短剧生成
resp = requests.post(f"{BASE}/api/drama/start", json={
    "prompt": "一个女孩在雨中的公交站等车，一位老人递给她一把伞",
    "novel_type": "short",  # mini/short/medium
    "negative_prompt": "模糊,低质量",
    "text_model": "doubao-pro-32k",
    "image_model": "doubao-seedream-3-0",
    "video_model": "doubao-seaweed-t2v"
})
drama_id = resp.json()["drama_id"]
```

---

### 2. 开发维护助手

基于 Agnes 项目进行功能开发、Bug 修复、代码重构。

**项目结构速查：**

```
agnes-ai-studio/
├── app.py                    # Flask 应用入口
├── config.json               # 用户配置（API Key、自定义模型）
├── requirements.txt          # Python 依赖
├── src/
│   ├── __init__.py           # 蓝图注册
│   ├── config.py             # 配置管理、API Key 读写、豆包 Pool
│   ├── models.py             # 模型选项、任务状态管理
│   ├── routes/
│   │   ├── drama.py          # 短剧生成流水线（1500+行）
│   │   ├── anchor.py         # 数字人口播（1000+行）
│   │   ├── canvas.py         # 无限画布
│   │   ├── auth.py           # 用户认证
│   │   └── product_ad.py     # 商品宣传图
│   └── services/
│       ├── text_model.py     # 文本模型调用
│       ├── video_gen.py      # 视频生成
│       ├── video_merge.py    # 视频合并、字幕烧录
│       ├── tts.py            # TTS 语音合成
│       └── long_video.py     # 长视频生成
├── static/
│   └── index.html            # 前端单文件（5000+行，包含所有 UI 和 JS）
└── build.bat / build.spec    # PyInstaller 打包配置
```

**开发规范：**

1. **大文件修改**：`drama.py`（1500+行）、`anchor.py`（1000+行）、`index.html`（5000+行）使用 Edit 工具容易失败，**优先使用 Python 脚本 patch**（读取→替换→写入）
2. **前端单文件**：所有 HTML/CSS/JS 都在 `static/index.html`，修改时注意行号定位
3. **状态管理**：短剧和数字人任务都存在内存字典中（`drama_tasks`、`anchor_tasks`），重启后丢失
4. **事件机制**：使用 `threading.Event` 实现暂停/确认（如 `drama_story_edit_events`、`drama_novel_edit_events`）
5. **语法验证**：修改 Python 文件后必须运行 `python -m py_compile <file>` 验证

**常见开发任务模式：**

- **新增 API 端点**：在对应 `routes/*.py` 中添加 `@blueprint.route()` 装饰器函数
- **新增前端控件**：在 `index.html` 中添加 HTML 元素 + JS 事件绑定
- **新增模型支持**：在 `src/models.py` 的 `*_MODEL_OPTIONS` 字典中添加，在 `src/config.py` 的 `get_vendor_base_url` 中添加端点
- **豆包 Pool 配置**：在 `config.json` 中添加 `doubao_pool` 字段，详见 `references/doubao_pool.md`

---

### 3. 部署运维助手

环境配置、依赖安装、应用启动、故障排查、打包发布。

**快速启动：**

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 启动应用
python app.py

# 3. 浏览器访问
# http://127.0.0.1:5000
```

**常见故障排查：**

| 问题 | 排查方向 |
|------|---------|
| 启动报错 `ModuleNotFoundError` | 运行 `pip install -r requirements.txt`，检查 Python 版本（建议 3.9+） |
| API 调用返回 401 | 检查 `config.json` 中的 API Key，或在设置界面重新配置 |
| 豆包模型报"模型未授权" | 登录火山引擎方舟平台，确认已开通对应模型（文本/图片/视频需分别开通） |
| 视频生成一直 pending | 检查视频模型 API Key 是否有效，查看控制台日志的请求详情 |
| ffmpeg 相关报错 | 确认 `ffmpeg` 已安装并在 PATH 中，或检查 `video_merge.py` 中的 `get_ffmpeg_path()` |
| 中文乱码/字幕不显示 | 检查系统是否有中文字体，`video_merge.py` 中的 `_find_chinese_font()` 会自动查找 |

**PyInstaller 打包 EXE：**

```bash
# 使用项目自带的打包脚本
build.bat

# 或手动执行
pyinstaller build.spec --clean
```

打包产物在 `dist/` 目录，包含 EXE 和依赖文件。

---

## 快速开始

### 场景一：调用 API 生成图片

1. 确认 Agnes 应用已启动（`python app.py`）
2. 使用 `scripts/api_client.py` 或直接 requests 调用
3. 查看返回的 `image_url` 或 `local_file`

### 场景二：新增一个功能模块

1. 在 `src/routes/` 下新建 `xxx.py`，定义 Blueprint
2. 在 `src/__init__.py` 中注册蓝图
3. 在 `static/index.html` 中添加前端 UI 和 JS
4. 运行 `python -m py_compile` 验证语法
5. 重启应用测试

### 场景三：配置豆包 Pool

1. 编辑 `config.json`，添加 `doubao_pool` 配置（详见 `references/doubao_pool.md`）
2. 重启应用
3. 在各模块中选择豆包模型（doubao-pro-32k / doubao-seedream-3-0 / doubao-seaweed-t2v）
4. 控制台会输出 `[豆包Pool] 使用 domestic 区域 Key: sk-xxxxxxxx...` 日志

---

## 资源说明

### scripts/

| 文件 | 用途 |
|------|------|
| `api_client.py` | Agnes API 统一调用客户端，封装生图/生视频/短剧/数字人等常用接口 |
| `project_check.py` | 项目健康检查脚本，验证依赖、配置、语法、目录结构 |
| `patch_helper.py` | 大文件 patch 辅助工具，用于安全修改 drama.py / anchor.py / index.html |

### references/

| 文件 | 用途 |
|------|------|
| `api_reference.md` | 完整 API 接口文档，包含所有端点的参数、返回值、示例 |
| `doubao_pool.md` | 豆包 Pool 配置详解，国内/海外双区域、多 Key 轮询、失败自动切换 |
| `drama_pipeline.md` | 短剧生成流水线详解，6步流程、状态机、事件机制、自定义扩展 |
| `troubleshooting.md` | 常见问题排查手册，按症状分类的解决方案 |

### assets/

（暂无，可根据需要添加配置模板、示例文件等）

---

## 注意事项

1. **本地应用**：Agnes AI Studio 是本地桌面应用，API 调用前必须确保 `python app.py` 已启动，默认端口 5000
2. **配置文件**：`config.json` 包含用户 API Key，**不要提交到公开仓库**，项目已默认在 `.gitignore` 中忽略
3. **大文件修改**：再次强调，`drama.py`、`anchor.py`、`index.html` 三个大文件优先使用 Python 脚本 patch，Edit 工具容易超时失败
4. **任务状态**：所有生成任务状态存在内存中，应用重启后任务丢失，已生成的文件保留在输出目录
5. **豆包模型开通**：豆包的文本、图片、视频模型需要在火山引擎方舟平台**分别开通**，只开通一个会导致其他模型报"未授权"
