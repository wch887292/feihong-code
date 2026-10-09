@echo off
rem FHCode web service restart (ASCII-only; unicode-safe via %%~dp0 relative navigation)
rem Feiyang Qiyuan R&D Center
cd /d "%~dp0.."
for /f "tokens=5" %%i in ('netstat -ano ^| findstr :8082 ^| findstr LISTENING') do taskkill /PID %%i /F >nul 2>&1
timeout /t 2 /nobreak >nul
rem FH_WEB_TOKEN 由服务端自动从 ~/.feihong-code/web-token.json 持久化读取，无需在此硬编码（敏感信息不入库）
set "FH_CLOUD_KEEPALIVE=1"
start "fhweb" /min "C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" "start-web.js" --port 8082
exit /b 0
