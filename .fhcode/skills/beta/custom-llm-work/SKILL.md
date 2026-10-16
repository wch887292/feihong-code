---
name: custom-llm-work
description: 使用自定义大模型（本地 Ollama 模型或远程 OpenAI 兼容 API，如 DeepSeek/OpenRouter）处理工作内容。当用户要求"用自定义大模型/自定义模型/本地模型/Ollama/DeepSeek/OpenRouter/qwen3 处理工作"、或要求生成销售跟进话术、工作总结（按固定模板）、获客文案、客户分析、翻译、文案润色等，且需要指定使用自定义模型而非豆包内置模型时使用。也用于查看、切换、配置自定义模型提供方。
---

# 自定义大模型工作处理

用本机 `custom_llm` 模块调用自定义大模型处理工作内容，结果保存为 Markdown 文件。

## 模块位置

- 模块根目录：`C:\Users\Administrator\AppData\Local\Doubao\custom_llm`
- 配置中心：`C:\Users\Administrator\AppData\Local\Doubao\custom_llm\config.json`
- 调用脚本：本技能 `scripts/run_work.py`（推荐，稳定可靠）

## 快速开始

```powershell
python "<技能目录>\scripts\run_work.py" --type 销售跟进 --text "客户：张总，建材批发，对返利感兴趣"
python "<技能目录>\scripts\run_work.py" --type 工作总结 --input 今日记录.txt --output 总结.md
python "<技能目录>\scripts\run_work.py" --type 翻译 --text "hello world" --provider ollama
```

必须用绝对路径调用脚本（技能目录 = `C:\Users\Administrator\AppData\Local\Doubao\User Data\Default\.doubao\agent_mode\workspace\.user_skills\custom-llm-work\scripts\run_work.py`）。

## 工作类型

`--type` 支持：通用、销售跟进、获客文案、工作总结、客户分析、翻译、文案润色。

- 工作总结按固定模板输出：一、今日成果（电话量、微信添加、新增意向客户、约拜访/面访）；二、工作心得体会；三、明日工作计划。数据缺失处标注【待补充】，不编造数字。
- 输入方式：`--text` 直接传文本，或 `--input` 传文件路径（自动识别 UTF-8/GBK 编码）。

## 执行流程

1. 确认 `C:\Users\Administrator\AppData\Local\Doubao\custom_llm` 存在；不存在则先告知用户模块缺失。
2. 若生效提供方为 ollama：检查 `http://127.0.0.1:11434/api/tags` 是否可访问；不可访问时提示用户启动 Ollama（`C:\Users\Administrator\AppData\Local\Programs\Ollama\ollama app.exe`）。
3. 调用 `scripts/run_work.py` 处理（推荐 `--json` 获取结构化结果）。
4. 读取输出文件（UTF-8），把结果内容直接呈现给用户，并给出文件路径。

## 模型提供方管理

查看/切换/配置用 `settings.py`：

```powershell
python "C:\Users\Administrator\AppData\Local\Doubao\custom_llm\settings.py" list        # 查看
python "C:\Users\Administrator\AppData\Local\Doubao\custom_llm\settings.py" test ollama # 测试连通
python "C:\Users\Administrator\AppData\Local\Doubao\custom_llm\settings.py" set ollama model qwen3:8b
python "C:\Users\Administrator\AppData\Local\Doubao\custom_llm\settings.py" active deepseek
```

内置提供方：ollama（本地，默认模型 qwen3:8b）、deepseek、openrouter。任意 OpenAI 兼容接口可用 `settings.py add` 添加。

## 注意事项

- qwen3 等推理模型思考会占用 token：`run_work.py` 已内置扩容重试，无需手动处理；但勿把 `max_tokens` 设得过小。
- API Key 明文存于 config.json，展示时打码，勿外传。
- 不修改豆包客户端本身；本技能只路由工作内容到自定义模型。
