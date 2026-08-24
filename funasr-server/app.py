"""
飞虹 Code - 本地语音识别服务（faster-whisper 版）
独立部署，可被其他项目调用
晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
"""

import os
import time
import tempfile
import numpy as np
import soundfile as sf
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

# 配置
MODEL_SIZE = "small"  # tiny/base/small/medium/large-v3，small 平衡速度和准确率
DEVICE = "cpu"  # 有 GPU 可改为 "cuda"
COMPUTE_TYPE = "int8"  # int8 适合 CPU，速度快
SAMPLE_RATE = 16000

app = FastAPI(title="飞虹 Code 本地语音识别服务", version="1.0.0")

# 允许跨域（供前端调用）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局模型变量
model = None
model_loaded = False


class RecognizeResponse(BaseModel):
    success: bool
    text: str
    duration: float
    language: Optional[str] = None
    error: Optional[str] = None


def load_model():
    """加载 faster-whisper 模型"""
    global model, model_loaded
    if model_loaded:
        return
    print(f"[Whisper] 正在加载模型: {MODEL_SIZE} ({DEVICE}/{COMPUTE_TYPE})...")
    try:
        from faster_whisper import WhisperModel
        model = WhisperModel(
            MODEL_SIZE,
            device=DEVICE,
            compute_type=COMPUTE_TYPE,
        )
        model_loaded = True
        print("[Whisper] 模型加载完成")
    except Exception as e:
        print(f"[Whisper] 模型加载失败: {e}")
        raise


@app.on_event("startup")
async def startup_event():
    """启动时加载模型"""
    try:
        load_model()
    except Exception as e:
        print(f"[Whisper] 启动时模型加载失败，将在首次请求时重试: {e}")


@app.get("/health")
async def health():
    """健康检查"""
    return {
        "status": "ok",
        "model_loaded": model_loaded,
        "model": MODEL_SIZE,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
    }


@app.post("/api/recognize", response_model=RecognizeResponse)
async def recognize(file: UploadFile = File(...)):
    """
    语音识别接口
    上传音频文件，返回识别文本
    支持格式：wav, mp3, flac, ogg, m4a 等
    """
    start_time = time.time()

    if not model_loaded:
        try:
            load_model()
        except Exception as e:
            return RecognizeResponse(
                success=False,
                text="",
                duration=0,
                error=f"模型加载失败: {str(e)}",
            )

    try:
        # 读取上传的音频
        audio_data = await file.read()
        if not audio_data:
            raise HTTPException(status_code=400, detail="音频文件为空")

        # 保存到临时文件
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(audio_data)
            tmp_path = tmp.name

        try:
            # 识别
            segments, info = model.transcribe(
                tmp_path,
                language="zh",  # 中文识别，auto 为自动检测
                beam_size=5,
                vad_filter=True,  # 自动过滤静音
                vad_parameters=dict(min_silence_duration_ms=500),
            )

            # 合并所有片段
            text = ""
            for segment in segments:
                text += segment.text

            text = text.strip()
            duration = time.time() - start_time

            return RecognizeResponse(
                success=True,
                text=text,
                duration=round(duration, 3),
                language=info.language,
            )

        finally:
            # 清理临时文件
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    except Exception as e:
        duration = time.time() - start_time
        return RecognizeResponse(
            success=False,
            text="",
            duration=round(duration, 3),
            error=str(e),
        )


@app.post("/api/recognize-bytes")
async def recognize_bytes(audio: bytes):
    """
    直接接收音频字节流的识别接口
    适合前端实时传输
    """
    start_time = time.time()

    if not model_loaded:
        try:
            load_model()
        except Exception as e:
            return {"success": False, "text": "", "error": str(e)}

    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(audio)
            tmp_path = tmp.name

        try:
            segments, info = model.transcribe(
                tmp_path,
                language="zh",
                beam_size=5,
                vad_filter=True,
            )
            text = ""
            for segment in segments:
                text += segment.text
            return {
                "success": True,
                "text": text.strip(),
                "duration": round(time.time() - start_time, 3),
                "language": info.language,
            }
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    except Exception as e:
        return {"success": False, "text": "", "error": str(e)}


if __name__ == "__main__":
    import uvicorn
    print("=" * 50)
    print("飞虹 Code 本地语音识别服务 (faster-whisper)")
    print("=" * 50)
    print(f"模型: {MODEL_SIZE}")
    print(f"设备: {DEVICE}")
    print(f"精度: {COMPUTE_TYPE}")
    print(f"端口: 8082")
    print("=" * 50)
    uvicorn.run(app, host="0.0.0.0", port=8082)
