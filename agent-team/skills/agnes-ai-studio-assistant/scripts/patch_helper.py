# -*- coding: utf-8 -*-
"""
Agnes AI Studio 大文件 Patch 辅助工具
用于安全修改 drama.py / anchor.py / index.html 等大文件
解决 Edit 工具对大文件频繁失败的问题

使用方式：
    from patch_helper import PatchHelper
    helper = PatchHelper("path/to/file.py")
    helper.replace("old_string", "new_string")
    helper.save()
"""

import os
import re
from pathlib import Path
from typing import List, Dict, Tuple, Optional


class PatchHelper:
    """大文件安全 Patch 工具"""

    def __init__(self, file_path: str, encoding: str = "utf-8"):
        self.file_path = file_path
        self.encoding = encoding
        self.original_content = ""
        self.current_content = ""
        self.patches: List[Dict] = []
        self._load()

    def _load(self):
        """加载文件内容"""
        with open(self.file_path, "r", encoding=self.encoding) as f:
            self.original_content = f.read()
        self.current_content = self.original_content

    def replace(self, old: str, new: str, count: int = 1,
                required: bool = True) -> bool:
        """
        字符串替换

        Args:
            old: 要替换的旧字符串
            new: 新字符串
            count: 替换次数（1=只替换第一个，0=全部）
            required: 是否必须匹配成功（True=未匹配则抛异常）

        Returns:
            是否替换成功
        """
        if old not in self.current_content:
            if required:
                raise ValueError(f"未找到要替换的字符串: {old[:100]}...")
            return False

        if count == 1:
            self.current_content = self.current_content.replace(old, new, 1)
        else:
            self.current_content = self.current_content.replace(old, new)

        self.patches.append({
            "type": "replace",
            "old": old[:100],
            "new": new[:100],
            "count": count
        })
        return True

    def replace_regex(self, pattern: str, replacement: str,
                      flags: int = 0, required: bool = True) -> bool:
        """
        正则表达式替换

        Args:
            pattern: 正则表达式
            replacement: 替换字符串
            flags: 正则标志（re.MULTILINE 等）
            required: 是否必须匹配成功

        Returns:
            是否替换成功
        """
        if not re.search(pattern, self.current_content, flags):
            if required:
                raise ValueError(f"正则未匹配: {pattern}")
            return False

        self.current_content = re.sub(pattern, replacement, self.current_content, flags=flags)
        self.patches.append({
            "type": "regex",
            "pattern": pattern[:100],
            "replacement": replacement[:100]
        })
        return True

    def insert_after(self, anchor: str, content: str,
                     required: bool = True) -> bool:
        """
        在指定字符串之后插入内容

        Args:
            anchor: 锚点字符串
            content: 要插入的内容
            required: 是否必须找到锚点

        Returns:
            是否插入成功
        """
        if anchor not in self.current_content:
            if required:
                raise ValueError(f"未找到锚点: {anchor[:100]}")
            return False

        self.current_content = self.current_content.replace(
            anchor, anchor + content, 1
        )
        self.patches.append({
            "type": "insert_after",
            "anchor": anchor[:100],
            "content": content[:100]
        })
        return True

    def insert_before(self, anchor: str, content: str,
                      required: bool = True) -> bool:
        """
        在指定字符串之前插入内容
        """
        if anchor not in self.current_content:
            if required:
                raise ValueError(f"未找到锚点: {anchor[:100]}")
            return False

        self.current_content = self.current_content.replace(
            anchor, content + anchor, 1
        )
        self.patches.append({
            "type": "insert_before",
            "anchor": anchor[:100],
            "content": content[:100]
        })
        return True

    def add_function(self, function_code: str, before_anchor: str = None,
                     after_anchor: str = None) -> bool:
        """
        添加一个函数（自动处理缩进和空行）

        Args:
            function_code: 函数代码
            before_anchor: 在哪个函数之前插入
            after_anchor: 在哪个函数之后插入

        Returns:
            是否添加成功
        """
        # 确保函数代码前后有足够的空行
        function_code = function_code.strip() + "\n\n\n"

        if before_anchor:
            return self.insert_before(before_anchor, function_code)
        elif after_anchor:
            return self.insert_after(after_anchor, function_code)
        else:
            # 默认追加到文件末尾
            self.current_content = self.current_content.rstrip() + "\n\n\n" + function_code
            self.patches.append({"type": "append", "content": function_code[:100]})
            return True

    def contains(self, pattern: str) -> bool:
        """检查内容是否包含指定字符串"""
        return pattern in self.current_content

    def count_occurrences(self, pattern: str) -> int:
        """统计字符串出现次数"""
        return self.current_content.count(pattern)

    def get_line_number(self, pattern: str) -> Optional[int]:
        """获取字符串第一次出现的行号"""
        lines = self.current_content.split("\n")
        for i, line in enumerate(lines, 1):
            if pattern in line:
                return i
        return None

    def diff_summary(self) -> str:
        """生成修改摘要"""
        lines_old = self.original_content.split("\n")
        lines_new = self.current_content.split("\n")

        # 简单的差异统计
        added = len(lines_new) - len(lines_old)
        return (f"文件: {self.file_path}\n"
                f"原始行数: {len(lines_old)}\n"
                f"修改后行数: {len(lines_new)}\n"
                f"行数变化: {added:+d}\n"
                f"Patch 次数: {len(self.patches)}")

    def save(self, backup: bool = True) -> str:
        """
        保存修改

        Args:
            backup: 是否创建备份文件

        Returns:
            保存的文件路径
        """
        if backup:
            backup_path = self.file_path + ".bak"
            with open(backup_path, "w", encoding=self.encoding) as f:
                f.write(self.original_content)

        with open(self.file_path, "w", encoding=self.encoding) as f:
            f.write(self.current_content)

        return self.file_path

    def revert(self):
        """撤销所有修改（恢复到原始内容）"""
        self.current_content = self.original_content
        self.patches = []

    def validate_python_syntax(self) -> Tuple[bool, str]:
        """
        验证 Python 语法（仅对 .py 文件有效）

        Returns:
            (是否通过, 错误信息)
        """
        if not self.file_path.endswith(".py"):
            return True, "非 Python 文件，跳过语法检查"

        import py_compile
        import tempfile
        try:
            # 写入临时文件进行语法检查
            with tempfile.NamedTemporaryFile(mode="w", suffix=".py",
                                               delete=False, encoding=self.encoding) as f:
                f.write(self.current_content)
                temp_path = f.name

            py_compile.compile(temp_path, doraise=True)
            os.unlink(temp_path)
            return True, "语法检查通过"
        except py_compile.PyCompileError as e:
            return False, str(e)
        except Exception as e:
            return False, str(e)


# ==================== 便捷函数 ====================

def quick_patch(file_path: str, replacements: List[Tuple[str, str]],
                save: bool = True, validate: bool = True) -> PatchHelper:
    """
    快速批量替换（最常用的模式）

    Args:
        file_path: 文件路径
        replacements: [(old, new), ...] 替换列表
        save: 是否自动保存
        validate: 是否验证 Python 语法

    Returns:
        PatchHelper 实例

    Example:
        helper = quick_patch("src/routes/drama.py", [
            ("old_string_1", "new_string_1"),
            ("old_string_2", "new_string_2"),
        ])
    """
    helper = PatchHelper(file_path)
    for old, new in replacements:
        helper.replace(old, new)

    if validate:
        passed, msg = helper.validate_python_syntax()
        if not passed:
            print(f"⚠️ 语法检查失败: {msg}")
            print("修改未保存，请检查替换内容")
            return helper

    if save:
        helper.save()
        print(f"✅ 已保存: {file_path}")
        print(helper.diff_summary())

    return helper


def add_api_endpoint(file_path: str, endpoint_code: str,
                      before_anchor: str = None, save: bool = True) -> PatchHelper:
    """
    快速添加 API 端点（Flask 路由）

    Args:
        file_path: routes/*.py 文件路径
        endpoint_code: 端点代码（包含 @blueprint.route 装饰器和函数）
        before_anchor: 在哪个端点之前插入（如 "@drama_bp.route('/api/drama/merge/confirm'")
        save: 是否自动保存

    Returns:
        PatchHelper 实例
    """
    helper = PatchHelper(file_path)
    helper.add_function(endpoint_code, before_anchor=before_anchor)

    if save:
        passed, msg = helper.validate_python_syntax()
        if passed:
            helper.save()
            print(f"✅ API 端点已添加: {file_path}")
        else:
            print(f"⚠️ 语法检查失败: {msg}")

    return helper


if __name__ == "__main__":
    # 示例用法
    print("PatchHelper 使用示例:")
    print()
    print("1. 批量替换:")
    print("   helper = quick_patch('src/routes/drama.py', [")
    print("       ('old_string', 'new_string'),")
    print("   ])")
    print()
    print("2. 添加 API 端点:")
    print("   add_api_endpoint('src/routes/drama.py',")
    print("       '''@drama_bp.route('/api/drama/new-endpoint', methods=['POST'])")
    print("       def new_endpoint():")
    print("           return jsonify({'success': True})''',")
    print("       before_anchor='@drama_bp.route(\\'/api/drama/merge/confirm\\'")
    print("   )")
