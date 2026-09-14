# 飞虹Code 素材管理管线（feihong-asset-pipeline）

把「**生成 → 下载 → 归档**」串成一条可复用命令，供飞虹Code / 创作中心统一管理 AI 素材。

- 生成：直连 Agnes 上游 `api.agnes-ai.cn/v1`（国内可达），对齐创作中心契约
- 下载：重试退避、超时控制、文件头校验，兼容 `url` / `b64_json` 双通道
- 归档：规范目录 + `manifest.json` + Excel 可打开的 `清单.csv` + SHA256 去重

## 快速开始

```bash
cd H:\Muse Code复刻\asset-pipeline

# 文生图（自动下载 + 归档）
node cli.js image --prompt "白色保温杯放在浅木色桌面上，电商产品图" --name 保温杯 --project 电商素材

# 文生视频
node cli.js video --prompt "镜头缓慢推近" --name 推近 --project 电商素材 --seconds 5 --ratio 16:9

# 图生视频（参考图 → 动态化）
node cli.js video --prompt "镜头环绕半圈" --name 环绕 --project 电商素材 --image 保温杯.png

# 批量串行（避免限流 429）
node cli.js batch --config examples/batch-scenes.json

# 归档已有散乱素材（默认复制，--move 才移动）
node cli.js archive --dir D:\散乱图片 --project 历史素材

# 从 URL / dataURI 补下载入库（海外 CDN 产物自动回退 weserv.nl 图片代理，无需手动开代理）
node cli.js fetch --url "https://platform-outputs.agnes-ai.space/xxx.png" --name 图生图-大理石 --project 能力验证

# 查看素材库
node cli.js list

# ── 技能接入：Agnes 本地服务通道（agnes-ai-studio-assistant）──
fhcode local status            # 检查本地服务（127.0.0.1:8765）
fhcode local start             # 后台启动本地服务并等待就绪
fhcode image  --local --prompt "..." --name 名称 --project 项目 [--image 参考图]
fhcode video  --local --prompt "..." --name 名称 --project 项目 [--image 参考图] [--seconds 5]

# ── 数字人口播模块（agnes-ai-studio V16, 127.0.0.1:5000）──
fhcode anchor voices                               # 音色/情感/语速列表
fhcode anchor models                               # 模型选项
fhcode anchor avatars                              # 数字人形象库（注册表 avatars.json）
fhcode anchor upload --file 形象图.png [--kind image|video|audio]   # 上传形象/参考音频
fhcode anchor run --script "口播文稿" --mode A --avatar-file xx.png --name 名称 --project 项目   # 静态形象
fhcode anchor run --script "口播文稿" --mode C --video-prompt "画面描述"                          # AI 生成画面
fhcode anchor status [--task-id xxx]               # 查询任务状态
```

## 归档规范

```
H:\飞虹素材库\
└── {项目名}\
    ├── 2026-09-13\
    │   ├── 01_保温杯.png
    │   ├── 02_推近.mp4
    │   └── ...
    ├── manifest.json     # 全量元数据（含 prompt、模型、URL、SHA256）
    └── 清单.csv          # Excel 可直接打开
```

- 命名：`{两位序号}_{名称}.{ext}`，同批次序号连续，便于运镜/版本对比
- 去重：同 URL 或同 SHA256 的文件自动跳过，不重复入库
- 移动安全：`--move` 时先验证目标文件完整写入，确认无误才删除源文件

## 批量任务配置示例

```json
{
  "project": "电商素材",
  "items": [
    { "type": "image", "prompt": "白色保温杯，电商产品图，简洁", "name": "保温杯" },
    { "type": "video", "prompt": "镜头缓慢推近", "name": "推近", "seconds": "5", "ratio": "16:9" },
    { "type": "video", "prompt": "镜头环绕半圈", "name": "环绕", "image": "C:/保温杯.png" }
  ]
}
```

## 配置

| 环境变量 | 说明 | 默认 |
|---|---|---|
| `AGNES_API_KEY` | Agnes Key（留空则自动读取创作中心 app.js 内嵌配置） | 自动探测 |
| `AGNES_API_BASE` | 上游地址 | `https://api.agnes-ai.cn/v1` |
| `AGNES_IMAGE_MODEL` | 文生图模型 | `agnes-image-2.5-flash` |
| `AGNES_VIDEO_MODEL` | 视频模型 | `agnes-video-2.5-flash` |
| `AGNES_LOCAL_BASE` | 本地服务地址 | `http://127.0.0.1:8765` |
| `AGNES_LOCAL_PY` / `AGNES_LOCAL_DIR` | 本地服务启动命令 / 目录 | `C:\Python314\python.exe` / `H:\AgnesAI-3.1.1` |
| `AGNES_V16_BASE` | 数字人服务地址 | `http://127.0.0.1:5000` |
| `FEHONG_ASSET_ROOT` | 素材库根目录 | `H:\飞虹素材库` |

## 与创作中心的关系

- 创作中心（`app-mobile`）负责**交互**：用户在界面上输入 prompt、看结果、手动保存
- 本管线负责**批量与资产化**：命令行/脚本调用，结果统一入库、留痕、可追溯
- 两者共用同一套 Agnes 上游契约与 Key，互不冲突

## 双通道：上游直连 vs Agnes 本地服务

| | 上游直连（默认） | 本地服务（`--local` / `fhcode local`） |
|---|---|---|
| 入口 | `api.agnes-ai.cn/v1` | `127.0.0.1:8765`（v3.1.1） |
| 图生图 | 只回海外 space URL，需 weserv 回退 | 同上（本地服务下载也依赖网络），管线统一兜底 |
| 视频 | 2.5 系列，keyframe/text 契约 | v2.0 系列，text/image 契约 |
| 附加 | 无 | 可扩展短剧/数字人/画布（技能模块） |
| 启动 | 无需 | `fhcode local start`（自启并等待就绪） |

`--local` 与直连共用同一套归档/去重/清单逻辑，产物都在 `H:\飞虹素材库`。

## 上游契约速记（实测 2026-09-13）

| 能力 | 模型 | 关键参数 | 注意 |
|---|---|---|---|
| 文生图 | `agnes-image-2.5-flash` | `response_format: b64_json` | 返回 base64，可靠 |
| 图生图 | `agnes-image-2.1-flash` | `image: [纯b64]`（**禁** `response_format`） | 2.5 图生图该团队 403；general 模型只回 URL 且常落海外 `platform-outputs.agnes-ai.space`，本机需代理才能下载 |
| 文生视频 | `agnes-video-2.5-flash` | `mode:'text'` + `aspect_ratio` | |
| 图生视频 | `agnes-video-2.5-flash` | `mode:'keyframe'` + `first_frame`（纯 b64，可加 `last_frame`） | **不是** `reference`（reference/text 模式均禁素材字段） |

- 视频禁止传 `width/height/num_frames/frame_rate/negative_prompt/image`；`seconds` 用字符串、`size:'720P'`
- 免费 Key 有速率限制（连发易 429），批量已串行 + 退避；探测组合需间隔 40s+
- 图生图产物只回海外 `space` 域 URL（无 base64）：下载已内置**双通道**——直连失败自动回退 `images.weserv.nl` 图片代理（2026-09-13 实测可用），无需手动开代理；`fetch` / `image` / `video` 命令均生效
- 契约实现参考：`I:\agnes-ai-studio\src\routes\video.py::_build_agnes25_payload`

## 数字人模块（agnes-ai-studio V16）

- 服务：`I:\agnes-ai-studio\app.py`（Flask 5000），`cd I:\agnes-ai-studio && C:\Python314\python.exe app.py`
- 三种模式：`A` 静态形象图（上传人像，I2V 动态说话）/ `B` 视频素材剪辑 / `C` AI 生成画面（--video-prompt）
- 声音来源 `--audio-source`：`tts`（edge-tts 配音，默认）/ `mat`（视频模型原生声音直出）/ `refaudio`（上传参考音频模板）
- **edge-tts 故障修复（2026-09-13 实测）**：Python aiohttp 只解析到 IPv6 导致连接失败，在 hosts 添加 `150.171.27.10 speech.platform.bing.com` 强制 IPv4 即修复（`C:\Windows\System32\drivers\etc\hosts`）
- 任务成品经 `/anchor/{task_id}/{output_file}` 下载并归档素材库

## 模块结构

```
asset-pipeline/
├── cli.js            # 命令入口
├── lib/
│   ├── config.js     # 配置（环境变量 > 创作中心 > Agnes config.json）
│   ├── agnes.js      # Agnes 上游客户端（图片/视频/轮询）
│   ├── local.js      # Agnes 本地服务客户端（技能接入，含自启）
│   ├── anchor.js     # 数字人口播客户端（V16 模块接入）
│   ├── download.js   # 下载器（重试/校验/双通道）
│   └── archive.js    # 归档器（目录/清单/去重/CSV）
└── examples/
    └── batch-scenes.json
```
