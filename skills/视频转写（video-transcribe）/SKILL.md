---
name: video-transcribe
description: Downloads video audio using yt-dlp and transcribes to text with Whisper when user provides a video URL or local video file path and wants a text transcript.
---

# 视频转写（Video Transcribe）

## 核心定位

接受视频 URL 或本地文件路径，优先使用平台内置字幕（秒出结果），无字幕时用 yt-dlp 提取音频并调用 Whisper 转写，后处理合并短句和修正中文标点，输出带时间戳的完整文本。

---

## 触发场景

- 用户提供视频 URL，要求"转写"或"提取字幕"或"整理成文字"
- content-scraper skill 需要 Bilibili/YouTube 视频内容
- 用户有本地视频/音频文件需要转录
- 用户要求从视频中提取会议记录或讲座内容

---

## 支持平台

**yt-dlp 支持（主要）：**
```
YouTube / YouTube Shorts
Bilibili（公开视频；大会员内容需 cookie）
X/Twitter（视频推文）
Instagram（公开视频）
TikTok
微博视频
本地文件路径（mp4 / mp3 / wav / m4a / mkv）
```

**不支持（DRM 加密）：**
- Netflix / Disney+ / Apple TV+
- 需要订阅验证的付费播客平台

---

## 工作流

### Step 1：环境检查

```bash
# 检查 yt-dlp
which yt-dlp || echo "缺少 yt-dlp，运行：pip install yt-dlp"

# 检查 Whisper
python3 -c "import whisper; print('ok')" || echo "缺少 whisper，运行：pip install openai-whisper"

# 检查 ffmpeg（Whisper 必须依赖）
which ffmpeg || echo "缺少 ffmpeg，运行：brew install ffmpeg（macOS）或 sudo apt install ffmpeg（Linux）"
```

检测 Apple Silicon（M 系列芯片）以决定是否使用 mlx-whisper：
```bash
uname -m  # 返回 arm64 表示 Apple Silicon
python3 -c "import mlx_whisper; print('mlx ok')" 2>/dev/null || echo "可选：pip install mlx-whisper"
```

### Step 2：检查平台内置字幕

**优先使用内置字幕（比 Whisper 快且更准确）：**
```bash
# 获取视频信息，检查是否有字幕
yt-dlp --dump-json --no-playlist "{URL}" 2>/dev/null | python3 -c "
import json, sys
info = json.load(sys.stdin)
print(f'标题: {info.get(\"title\", \"未知\")}')
print(f'时长: {info.get(\"duration\", 0) // 60} 分 {info.get(\"duration\", 0) % 60} 秒')
subs = list(info.get('subtitles', {}).keys())
auto = list(info.get('automatic_captions', {}).keys())
print(f'官方字幕: {subs}')
print(f'自动字幕: {auto}')
"
```

**如有字幕，直接下载（跳过 Step 3-4）：**
```bash
# 下载中文字幕（优先官方，其次自动）
yt-dlp --write-subs --write-auto-subs \
       --sub-lang "zh-Hans,zh-Hant,zh,en" \
       --skip-download --sub-format vtt \
       -o "/tmp/transcript/%(title)s.%(ext)s" \
       "{URL}"

# 解析 .vtt 文件
python3 -c "
import re, sys

with open('/tmp/transcript/xxx.vtt') as f:
    content = f.read()

# 移除 WebVTT 头和时间戳行
lines = []
for line in content.split('\n'):
    if '-->' in line or line.startswith('WEBVTT') or re.match(r'^\d+$', line.strip()):
        continue
    text = re.sub(r'<[^>]+>', '', line).strip()  # 移除 HTML 标签
    if text:
        lines.append(text)

print('\n'.join(lines))
"
```

### Step 3：提取音频

仅当无内置字幕时执行：

```bash
mkdir -p /tmp/transcript

# 仅下载音频（不下载视频，节省时间）
yt-dlp \
  --extract-audio \
  --audio-format mp3 \
  --audio-quality 0 \
  --no-playlist \
  -o "/tmp/transcript/%(title)s.%(ext)s" \
  "{URL}"

# 本地视频文件 → 提取音频
ffmpeg -i "/绝对路径/video.mp4" \
       -vn -acodec libmp3lame -q:a 2 \
       "/tmp/transcript/audio.mp3" -y
```

预计时间参考（下载）：
| 视频时长 | 下载时间（估算） |
|----------|-----------------|
| < 10 分钟 | < 30 秒 |
| 10-30 分钟 | 30-120 秒 |
| > 30 分钟 | 提前告知用户，约需数分钟 |

### Step 4：Whisper 转写

**模型选择（速度 vs 质量）：**

| 模型 | 大小 | 速度倍率 | 质量 | 推荐场景 |
|------|------|----------|------|----------|
| tiny | 39MB | ~10x 实时 | 基本可用 | 快速预览 |
| base | 74MB | ~7x 实时 | 较好 | 清晰录音 |
| small | 244MB | ~4x 实时 | 好 | 日常默认 |
| medium | 769MB | ~2x 实时 | 很好 | 口音明显 / 专业术语 |
| large-v3 | 1.5GB | ~1x 实时 | 最好 | 最高质量要求 |

**标准执行（CPU，small 模型）：**
```python
import whisper, json

model = whisper.load_model('small')
result = model.transcribe(
    '/tmp/transcript/audio.mp3',
    language=None,      # None = 自动检测；中文视频建议指定 'zh'
    task='transcribe',  # 'translate' 可将内容翻译为英文
    verbose=False,
    fp16=False          # CPU 模式必须设为 False
)

with open('/tmp/transcript/result.json', 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print(f'检测语言: {result["language"]}, 片段数: {len(result["segments"])}')
```

**Apple Silicon 加速（M1/M2/M3，推荐）：**
```bash
# mlx-whisper 在 Apple Silicon 上比 CPU whisper 快 5-10 倍
mlx_whisper "/tmp/transcript/audio.mp3" \
  --model mlx-community/whisper-large-v3-turbo \
  --output-format json \
  --language zh \
  --output-dir /tmp/transcript/
```

**CUDA GPU 加速（NVIDIA）：**
```python
import torch
if torch.cuda.is_available():
    model = whisper.load_model('large-v3', device='cuda')
    result = model.transcribe('/tmp/transcript/audio.mp3', fp16=True)
```

### Step 5：后处理

```python
import json, re

with open('/tmp/transcript/result.json', 'r') as f:
    result = json.load(f)

segments = result['segments']
language = result['language']

# 合并过短片段（时长 < 3 秒 且 文字 < 10 字）
merged = []
buffer = None
for seg in segments:
    duration = seg['end'] - seg['start']
    is_short = duration < 3 and len(seg['text'].strip()) < 10
    if buffer and is_short:
        buffer['text'] += seg['text']
        buffer['end'] = seg['end']
    else:
        if buffer:
            merged.append(buffer)
        buffer = dict(seg)
if buffer:
    merged.append(buffer)

# 中文标点修正
def fix_zh_punct(text):
    text = re.sub(r'\s+', '', text)                  # 移除词间多余空格
    text = re.sub(r'([，。！？；：])\1+', r'\1', text)  # 去重复标点
    return text

# 格式化为带时间戳的文本
lines = []
for seg in merged:
    start = seg['start']
    text = seg['text'].strip()
    if language in ('zh', 'chinese'):
        text = fix_zh_punct(text)
    m, s = int(start) // 60, int(start) % 60
    lines.append(f'[{m:02d}:{s:02d}] {text}')

transcript = '\n'.join(lines)

# 保存
title = "video"  # 从 yt-dlp 元数据获取
with open(f'/tmp/transcript/{title}_transcript.txt', 'w', encoding='utf-8') as f:
    f.write(transcript)
```

---

## 常见错误修复

**yt-dlp：ERROR: Video unavailable / HTTP 403**
```bash
# 最常见修复：更新 yt-dlp
pip install --upgrade yt-dlp
# 或
yt-dlp -U

# 需要登录的内容（B站大会员、X 受限内容）
yt-dlp --cookies-from-browser chrome "{URL}"
# 或先用浏览器导出 cookies.txt
yt-dlp --cookies ~/cookies.txt "{URL}"
```

**yt-dlp：地区限制**
```
不支持 VPN 自动切换。
直接告知用户：此内容在当前网络环境不可访问（地区限制）。
```

**Whisper：CUDA out of memory**
```python
# 降级模型或强制 CPU
model = whisper.load_model('small', device='cpu')
result = model.transcribe('/tmp/transcript/audio.mp3', fp16=False)
```

**Whisper：RuntimeError: PytorchStreamReader failed**
```bash
# 音频文件损坏，重新下载
rm /tmp/transcript/audio.mp3
# 重新执行 Step 3
```

**转写质量差（口音、专业术语）**
```python
# 1. 使用更大模型
model = whisper.load_model('large-v3')

# 2. 强制指定语言（避免语言误判导致质量下降）
result = model.transcribe('/tmp/transcript/audio.mp3', language='zh')

# 3. 提供初始提示词（对专业内容有效）
result = model.transcribe(
    '/tmp/transcript/audio.mp3',
    language='zh',
    initial_prompt='以下是一段关于机器学习的技术讲座，包含大量英文术语。'
)
```

---

## 输出格式

```
## 视频转写完成

来源：{URL 或文件路径}
标题：{视频标题}
时长：{分钟}:{秒}
检测语言：{zh / en / ...}
转写方式：{内置字幕 / Whisper-small / mlx-large-v3-turbo}
片段数：{n}

### 转写文本

[00:00] 第一段内容...
[00:15] 第二段内容...
[01:23] 继续...

### 保存路径
/tmp/transcript/{标题}_transcript.txt
```

---

## Gotchas

**优先使用平台内置字幕**
- YouTube CC 字幕比 Whisper 准确得多，且立即可用
- Bilibili 官方字幕同理
- 只有无字幕或字幕质量极差时才运行 Whisper

**中文 Whisper 的系统性错误**
- "的/地/得"混用（语境判断错误）→ 无法自动修正，在输出末尾注明
- 数字中英文混用不一致（"三十" vs "30"）→ 后处理可统一，但需用户选择格式
- 背景音乐段落会被转写为乱码 → 过滤文字极短或含大量标点的片段

**超长视频的时间估算（CPU）**
- 2 小时视频 CPU 转写约需 60-120 分钟
- 建议提前告知用户预计时间，并推荐使用 Apple Silicon（mlx-whisper）加速
- Apple Silicon M2 运行 large-v3-turbo 比 CPU small 模型更快且质量更好

**Bilibili 大会员内容**
- 720P 以下视频通常无需登录即可下载音频
- 大会员专属内容需提供 cookie：`--cookies-from-browser chrome`
- 可获取：标题/简介/评论；无法获取：视频内容本身

**本地文件的绝对路径**
- 必须使用绝对路径，不接受相对路径或 `~/` 扩展（在脚本中 `~` 不自动展开）
- 正确：`YOUR_LOCAL_PATH/Downloads/video.mp4`
- 错误：`~/Downloads/video.mp4`（需要先展开）
