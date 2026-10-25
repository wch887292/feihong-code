# 阶段四 部署联调报告（助手亲自操作）

日期：2026-10-25

## 部署清单
| 项 | 值 |
|---|---|
| 服务器 | 111.229.190.132（OpenCloudOS 9.6，Node v24.14.0） |
| 服务目录 | /www/wwwroot/fhcode-sync/（server.js / store.js / package.json / sync.env[600]） |
| 静态资源 | /www/wwwroot/app-mobile/（sync.html + css/js） |
| 进程管理 | systemd `fhcode-sync.service`（Restart=always，MemoryMax=150M，绑 127.0.0.1:8787） |
| 反代 | 宝塔 nginx vhost `sync.klai.top.conf`（80→443，443→127.0.0.1:8787） |
| 证书 | 泛域名证书 /www/server/panel/vhost/cert/wildcard.klai.top/（*.klai.top，有效期至 2027-01-21） |

## 验证矩阵（stage4-public-verify.js，8/8 PASS）
| # | 用例 | 结果 |
|---|---|---|
| 1 | HTTPS + 证书 + health | PASS |
| 2 | 无 token 401 拦截（经 nginx 反代） | PASS |
| 3 | 公网建会话快照 | PASS |
| 4 | 公网下发 goal（手机续聊场景） | PASS |
| 5 | 列表确认自动置 queued | PASS |
| 6 | claim 拉取远程任务 | PASS |
| 7 | App 同步页 /m/sync.html 可访问 | PASS |
| 8 | /m/ 默认路由跳转同步页 | PASS |

> 注：DNS 生效前用 Node servername+IP 直连验证；泛域名证书覆盖 sync.klai.top。

## 本机 CLI 配置（已 setx 持久化）
- FHCODE_SYNC_ENABLED=true
- FHCODE_SYNC_URL=https://sync.klai.top
- FHCODE_SYNC_TOKEN=<64 位 hex，明文存于工作区 sync-token.txt>

效果：本机 fhcode 每跑任务，orchestrator 检查点自动推送上下文到云端；手机端随时看进度、续聊下发新 goal。

## APK
- cap sync android 完成（assets 含默认地址 https://sync.klai.top，token 在 App 设置区填入）
- gradle assembleRelease BUILD SUCCESSFUL（1m）
- 产物：H:/feihong-code/android/app/build/outputs/apk/release/app-release.apk（3.2MB）
- 包名 com.feihong.code，versionName 8.12.0，versionCode 75，签名 fhcode-release.jks

## 资源实测
- sync-server RSS 31.7 MB（预估 <80MB 达成）
- 系统 available 442 MB

## 唯一待办（需吴总操作）
DNSPod 控制台添加解析记录：sync.klai.top A 111.229.190.132，生效后手机端 https://sync.klai.top 直接可用。
