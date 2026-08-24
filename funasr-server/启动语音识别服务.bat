@echo off
chcp 65001 >nul
title 飞虹 Code 本地语音识别服务 (faster-whisper)

echo ================================================
echo   飞虹 Code 本地语音识别服务
echo   晋江市飞虹智科技企业管理有限公司
echo ================================================
echo.

:: 检查 Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python 3.8+
    echo 下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

:: 检查虚拟环境
if not exist "venv" (
    echo [初始化] 创建 Python 虚拟环境...
    python -m venv venv
    if errorlevel 1 (
        echo [错误] 创建虚拟环境失败
        pause
        exit /b 1
    )
)

:: 激活虚拟环境
call venv\Scripts\activate.bat

:: 设置 Hugging Face 国内镜像源
set HF_ENDPOINT=https://hf-mirror.com
:: 禁用 xet 存储（避免 401 认证错误）
set HF_HUB_DISABLE_XET=1

:: 检查依赖
if not exist "venv\Lib\site-packages\faster_whisper" (
    echo [初始化] 安装依赖包（首次运行需要几分钟）...
    pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络连接
        pause
        exit /b 1
    )
)

echo.
echo [启动] 本地语音识别服务 (faster-whisper)
echo [地址] http://localhost:8082
echo [健康检查] http://localhost:8082/health
echo [识别接口] http://localhost:8082/api/recognize
echo.
echo 提示：首次启动会自动下载模型（small 约 500MB），请耐心等待
echo 按 Ctrl+C 停止服务
echo.

python app.py

pause
