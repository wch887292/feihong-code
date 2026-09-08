"""
Python 手动 patch 应用器
解析模型生成的 patch，忽略上下文行，只应用新增(+)和删除(-)行
通过智能匹配在目标文件中查找插入位置
"""
import re
from pathlib import Path


def parse_patch(patch_content):
    """解析 patch，返回每个文件的修改列表"""
    files = {}
    current_file = None
    current_hunk = None

    lines = patch_content.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i]

        # 文件头：--- a/path 或 +++ b/path
        if line.startswith('--- '):
            # 提取文件路径
            match = re.match(r'^--- [ab]/(.+)$', line)
            if match:
                current_file = match.group(1)
                if current_file not in files:
                    files[current_file] = []
            i += 1
            continue

        if line.startswith('+++ '):
            i += 1
            continue

        # hunk 头：@@ -start,count +start,count @@
        if line.startswith('@@'):
            current_hunk = {'additions': [], 'deletions': [], 'context': []}
            if current_file and current_hunk:
                files[current_file].append(current_hunk)
            i += 1
            continue

        # hunk 内容
        if current_hunk is not None:
            if line.startswith('+'):
                current_hunk['additions'].append(line[1:])
            elif line.startswith('-'):
                current_hunk['deletions'].append(line[1:])
            elif line.startswith(' '):
                current_hunk['context'].append(line[1:])
            # 空行或其他行忽略
        i += 1

    return files


def find_insert_position(file_lines, additions, deletions, context_lines):
    """智能查找插入位置
    策略：
    1. 如果有删除行，先找到删除行的位置，在其位置插入新增行
    2. 如果只有新增行，使用上下文行匹配位置
    3. 如果都没有，在文件末尾追加
    """
    # 策略1：匹配删除行
    if deletions:
        for del_line in deletions:
            del_stripped = del_line.strip()
            if not del_stripped:
                continue
            for i, line in enumerate(file_lines):
                if line.strip() == del_stripped:
                    return i  # 在删除行的位置插入

    # 策略2：使用上下文行匹配（取最后一个非空上下文行）
    if context_lines:
        non_empty_context = [c for c in context_lines if c.strip()]
        if non_empty_context:
            last_context = non_empty_context[-1].strip()
            for i, line in enumerate(file_lines):
                if line.strip() == last_context:
                    return i + 1  # 在最后一个上下文行之后插入

    # 策略3：使用新增行的前一行作为参考（如果新增行是 import，则在 import 区域插入）
    if additions:
        first_add = additions[0].strip()
        if first_add.startswith('import ') or first_add.startswith('from '):
            # 在最后一个 import 行之后插入
            last_import = -1
            for i, line in enumerate(file_lines):
                stripped = line.strip()
                if stripped.startswith('import ') or stripped.startswith('from '):
                    last_import = i
            if last_import >= 0:
                return last_import + 1

    # 策略4：文件末尾
    return len(file_lines)


def apply_patch_to_file(file_path, file_modifications):
    """将修改应用到单个文件"""
    if not file_path.exists():
        return False, f"文件不存在: {file_path}"

    original_content = file_path.read_text(encoding="utf-8")
    file_lines = original_content.split('\n')

    for hunk in file_modifications:
        additions = hunk['additions']
        deletions = hunk['deletions']
        context = hunk['context']

        if not additions and not deletions:
            continue

        # 查找插入位置
        pos = find_insert_position(file_lines, additions, deletions, context)

        # 先删除（如果有删除行）
        if deletions:
            del_stripped = [d.strip() for d in deletions if d.strip()]
            new_lines = []
            deleted = 0
            for line in file_lines:
                if line.strip() in del_stripped and deleted < len(del_stripped):
                    deleted += 1
                    continue
                new_lines.append(line)
            file_lines = new_lines
            # 重新计算位置（删除后位置可能变化）
            pos = min(pos, len(file_lines))

        # 插入新增行
        for add_line in reversed(additions):
            file_lines.insert(pos, add_line)

    # 写回文件
    new_content = '\n'.join(file_lines)
    file_path.write_text(new_content, encoding="utf-8")

    return True, f"应用成功，新增 {sum(len(h['additions']) for h in file_modifications)} 行"


def apply_patch(patch_content, repo_root):
    """应用 patch 到 repo
    返回 (success, message)
    """
    files = parse_patch(patch_content)

    if not files:
        return False, "patch 中没有文件修改"

    results = []
    for file_path_str, modifications in files.items():
        file_path = Path(repo_root) / file_path_str
        success, msg = apply_patch_to_file(file_path, modifications)
        results.append(f"{file_path_str}: {msg}")
        if not success:
            return False, '; '.join(results)

    return True, '; '.join(results)


if __name__ == "__main__":
    # 测试
    import json
    with open(r"H:\Muse Code复刻\bench\real\predictions_DeepSeek-V4-Flash.jsonl", encoding="utf-8") as f:
        for line in f:
            obj = json.loads(line)
            if obj['instance_id'] == 'psf__requests-2148':
                patch = obj['model_patch']
                break

    files = parse_patch(patch)
    print("解析结果:")
    for fpath, hunks in files.items():
        print(f"  文件: {fpath}")
        for i, hunk in enumerate(hunks):
            print(f"    hunk {i+1}: 新增 {len(hunk['additions'])} 行, 删除 {len(hunk['deletions'])} 行, 上下文 {len(hunk['context'])} 行")
            for add in hunk['additions']:
                print(f"      +: {add}")
            for dele in hunk['deletions']:
                print(f"      -: {dele}")
