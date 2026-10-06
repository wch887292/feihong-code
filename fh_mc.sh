#!/usr/bin/env bash
# ============================================================
# 飞虹 Code -> MediaCrawler 爬虫调用脚本
# 用法: bash fh_mc.sh --platform <xhs|dy|ks|zhihu> --keywords "<关键词,关键词2>" [--pages <N>]
# 示例: bash fh_mc.sh --platform xhs --keywords "鞋材,泉州鞋业"
# 说明: 修改 /www/dk_project/MediaCrawler/config/base_config.py 的 PLATFORM/KEYWORDS 后执行爬虫,
#       数据落盘到 data/<platform>/jsonl/ 下; 跑前自动备份上一份配置为 base_config.fh_prev.py
# ============================================================
MC_DIR=/www/dk_project/MediaCrawler
CFG=$MC_DIR/config/base_config.py
PLATFORM="xhs"
KEYWORDS="企业管理,合伙人,AI赋能,企业AI化"
PAGES=1

# ---- 解析参数 ----
while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2;;
    --keywords) KEYWORDS="$2"; shift 2;;
    --pages)    PAGES="$2";   shift 2;;
    *) echo "未知参数: $1"; shift;;
  esac
done

# ---- 校验平台 ----
case "$PLATFORM" in
  xhs|dy|ks|zhihu) ;;
  *) echo "[fh_mc] 不支持平台: $PLATFORM (支持 xhs=小红书 / dy=抖音 / ks=快手 / zhihu=知乎)"; exit 1;;
esac

if [[ -z "$KEYWORDS" ]]; then
  echo "[fh_mc] 关键词不能为空"; exit 1
fi

# ---- 备份上一份配置（覆盖前保留，避免丢失） ----
if [[ -f "$CFG" ]]; then
  cp "$CFG" "$CFG.fh_prev.py" 2>/dev/null
fi

# ---- 用 python 安全替换 PLATFORM / KEYWORDS ----
cd "$MC_DIR" || { echo "[fh_mc] 目录不存在: $MC_DIR"; exit 1; }
python3 - "$PLATFORM" "$KEYWORDS" <<'PYEOF'
import re, sys
plat, kw = sys.argv[1], sys.argv[2]
cfg = "/www/dk_project/MediaCrawler/config/base_config.py"
s = open(cfg, encoding="utf-8").read()
s = re.sub(r'^PLATFORM = .*$', 'PLATFORM = "%s"' % plat, s, flags=re.M)
kw_clean = kw.replace('"', '').replace("'", "")
s = re.sub(r'^KEYWORDS = .*$', 'KEYWORDS = "%s"' % kw_clean, s, flags=re.M)
open(cfg, "w", encoding="utf-8").write(s)
print("[fh_mc] 配置已更新: platform=%s keywords=%s" % (plat, kw_clean))
PYEOF

echo "[fh_mc] 开始爬取 $PLATFORM 关键词: $KEYWORDS (pages=$PAGES)"

# ---- 执行爬虫 ----
if command -v uv >/dev/null 2>&1; then
  UV="$HOME/.local/bin/uv"
  [[ -x "$UV" ]] || UV="uv"
  "$UV" run main.py --platform "$PLATFORM" --type search 2>&1 | tail -40
else
  echo "[fh_mc] 未找到 uv，尝试 python"
  python3 main.py --platform "$PLATFORM" --type search 2>&1 | tail -40
fi

# ---- 输出结果摘要 ----
DATE=$(date +%F)
DATA_DIR="$MC_DIR/data/$PLATFORM/jsonl"
echo "=========================================="
echo "[fh_mc] 爬取完成。结果文件:"
for f in "$DATA_DIR"/search_contents_"$DATE".jsonl "$DATA_DIR"/search_comments_"$DATE".jsonl; do
  if [[ -f "$f" ]]; then
    CNT=$(wc -l < "$f" 2>/dev/null)
    echo "  $f  ( $CNT 条 )"
  fi
done
echo "  数据目录: $DATA_DIR"
echo "=========================================="

# ---- 自动同步到飞书多维表格（仅小红书；飞书表为「小红书内容库」） ----
if [[ "$PLATFORM" == "xhs" ]]; then
  echo "[fh_mc] 自动同步到飞书多维表格..."
  python3 "$MC_DIR/sync_to_feishu.py" --platform xhs 2>&1 | tail -20
  echo "[fh_mc] 同步完成"
fi
