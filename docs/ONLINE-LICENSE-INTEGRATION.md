# fhcode 在线授权接入指南（对接 license-manager）

> 适用版本：fhcode v8.8.0+ ｜ 授权服务：cedar-v/license-manager v1.2.0
> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹

## 一、两种授权模式

fhcode 内置**双模授权**，通过环境变量切换，互不干扰：

| 模式 | 触发条件 | 网络行为 | 能力 |
|---|---|---|---|
| **离线模式**（默认，Apache-2.0 开源版） | 不设 `FH_LICENSE_SERVER` | **永不上网** | 本机 Ed25519 签名校验、60天试用、到期拦截 |
| **在线模式**（企业版） | 设 `FH_LICENSE_SERVER` | 激活1次 + 每60分钟心跳 | 上述 + **远程吊销 / 席位管控 / 在线状态 / 用量上报 / 配置热更新** |

**设计原则**：开源用户拿到的 npm 包默认离线，零网络请求，不因授权功能影响可用性。企业客户通过环境变量开启在线管控。

## 二、快速接入（三步）

### 1. 部署授权服务端

已在 `<SERVER_IP>` 部署完成（实际服务器 IP 由部署环境变量注入，不写入公开仓库）：

```
/www/wwwroot/license-manager/
├── docker-compose.yml       # host 网络模式（复用宿主机 MySQL，零额外内存开销）
├── backend-config/
│   ├── config.yaml          # 生产配置（JWT secret 已换成随机 48 字节）
│   ├── rsa_private_key.pem  # 私钥（600 权限，绝不入库）
│   └── rsa_public_key.pem   # 公钥（可下发客户端）
├── logs/  data/  src/
```

启动 / 查看：
```bash
cd /www/wwwroot/license-manager
docker compose up -d
curl http://127.0.0.1:18888/health
```

> ⚠️ **必须做的两个安全修正**（开源仓库默认值不可直接用于生产）：
> 1. `auth.jwt.secret` 换成随机长串 —— 否则任何人都能伪造管理员 token（对应上游 Issue #13，P0 漏洞）
> 2. `backend/configs/rsa_private_key.pem` **仓库里自带一份公开私钥**，必须删掉换成自己生成的

### 2. 后台创建客户与授权码

访问管理后台（默认 `http://<服务器IP>:18080`，账号见部署配置）：
1. **客户管理** → 新建客户（填客户名、联系人、等级）
2. **授权码管理** → 生成授权码（`LIC-{客户ID前4位}-{12位随机}-{4位校验码}`），可设置有效期与设备数
3. 把授权码交付客户 → 客户执行 `fhcode license activate <授权码>`

### 3. 客户端配置

```bash
# 必需：授权服务地址（启用在线模式的开关）
export FH_LICENSE_SERVER=http://<SERVER_IP>:18888

# 必需：服务端 RSA 公钥（用于本地验签，支持 PEM 原文或 base64）
export FH_LICENSE_PUBLIC_KEY="$(cat /path/to/rsa_public_key.pem)"

# 可选：心跳宽限小时数，默认 72（网络故障容忍窗口）
export FH_LICENSE_GRACE_HOURS=72

# 可选：心跳间隔分钟数，默认 60（服务端返回的 heartbeat_interval 优先）
export FH_LICENSE_HEARTBEAT_MIN=60

# 可选：网关层 Bearer 防护
export FH_LICENSE_SERVER_TOKEN=<自定义令牌>

# 应急回退：强制切回离线模式
export FH_LICENSE_ONLINE=0
```

## 三、客户端命令

```bash
fhcode license show         # 查看授权状态（自动区分在线/离线）
fhcode license activate <码> # 激活（在线模式走授权服务）
fhcode license heartbeat    # 手动发一次心跳（排查用）
fhcode license server       # 查看服务配置与连通性
fhcode license fingerprint  # 打印本机指纹（后台绑定设备用）
```

输出示例（在线模式）：
```
在线 · pro · 授权给 XX公司 · 剩余 365 天 · 宽限剩余 71.5h
模式: 在线授权 | 服务地址: http://<SERVER_IP>:18888
许可证密钥: LK-XXXXXXXX
设备指纹: a1b2c3d4e5f6a7b8
服务端状态: active
宽限剩余: 71.5 小时
```

## 四、安全模型

### 4.1 授权判定顺序（任一失败即拦截）

1. **本地验签**：RSA-PSS / SHA-256 验 `license_file` 签名 → 篡改即失效
2. **设备指纹**：与激活时指纹比对 → 换机即失效
3. **远程吊销**：服务端返回 `revoked` / `inactive` → **立即失效，不给宽限**
4. **到期检查**：`expires_at` 已过 → 失效
5. **心跳宽限**：距上次成功心跳超过 `FH_LICENSE_GRACE_HOURS`（默认72h）→ 失效

### 4.2 为什么要有宽限期

网络抖动、机房故障、客户出差断网，都不该让客户停工。所以：
- **网络不通** → 进入宽限期，功能继续可用，倒计时提示
- **服务端明确吊销** → 立即拦截（这是远程吊销唯一生效途径，也是防转卖的关键）

宽限期是安全与可用性的平衡点：72 小时足够覆盖绝大多数临时故障，又不会让"拔网线永久白嫖"成立。

### 4.3 密钥分工

| 密钥 | 位置 | 能否公开 |
|---|---|---|
| RSA 私钥 | 服务端 `backend-config/rsa_private_key.pem`（600） | ❌ 绝对保密 |
| RSA 公钥 | 客户端 `FH_LICENSE_PUBLIC_KEY` | ✅ 可公开（无私钥无法伪造签名） |
| JWT secret | 服务端 `config.yaml` | ❌ 保密（泄露=可伪造管理员） |
| Ed25519 生产私钥 | 发码方环境变量 `FH_LICENSE_SIGN_PRIVATE_KEY` | ❌ 不入库（原有离线模式） |

## 五、反滥用与运维

### 远程吊销（对付转卖/欠费）
后台 **许可证管理 → 撤销**，填原因即刻生效。客户下次心跳（≤60分钟）即被拦截。

### 席位管控
授权码可设最大激活设备数，超限激活返回 `429`。后台能看到每张证的激活 IP、最后在线 IP。

### 在线状态
`heartbeat_timeout: 300`（5分钟）内有心跳即"在线"，24 小时无心跳标记"异常"。

## 六、API 协议（客户端对接参考）

仅 3 个公开接口，无需 Token：

```http
POST /api/v1/activate
{ "authorization_code": "LIC-...", "hardware_fingerprint": "xxx",
  "device_info": {...}, "software_version": "8.8.0" }
→ 200 { "code":"000000", "data": {
    "license_key":"LK-...", "license_file":"<base64>", "heartbeat_interval":3600 } }

POST /api/v1/heartbeat
{ "license_key":"LK-...", "hardware_fingerprint":"xxx", "usage_data":{...} }
→ 200 { "code":"000000", "data": {
    "status":"active", "config_updated":false, "heartbeat_interval":3600 } }
→ 409 授权已吊销/锁定（客户端必须立即拦截）
```

错误码：`404` 授权码不存在 ｜ `409` 已锁定/过期/吊销 ｜ `429` 激活数超限 ｜ `900004` 内部错误（常见于 RSA 私钥未配置）

## 七、代码位置

| 文件 | 职责 |
|---|---|
| `src/license/index.ts` | 离线授权（Ed25519）+ 模式分发 + `licenseStartupCheck()` |
| `src/license/online.ts` | 在线客户端：activate / heartbeat / RSA-PSS 验签 / 宽限期 |
| `src/cli/cmds/license.ts` | CLI 命令（含 `heartbeat`、`server` 子命令） |
| `tests/unit/license-online.test.ts` | 22 项单测（验签防篡改/吊销立即生效/宽限期/换机/到期） |

## 八、上线检查清单

- [ ] `auth.jwt.secret` 已换随机值（**不要用仓库默认值**）
- [ ] `rsa_private_key.pem` 已重新生成且权限 600，**仓库自带的必须删**
- [ ] 管理员默认密码 `admin@123` **已修改**
- [ ] 18888 / 18080 端口未直接暴露公网（走 Nginx 反代 + HTTPS，或限 IP）
- [ ] `FH_LICENSE_PUBLIC_KEY` 已下发到客户端
- [ ] 客户端 `FH_LICENSE_GRACE_HOURS` 按客户容忍度设定（建议 72）
- [ ] 后端 `logs/` 已配 logrotate 或 json-file 轮转
- [ ] 数据库 `license_manager` 已纳入备份

## 九、常见问题

**Q：激活报 `validator: public key not set` / `900004`？**
A：服务端 `config.yaml` 的 `license.rsa.private_key_path` 指向的私钥不存在或路径不对。本部署已用绝对路径 `/app/backend/configs/rsa_private_key.pem` 规避。

**Q：离线客户会不会被这次改动影响？**
A：不会。`licenseBlocked()` 仅在 `onlineEnabled()` 为真时才走在线判定，未设 `FH_LICENSE_SERVER` 的用户行为与改动前完全一致（已有单测 `onlineState: 未启用在线模式时…不拦截` 守护）。

**Q：能同时给一批客户发离线激活码、一批走在线吗？**
A：能。离线走 `fhcode license gen`（Ed25519），在线走后台发授权码，互不干扰。
