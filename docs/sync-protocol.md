# 飞虹 Code 跨端同步协议（Sync Protocol）

> 晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人 吴赐虹
>
> 版本：0.1.0（阶段一）· 适用：sync-server 云端中继服务

本文档描述飞虹 Code 跨端同步能力的云端中继服务（sync-server）的接口协议，供本地 CLI、移动端、云端执行体接入使用。

## 一、总览

- 服务形态：单进程 Express 服务，无数据库，内存索引 + JSON 文件持久化
- 鉴权方式：Bearer token（环境变量 `FHCODE_SYNC_TOKEN`）
- 默认端口：8787（可用 `FHCODE_SYNC_PORT` / `FHCODE_SYNC_HOST` 覆盖）
- 数据目录：`sync-server/data/sessions.json`（可用 `FHCODE_SYNC_DATA` 覆盖）

## 二、鉴权

所有 `/api/*` 接口必须携带请求头：

```
Authorization: Bearer <FHCODE_SYNC_TOKEN 的值>
```

缺失或错误一律返回 `401 { ok:false, error:"未授权..." }`。`/health` 健康检查接口无需鉴权。

## 三、状态机

会话任务状态（`status` 字段）取值：

| 状态 | 含义 |
| ---- | ---- |
| queued | 远程已下发 goal，等待本地 CLI 拉取 |
| running | 本地 CLI 已 claim，正在执行 |
| paused | 暂停 |
| done | 完成 |
| failed | 失败 |

流转约定：`queued → running → paused/done/failed`。任意状态可互相跳转，业务层自行保证合法性；本服务只做状态存储与校验，不做流转约束。

## 四、接口清单

### 1. 保存会话快照

`POST /api/sessions`

请求体：

```json
{
  "runId": "run_20261121_001",
  "goal": "本次任务目标描述",
  "status": "running",
  "messages": [
    { "role": "user", "content": "你好" },
    { "role": "assistant", "content": "收到" }
  ]
}
```

- `runId` 必填，字符串，会话唯一标识
- `messages` 可选，数组；传入时整体替换该会话的消息列表
- `status` 可选，取值同状态机

响应：

```json
{ "ok": true, "runId": "run_20261121_001", "updatedAt": "2026-11-21T10:00:00.000Z" }
```

### 2. 会话列表摘要

`GET /api/sessions`

响应：

```json
{
  "ok": true,
  "sessions": [
    {
      "runId": "run_20261121_001",
      "goal": "本次任务目标描述",
      "status": "running",
      "updatedAt": "2026-11-21T10:00:00.000Z",
      "messageCount": 2,
      "goalCount": 1
    }
  ]
}
```

按 `updatedAt` 倒序排列。

### 3. 完整会话

`GET /api/sessions/:runId`

响应：

```json
{
  "ok": true,
  "session": {
    "runId": "run_20261121_001",
    "goal": "本次任务目标描述",
    "status": "running",
    "messages": [ { "role": "user", "content": "你好" } ],
    "goals": [
      { "id": "g_xxx", "goal": "远程下发任务", "status": "queued", "createdAt": "2026-11-21T10:00:00.000Z" }
    ],
    "createdAt": "2026-11-21T10:00:00.000Z",
    "updatedAt": "2026-11-21T10:00:00.000Z"
  }
}
```

会话不存在返回 `404`。

### 4. 远程下发新 goal

`POST /api/sessions/:runId/goals`

请求体：

```json
{ "goal": "从手机端下发的新任务指令" }
```

goal 写入该会话的 `goals` 队列，状态为 `queued`。响应：

```json
{
  "ok": true,
  "goal": {
    "id": "g_lxy123_abc",
    "goal": "从手机端下发的新任务指令",
    "status": "queued",
    "createdAt": "2026-11-21T10:05:00.000Z"
  }
}
```

### 5. 本地 CLI 拉取 queued goal

`POST /api/sessions/:runId/claim`

- 拉取该会话队列中最早入队的一条 `queued` goal，置为 `running` 并返回
- 无 queued goal 时返回 `404`

响应：

```json
{
  "ok": true,
  "goal": {
    "id": "g_lxy123_abc",
    "goal": "从手机端下发的新任务指令",
    "status": "running",
    "createdAt": "2026-11-21T10:05:00.000Z",
    "claimedAt": "2026-11-21T10:05:30.000Z"
  }
}
```

### 6. 更新任务状态

`POST /api/sessions/:runId/status`

请求体：

```json
{ "status": "done" }
```

响应：

```json
{ "ok": true, "runId": "run_20261121_001", "status": "done" }
```

非法状态值返回 `400`。

## 五、请求响应示例（完整链路）

```bash
# 1. 保存会话
curl -X POST http://localhost:8787/api/sessions \
  -H "Authorization: Bearer $FHCODE_SYNC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"runId":"run_001","goal":"写一个冒泡排序","status":"running","messages":[]}'

# 2. 远程下发 goal
curl -X POST http://localhost:8787/api/sessions/run_001/goals \
  -H "Authorization: Bearer $FHCODE_SYNC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"goal":"再加一个快速排序"}'

# 3. 本地 CLI 拉取
curl -X POST http://localhost:8787/api/sessions/run_001/claim \
  -H "Authorization: Bearer $FHCODE_SYNC_TOKEN"

# 4. 回传状态
curl -X POST http://localhost:8787/api/sessions/run_001/status \
  -H "Authorization: Bearer $FHCODE_SYNC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'

# 5. 查看完整会话
curl http://localhost:8787/api/sessions/run_001 \
  -H "Authorization: Bearer $FHCODE_SYNC_TOKEN"
```

## 六、错误码约定

| HTTP | 场景 |
| ---- | ---- |
| 400 | 请求体字段缺失或非法（runId 非字符串、messages 非数组、status 非法等） |
| 401 | 缺少或错误的 Bearer token |
| 404 | 会话不存在，或无 queued goal 可 claim |
| 500 | 服务内部错误 |

错误响应统一格式：

```json
{ "ok": false, "error": "错误描述" }
```

## 七、环境变量

| 变量 | 必填 | 默认 | 说明 |
| ---- | ---- | ---- | ---- |
| FHCODE_SYNC_TOKEN | 是 | 无 | Bearer 鉴权 token，未设置则拒绝启动 |
| FHCODE_SYNC_PORT | 否 | 8787 | 监听端口 |
| FHCODE_SYNC_HOST | 否 | 0.0.0.0 | 监听地址 |
| FHCODE_SYNC_DATA | 否 | sync-server/data | 数据目录 |

## 八、阶段一范围说明

本阶段仅实现云端中继：会话快照存储、goal 队列下发/拉取、状态回传。本地 CLI 尚未接入（阶段二实现），数据文件损坏时自动备份重建，保证服务可用。
