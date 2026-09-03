#!/usr/bin/env python3
"""
批量修复所有 django 实例的环境兼容性问题。
修复内容：
1. 创建 tests/test_sqlite.py - 测试 settings
2. 创建 tests/urls.py - URL 配置
3. 修复 django/utils/translation/trans_real.py - 移除 codeset 参数
"""
import os
import sys

BASE = os.path.join(os.path.dirname(__file__), "..")
WORK = os.path.join(BASE, "bench", "real", "work")

TEST_SQLITE_CONTENT = '''"""
Django 测试套件的 SQLite settings 模块。
runtests.py 会动态添加测试应用到 INSTALLED_APPS。
"""
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    },
    'other': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    },
}

INSTALLED_APPS = [
    'django.contrib.contenttypes',
    'django.contrib.auth',
    'django.contrib.sites',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.admin.apps.SimpleAdminConfig',
    'django.contrib.staticfiles',
]

SECRET_KEY = 'django-tests-secret-key-for-testing-only'
ALLOWED_HOSTS = ['*']
DEBUG = True

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
]

ROOT_URLCONF = 'urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

USE_TZ = True
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
DEFAULT_AUTO_FIELD = 'django.db.models.AutoField'
SITE_ID = 1
'''

URLS_CONTENT = '''"""
Django 测试套件的 URL 配置。
"""
from django.urls import path

urlpatterns = []
'''


def fix_trans_real(trans_real_path):
    """修复 trans_real.py，移除 codeset 参数。"""
    if not os.path.exists(trans_real_path):
        return False
    try:
        content = open(trans_real_path, encoding="utf-8").read()
        if "codeset='utf-8'," in content:
            content = content.replace("            codeset='utf-8',\n", "")
            open(trans_real_path, "w", encoding="utf-8").write(content)
            return True
    except Exception as e:
        print(f"  修复失败: {e}")
    return False


def main():
    print("=" * 60)
    print("批量修复 django 实例环境兼容性")
    print("=" * 60)

    if not os.path.isdir(WORK):
        print(f"工作目录不存在: {WORK}")
        return

    django_dirs = []
    for d in os.listdir(WORK):
        dp = os.path.join(WORK, d)
        if not os.path.isdir(dp):
            continue
        if d.startswith("django__django-") and os.path.isdir(os.path.join(dp, "django")):
            django_dirs.append(d)

    print(f"\n找到 {len(django_dirs)} 个 django 实例")

    fixed_count = 0
    for d in sorted(django_dirs):
        dp = os.path.join(WORK, d)
        tests_dir = os.path.join(dp, "tests")
        if not os.path.isdir(tests_dir):
            continue

        print(f"\n[{fixed_count+1}/{len(django_dirs)}] {d}")

        # 1. 创建 test_sqlite.py
        test_sqlite_path = os.path.join(tests_dir, "test_sqlite.py")
        if not os.path.exists(test_sqlite_path):
            open(test_sqlite_path, "w", encoding="utf-8").write(TEST_SQLITE_CONTENT)
            print("  创建 test_sqlite.py")
        else:
            print("  test_sqlite.py 已存在")

        # 2. 创建 urls.py
        urls_path = os.path.join(tests_dir, "urls.py")
        if not os.path.exists(urls_path):
            open(urls_path, "w", encoding="utf-8").write(URLS_CONTENT)
            print("  创建 urls.py")
        else:
            print("  urls.py 已存在")

        # 3. 修复 trans_real.py
        trans_real_path = os.path.join(dp, "django", "utils", "translation", "trans_real.py")
        if fix_trans_real(trans_real_path):
            print("  修复 trans_real.py (移除 codeset)")
        else:
            print("  trans_real.py 无需修复或不存在")

        fixed_count += 1

    print(f"\n{'='*60}")
    print(f"修复完成: {fixed_count}/{len(django_dirs)} 个实例")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
