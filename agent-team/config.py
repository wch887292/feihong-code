"""全局配置：从环境变量与 .env 文件读取，禁止硬编码密钥。

- LLM_PROVIDER=mock   无 API Key 时用本地确定性 mock，跑通全链路
- LLM_PROVIDER=doubao 接入豆包大模型（需配置 DOUBAO_API_KEY / DOUBAO_MODEL）
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def _load_dotenv(path: Path) -> None:
    """极简 .env 加载器（KEY=VALUE，忽略 # 注释与空行）。"""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv(BASE_DIR / ".env")

# 数据存储
DB_PATH = os.getenv("DB_PATH", str(BASE_DIR / "feihongzhi.db"))

# LLM
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "mock")          # mock | doubao
DOUBAO_API_KEY = os.getenv("DOUBAO_API_KEY", "")
DOUBAO_MODEL = os.getenv("DOUBAO_MODEL", "doubao-seed-1-6-250615")
DOUBAO_BASE_URL = os.getenv("DOUBAO_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")

# 调度
MAX_RETRY = int(os.getenv("MAX_RETRY", "3"))              # 失败重试上限
ALERT_LEVEL = os.getenv("ALERT_LEVEL", "log")             # log | stdout
