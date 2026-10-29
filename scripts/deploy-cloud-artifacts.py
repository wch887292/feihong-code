#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
deploy-cloud-artifacts.py
=========================
为云端中继 fhcode-v885 的 cloud-bridge.js 增量插入「产物回传」接收端点：
    POST /api/bridge/command/:cmdId/artifacts   （家电脑上报任务产物）
仅依赖云端副本本就存在的 loadBridgeCommands / saveBridgeCommands（progress 端点同款）。

设计铁律（沿用 P0 部署）：
  - 仅增量插入单端点，绝整体覆盖（云端是 8.8.5 精简副本，整体覆盖会丢其他逻辑）
  - 插入前自动备份 *.bak-YYYYMMDD
  - 插入后 node --check 语法校验，失败自动回滚备份

用法：
  本地验证（不落盘，仅看插入点）：
    python3 deploy-cloud-artifacts.py --file dist/web/routes/cloud-bridge.js --dry-run
  服务器执行（真实插入 + 校验）：
    python3 deploy-cloud-artifacts.py --file /www/dk_project/fhcode-v885/dist/web/routes/cloud-bridge.js
  完成后：pm2 restart fhcode-v885
"""
import argparse
import datetime
import os
import shutil
import subprocess
import sys

# 要插入的 artifacts 端点代码块（与本地 dist 262-293 行一致，自包含、不依赖 8.13 独有函数）
ARTIFACTS_BLOCK = """    // 电脑端：上报任务产物文件（2026-10-28 新增，让手机端查看任务产出物）
    // body: { deviceId, items: [{ relPath, name, size, kind, contentBase64? }, ...] }
    // 校验 deviceId 与 cmdId 匹配，不匹配返回 404；items 上限 50 条。
    app.post('/api/bridge/command/:cmdId/artifacts', (req, res) => {
        const cmdId = req.params.cmdId;
        const body = (req.body ?? {});
        const deviceId = String(body?.deviceId ?? '').trim();
        if (!deviceId) {
            res.status(400).json({ ok: false, error: '缺少 deviceId' });
            return;
        }
        const list = loadBridgeCommands();
        const cmd = list.find((c) => c.cmdId === cmdId && c.deviceId === deviceId);
        if (!cmd) {
            res.status(404).json({ ok: false, error: '指令不存在或 deviceId 不匹配' });
            return;
        }
        const rawItems = Array.isArray(body?.items) ? body.items : [];
        const items = rawItems
            .filter((it) => it && typeof it.relPath === 'string' && typeof it.name === 'string')
            .map((it) => ({
                relPath: String(it.relPath),
                name: String(it.name),
                size: Number(it.size) || 0,
                kind: String(it.kind || 'other'),
                ...(typeof it.contentBase64 === 'string' && it.contentBase64 ? { contentBase64: it.contentBase64 } : {}),
            }))
            .slice(0, 50);
        cmd.artifacts = items;
        saveBridgeCommands(list);
        res.json({ ok: true, cmdId, count: cmd.artifacts.length });
    });
"""

PROGRESS_ANCHOR = "app.post('/api/bridge/command/:cmdId/progress'"


def find_progress_end(src):
    """定位 progress 端点路由函数体结束位置（括号配平），返回其后插入点。"""
    idx = src.find(PROGRESS_ANCHOR)
    if idx == -1:
        raise SystemExit("❌ 未找到 progress 端点锚点，云端文件结构可能不同，请人工核对")
    p = src.find('(', idx)
    depth = 0
    i = p
    while i < len(src):
        ch = src[i]
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth == 0:
                end = i + 1
                while end < len(src) and src[end] in ' \t\n\r;':
                    end += 1
                return end
        i += 1
    raise SystemExit("❌ 括号未配平，progress 端点结构异常")


def main():
    ap = argparse.ArgumentParser(description="云端 cloud-bridge artifacts 端点增量部署")
    ap.add_argument('--file', required=True, help='云端 cloud-bridge.js 绝对路径')
    ap.add_argument('--dry-run', action='store_true', help='仅打印插入点，不落盘')
    args = ap.parse_args()

    f = args.file
    if not os.path.exists(f):
        raise SystemExit(f"❌ 文件不存在: {f}")

    src = open(f, 'r', encoding='utf-8').read()

    if 'command/:cmdId/artifacts' in src:
        print("⚠️ artifacts 端点已存在，无需重复插入（跳过）")
        return

    insert_at = find_progress_end(src)
    new_src = src[:insert_at] + "\n" + ARTIFACTS_BLOCK + src[insert_at:]

    if args.dry_run:
        print("=== DRY RUN：progress 结尾 → artifacts 起点（前后 200 字符） ===")
        print(new_src[insert_at - 200: insert_at + len(ARTIFACTS_BLOCK) + 60])
        print("\n✅ 插入点定位成功（dry-run 未落盘）")
        return

    # 备份
    bak = f + ".bak-" + datetime.date.today().strftime("%Y%m%d")
    if not os.path.exists(bak):
        shutil.copy2(f, bak)
        print("📦 备份:", bak)
    else:
        print("📦 备份已存在，复用:", bak)

    open(f, 'w', encoding='utf-8').write(new_src)

    # 语法校验
    r = subprocess.run(['node', '--check', f], capture_output=True, text=True)
    if r.returncode != 0:
        print("❌ node --check 失败，已回滚备份")
        shutil.copy2(bak, f)
        print(r.stderr)
        raise SystemExit(1)

    print("✅ 插入成功且语法校验通过")
    print("➡️  下一步执行：pm2 restart fhcode-v885")


if __name__ == '__main__':
    main()
