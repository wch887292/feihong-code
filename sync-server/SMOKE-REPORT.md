# sync-server Smoke 测试报告

> 晋江市飞虹智科技企业管理有限公司 / 飞虹智研发中心 / 负责人 吴赐虹
>
> 测试时间：2026-11-21 · 测试方式：smoke-runner.js（自包含，内部启动 server.js 随机端口）

## 测试环境

- Node.js v26.2.0
- Express ^4.21.2
- 鉴权 token：smoke-token
- 随机端口 8834

## 测试结果：17 通过 / 0 失败

| # | 用例 | 结果 |
| - | ---- | ---- |
| 1 | 无 token 访问 GET /api/sessions 返回 401 | PASS |
| 2 | 无 token 访问 POST /api/sessions 返回 401 | PASS |
| 3 | POST /api/sessions 保存快照返回 200 | PASS |
| 4 | GET /api/sessions 列表含新会话 | PASS |
| 5 | 列表摘要字段正确（status/messageCount） | PASS |
| 6 | GET /api/sessions/:runId 返回完整会话 | PASS |
| 7 | GET 不存在的会话返回 404 | PASS |
| 8 | POST goals 下发返回 200 且 status=queued | PASS |
| 9 | 连续下发第二个 goal 成功 | PASS |
| 10 | POST claim 拉取 queued goal 成功且 status=running | PASS |
| 11 | 第二次 claim 拉取第二个 queued goal | PASS |
| 12 | 队列空时 claim 返回 404 | PASS |
| 13 | POST status 更新为 paused 成功 | PASS |
| 14 | POST status 更新为 done 成功 | PASS |
| 15 | 非法 status 返回 400 | PASS |
| 16 | 完整会话含 2 个 goal 且均已 running | PASS |
| 17 | 错误 token 返回 401 | PASS |

## 验证项清单

- [x] 保存会话快照（runId/goal/status/messages）
- [x] 会话列表摘要
- [x] 完整会话详情
- [x] 远程下发 goal（queued）
- [x] 本地 claim 拉取（置 running）
- [x] 状态更新（paused/done/非法值拦截）
- [x] 无 token 与错误 token 401 拦截
- [x] 不存在资源 404
- [x] 非法字段 400

## 语法检查

- server.js / store.js / smoke.js / smoke-runner.js 全部 `node --check` 通过

## 遗留问题

- 无。阶段一范围内全部接口验证通过。
