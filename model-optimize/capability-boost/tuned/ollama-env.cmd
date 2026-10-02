@echo off
REM ───────────────────────────────────────────
REM 飞虹 Code · Ollama 服务级环境变量（消测定稿版）
REM 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
REM
REM ⚠️ 2026-10-01 三轮消测定稿：本机 i5-12400 纯 CPU 推理下，
REM    仅 KEEP_ALIVE 有真实收益；其余三个参数为负优化，已从建议中移除。
REM    详细数据见 capability-boost/提升对比报告.md
REM
REM 用法：先运行本脚本，再在同一窗口启动 ollama serve
REM ───────────────────────────────────────────

echo ========================================
echo   飞虹 Code · Ollama 环境变量（消测定稿版）
echo ========================================
echo.

REM ─── 唯一推荐：OLLAMA_KEEP_ALIVE ───
REM 作用：模型在内存中的保留时长（默认 5m，超时卸载）
REM 实测收益：冷启动 TTFT 5.12s → 0.15s（-97%），1 小时内重复请求零冷加载
REM 代价：32GB 内存常驻 2-3 个模型（约 10-15GB）
set OLLAMA_KEEP_ALIVE=1h
echo [1/1] OLLAMA_KEEP_ALIVE=1h  -- 模型常驻 1 小时，冷启动延迟 -97%%

echo.
echo ─── 以下参数消测证伪，请勿设置（数据见提升对比报告.md）───
echo [x] OLLAMA_NUM_PARALLEL=2    纯 CPU 负优化：coder 吞吐 -6.6%%~-11.6%%
echo [x] OLLAMA_KV_CACHE_TYPE=q8_0 负优化：prefill 慢 39%%（6.17s→8.57s），GPU 场景经验不适用 CPU
echo [x] OLLAMA_FLASH_ATTENTION=1 CPU 后端无收益，等价或更慢
echo [x] OLLAMA_NUM_GPU=0         中性（核显不可用，不设也一样）
echo.
echo 现在启动服务： ollama serve
