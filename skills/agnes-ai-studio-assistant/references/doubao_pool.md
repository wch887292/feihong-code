# 豆包 Pool 配置详解

> 豆包 Pool 是 Agnes AI Studio 的高级功能，支持国内/海外双区域、多 API Key 自动轮询、失败自动切换。

---

## 目录

1. [功能概述](#功能概述)
2. [配置方法](#配置方法)
3. [配置项说明](#配置项说明)
4. [工作原理](#工作原理)
5. [支持的模型](#支持的模型)
6. [获取 API Key](#获取-api-key)
7. [常见问题](#常见问题)

---

## 功能概述

豆包 Pool 提供以下能力：

- ✅ **国内/海外双区域**：分别配置国内和海外端点及 API Key
- ✅ **多 Key 轮询**：支持 round-robin（轮询）和 random（随机）两种策略
- ✅ **失败自动切换**：某个 Key 调用失败后自动标记，进入 300 秒冷却，下一次请求自动切换到下一个可用 Key
- ✅ **全模型覆盖**：所有豆包模型（文本/图片/视频）统一走 Pool 路由
- ✅ **自动恢复**：冷却期结束后，Key 自动恢复可用

---

## 配置方法

编辑项目根目录的 `config.json`，添加 `doubao_pool` 字段：

```json
{
  "api_key": "",
  "doubao_pool": {
    "enabled": true,
    "preferred_region": "auto",
    "strategy": "round_robin",
    "domestic": {
      "base_url": "https://ark.cn-beijing.volces.com/api/v3",
      "keys": [
        "sk-你的第一个国内Key",
        "sk-你的第二个国内Key",
        "sk-你的第三个国内Key"
      ]
    },
    "overseas": {
      "base_url": "https://你的海外代理端点.com/v1",
      "keys": [
        "sk-你的海外Key1",
        "sk-你的海外Key2"
      ]
    }
  },
  "custom_models": [],
  "ollama": { "enabled": false },
  "default_models": {}
}
```

**最小配置（仅国内，单 Key）：**

```json
{
  "doubao_pool": {
    "enabled": true,
    "domestic": {
      "base_url": "https://ark.cn-beijing.volces.com/api/v3",
      "keys": ["sk-你的Key"]
    }
  }
}
```

配置完成后，**重启应用**（`python app.py`）生效。

---

## 配置项说明

| 配置项 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `enabled` | bool | 是 | `false` | 是否启用 Pool |
| `preferred_region` | string | 否 | `auto` | 优先区域：`domestic`/`overseas`/`auto` |
| `strategy` | string | 否 | `round_robin` | 轮询策略：`round_robin`/`random` |
| `domestic.base_url` | string | 否 | 火山引擎国内端点 | 国内 API 端点 |
| `domestic.keys` | array | 否 | `[]` | 国内 API Key 列表 |
| `overseas.base_url` | string | 否 | - | 海外 API 端点 |
| `overseas.keys` | array | 否 | `[]` | 海外 API Key 列表 |

### preferred_region 说明

- `domestic` - 只使用国内区域的 Key
- `overseas` - 只使用海外区域的 Key
- `auto` - 优先使用国内，国内全部不可用时自动切换到海外（推荐）

### strategy 说明

- `round_robin` - 轮询，按顺序依次使用每个 Key（推荐，负载均衡）
- `random` - 随机选择一个 Key

---

## 工作原理

### 1. 调用流程

```
用户请求 → 检测是否为豆包模型 → 是 → 从 Pool 获取 Key 和端点
                                          ↓
                                    按 preferred_region 选择区域
                                          ↓
                                    按 strategy 选择 Key
                                          ↓
                                    检查 Key 是否在冷却期
                                          ↓
                              是 → 跳过，选择下一个 Key
                              否 → 使用该 Key 发起请求
                                          ↓
                              成功 → 返回结果
                              失败 → 标记 Key 失败，进入 300s 冷却，返回错误
```

### 2. 失败冷却机制

- 当某个 Key 调用失败（401/429/500 等），自动标记为失败
- 进入 **300 秒**冷却期，冷却期内不使用该 Key
- 冷却期结束后，Key 自动恢复可用
- 如果某个区域所有 Key 都在冷却期，自动重置冷却状态（避免全部不可用）

### 3. 与单 Key 配置的优先级

```
doubao_pool.enabled = true  →  优先使用 Pool
          ↓  Pool 无可用 Key
doubao_api_key（单 Key 配置）
          ↓  也未配置
api_key（主 API Key）
```

---

## 支持的模型

所有以下模型自动走 Pool 路由：

### 文本模型

| 模型 ID | 显示名称 | 上下文 |
|---------|---------|--------|
| `doubao-pro-32k` | 豆包 Pro 32K | 32K |
| `doubao-lite-32k` | 豆包 Lite 32K | 32K |

### 图片模型

| 模型 ID | 显示名称 |
|---------|---------|
| `doubao-seedream-3-0` | 豆包 Seedream 3.0 |

### 视频模型

| 模型 ID | 显示名称 |
|---------|---------|
| `doubao-seaweed-t2v` | 豆包 Seaweed T2V |

**模型识别规则**：模型 ID 以 `doubao` 开头，或包含 `seedream`、`seaweed` 的，均识别为豆包模型。

---

## 获取 API Key

### 1. 注册火山引擎账号

访问 [火山引擎方舟平台](https://www.volcengine.com/product/ark)，注册并完成实名认证。

### 2. 创建 API Key

1. 进入「方舟控制台」
2. 左侧菜单选择「API Key 管理」
3. 点击「创建 API Key」
4. 复制保存 API Key（格式：`sk-xxxxxxxxxxxxxxxx`）

### 3. 开通模型

**重要**：文本、图片、视频模型需要**分别开通**：

1. 进入「模型广场」
2. 搜索并开通以下模型：
   - 文本：豆包 Pro 32K / 豆包 Lite 32K
   - 图片：豆包 Seedream 3.0
   - 视频：豆包 Seaweed T2V
3. 每个模型点击「开通」按钮

只开通文本模型，使用图片/视频模型时会报"模型未授权"错误。

### 4. 充值

豆包 API 按 token 计费，需要在账户中充值：
- 进入「财务中心」→「充值」
- 建议首次充值 10-50 元测试

---

## 常见问题

### Q1: 报错"模型未授权"

**原因**：没有在火山引擎方舟平台开通对应模型。

**解决**：
1. 登录方舟控制台
2. 进入「模型广场」
3. 搜索报错的模型名称（如 Seedream 3.0）
4. 点击「开通」按钮
5. 等待几分钟后重试

### Q2: 报错"Invalid API Key"

**原因**：API Key 错误或已删除。

**解决**：
1. 检查 `config.json` 中的 Key 是否正确
2. 登录方舟控制台，确认 Key 状态为"启用"
3. 重新创建一个新的 API Key

### Q3: Pool 不生效，还是用的单 Key

**原因**：`doubao_pool.enabled` 未设置为 `true`，或配置后未重启应用。

**解决**：
1. 确认 `config.json` 中 `"enabled": true`
2. 重启应用（`python app.py`）
3. 查看控制台日志，应该有 `[豆包Pool] 使用 domestic 区域 Key: sk-xxxxxxxx...` 输出

### Q4: 海外区域怎么配置？

**说明**：Agnes AI Studio 本身不提供海外代理服务，需要你自己有可用的海外端点。

**配置**：
1. 将 `overseas.base_url` 设置为你的海外代理地址
2. 在 `overseas.keys` 中填入对应的 API Key
3. 设置 `preferred_region: "overseas"` 或 `"auto"`

### Q5: 如何查看 Pool 的使用情况？

**方法**：
1. 查看应用控制台日志，每次调用豆包模型都会输出：
   ```
   [豆包Pool] 使用 domestic 区域 Key: sk-abc123... (base_url=https://ark.cn-beijing.volces.com/api/v3)
   ```
2. Key 失败时会输出：
   ```
   [豆包Pool] Key 已标记失败，进入 300s 冷却: sk-abc123...
   ```

### Q6: 冷却时间可以修改吗？

当前冷却时间固定为 300 秒。如需修改，编辑 `src/config.py` 中的 `DOUBAO_POOL_FAIL_COOLDOWN` 常量。

### Q7: Pool 和自定义模型冲突吗？

不冲突。`custom_models` 中的自定义模型有自己的 `base_url` 和 `api_key`，不会走 Pool 路由。只有模型 ID 被识别为豆包模型（doubao*/seedream*/seaweed*）时才会走 Pool。
