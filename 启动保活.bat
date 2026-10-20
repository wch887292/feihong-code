@echo off
chcp 65001 >nul
cd /d %~dp0

REM 本地 fhcode 常驻启动器（Windows）
REM 由计划任务 FHKeepalive（触发器：登录时 / 管理员 / 最高权限）调用。
REM 作用：拉起本地 Web 控制台 serve(18085) + 云端 bridge「家里电脑」+ 本地 bridge「家里电脑-本地」。
REM 源码见 src/web/cloud-keepalive.ts；dist/web/cloud-keepalive.js 由 `npm run build` 生成。

set "NODE_EXE="
if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" (
  set "NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
) else (
  set "NODE_EXE=node"
)

"%NODE_EXE%" dist/web/cloud-keepalive.js
if %errorlevel% neq 0 (
  echo [启动保活] 启动失败，请确认 Node.js 可用（加入 PATH）或修正脚本中的 NODE_EXE 路径。
)
