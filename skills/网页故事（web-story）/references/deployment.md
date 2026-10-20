# 部署路由（概况版）

默认顺序：**平台内生 → 公网链接 → 自有配置 → 本地 HTML**。先用 `scripts/deploy-plan.mjs --root <项目>` 干跑确认走哪条路。

凭证只读本机已有配置，不要写进项目文件；公网部署后必须读回验证。

## a. 平台内生网页

当前 Agent 平台自带网页托管时，直接用它的发布能力。发布后同样要做读回验证。

## b. 公网链接

环境能生成公网 URL（内置分享、隧道工具等）就用。临时链接有有效期，告知使用者；长期访问建议走 c 或 d。

```bash
# 本地起静态服务的通用写法
python3 -m http.server <port> --directory <项目根>
```

## c. 自有域名 + 云存储

项目根放 `settings.json`（从 skill 的 `settings.example.json` 复制填写），支持两种 profile：

- `tencent-cos`：对象存储静态网站 + CDN。通用三步：上传文件（HTML/JS/CSS 设 no-cache，图片设长缓存）→ 刷新 CDN → curl 读回验证（状态码 200 + 字节数一致）。
- `vercel`：`vercel deploy --prod`。静态页不要保留固定旧 runtime 版本的 vercel.json，用空配置或删除。

具体厂商的命令以其官方文档为准。

## d. 本地 HTML

`open <项目根>/index.html`。后续想分享：把目录拖进任一静态托管平台（Vercel / Netlify / Cloudflare Pages 免费额度足够单页站），或配置 settings.json 走 c。

## 读回验证标准

- [ ] curl 状态码 200（或 308 跳 HTTPS 后 200）
- [ ] 响应字节数与本地文件一致（gzip 时抽查内容标记）
- [ ] 页面内一个独有文本能 grep 到
