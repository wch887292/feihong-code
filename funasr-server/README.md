# 飞虹 Code FunASR 本地语音识别服务

独立部署的语音识别服务，基于阿里 FunASR 开源模型，专为中文优化，完全免费离线使用。

## 功能特点

- 完全免费，无调用次数限制
- 本地部署，隐私安全，音频不上传云端
- 中文优化，支持粤语、四川话等方言
- 支持多语言识别（自动检测）
- HTTP API 接口，任何项目都能调用
- 支持 wav、mp3、flac、ogg 等常见音频格式

## 系统要求

- Python 3.8 或更高版本
- 内存：至少 4GB（推荐 8GB）
- 磁盘：至少 1GB 空间（模型文件约 200MB）
- 操作系统：Windows / macOS / Linux

## 快速开始

### Windows

双击运行 `启动语音识别服务.bat`

首次运行会自动：
1. 创建 Python 虚拟环境
2. 安装依赖包
3. 下载 FunASR 模型（约 200MB）
4. 启动服务

### macOS / Linux

```bash
cd funasr-server
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

## API 接口

### 健康检查

```
GET http://localhost:8082/health
```

返回：
```json
{
  "status": "ok",
  "model_loaded": true,
  "model": "iic/SenseVoiceSmall",
  "device": "cpu"
}
```

### 语音识别（文件上传）

```
POST http://localhost:8082/api/recognize
Content-Type: multipart/form-data

file: 音频文件
```

返回：
```json
{
  "success": true,
  "text": "识别的文本内容",
  "duration": 1.234,
  "language": "zh"
}
```

### 语音识别（字节流）

```
POST http://localhost:8082/api/recognize-bytes
Content-Type: application/octet-stream

音频字节数据
```

## 在飞虹 Code 中使用

1. 启动 FunASR 服务（运行 `启动语音识别服务.bat`）
2. 在飞虹 Code 桌面版中，语音输入会自动调用本地服务
3. 如果本地服务未启动，会回退到浏览器的 Web Speech API

## 在其他项目中使用

任何支持 HTTP 请求的项目都可以调用：

### JavaScript 示例

```javascript
const formData = new FormData();
formData.append('file', audioFile);

const response = await fetch('http://localhost:8082/api/recognize', {
  method: 'POST',
  body: formData
});
const result = await response.json();
console.log(result.text);
```

### Python 示例

```python
import requests

with open('audio.wav', 'rb') as f:
    response = requests.post(
        'http://localhost:8082/api/recognize',
        files={'file': f}
    )
result = response.json()
print(result['text'])
```

### cURL 示例

```bash
curl -X POST http://localhost:8082/api/recognize \
  -F "file=@audio.wav"
```

## 配置说明

修改 `app.py` 顶部的配置：

```python
MODEL_NAME = "iic/SenseVoiceSmall"  # 模型名称
DEVICE = "cpu"  # 有 GPU 可改为 "cuda"
SAMPLE_RATE = 16000  # 采样率
```

### 可用模型

- `iic/SenseVoiceSmall`：通用模型，支持多语言（推荐）
- `iic/paraformer-zh`：中文普通话专用，准确率更高
- `iic/paraformer-zh-streaming`：中文流式识别，延迟更低

## 性能说明

- CPU 模式：实时率约 0.3-0.5（10秒音频约3-5秒识别完成）
- GPU 模式：实时率约 0.05-0.1（接近实时）
- 首次请求会加载模型，约需 3-5 秒

## 常见问题

**Q: 首次启动很慢？**
A: 首次启动需要下载模型文件（约 200MB），之后启动就快了。

**Q: 识别准确率不高？**
A: 确保音频清晰，采样率 16kHz，单声道。可以尝试更换模型。

**Q: 可以用 GPU 加速吗？**
A: 可以，将 `DEVICE` 改为 `"cuda"`，但需要安装 CUDA 版本的 PyTorch。

**Q: 端口被占用？**
A: 修改 `app.py` 底部的端口号，默认 8082。

## 技术支持

- FunASR 官方文档：https://github.com/modelscope/FunASR
- 模型库：https://modelscope.cn/models

---

晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心
