---
name: browser-automation
description: Controls a real browser via MCP Playwright to automate web tasks including navigation, form filling, clicking, and data extraction when direct API access is unavailable.
---

# 浏览器自动化（Browser Automation）

## 核心定位

通过 MCP Playwright 工具控制浏览器，将用户目标分解为原子操作序列，执行并收集结果。优先使用真实浏览器模式以保持已有登录状态。

适用于：没有 API 的网站、需要已登录状态的操作、动态渲染内容抓取、批量表单填写。不适用于有公开 API 的服务（用 api-gateway skill 更高效）。

---

## 触发场景

- 用户说"帮我自动化 XX 网站的操作"
- 需要从没有 API 的网站获取数据
- 需要批量填写表单或执行重复点击操作
- content-scraper skill 调用此 skill 作为底层引擎

---

## 工作流

### Step 1：目标分解为原子操作

将用户目标分解为原子操作列表，每个操作只做一件事：

```
原子操作类型：
navigate(url)          跳转到 URL
snapshot()             截取页面可访问性快照（每次操作前必须调用）
click(ref)             点击元素
type(ref, text)        在元素中输入文本
select(ref, value)     选择下拉选项
wait_for(text)         等待文本出现
wait_for(time=N)       等待 N 秒
scroll()               滚动页面（触发懒加载）
extract(ref)           提取元素文本或属性
handle_dialog()        处理弹窗/确认框
```

示例分解（登录后获取订单列表）：
```
1. navigate("https://shop.example.com/login")
2. snapshot()                         ← 确认页面结构，找到输入框 ref
3. type(email_ref, email)
4. type(password_ref, password)
5. click(submit_ref)
6. wait_for("我的订单")               ← 等待登录成功标志出现
7. navigate("https://shop.example.com/orders")
8. snapshot()                         ← 确认订单页结构
9. extract(order_list_ref)
10. 检查是否有"下一页" → 如有则 click 后重复 8-9
```

### Step 2：元素选择策略

**按优先级选择（高到低）：**

优先级 1：从 snapshot 的 ref 直接使用（最准确）
```
每次操作前调用 browser_snapshot()，从返回的快照树中
找到目标元素的 ref（格式如 e123），直接传入 ref 参数。
```

优先级 2：按角色（role）和文本
```
通过快照找到 role=button name="登录" 的元素
```

优先级 3：ARIA 属性
```
input[placeholder="请输入邮箱"]
input[aria-label="搜索框"]
button[name="提交"]
```

优先级 4：CSS 语义类名（最后手段）
```
form.login-form input[type="email"]
避免：div.css-1a2b3c4d（hash 类名，随版本变化）
```

核心原则：每次操作前先调用 snapshot()，从快照中找精确 ref，再执行操作。不要猜测或复用上一次的 ref。

### Step 3：处理动态内容

**等待策略**
```
场景：点击后页面跳转
→ browser_wait_for(text="目标页面特征文字")
→ 不要用固定 sleep，用内容等待

场景：内容懒加载（滚动触发）
→ browser_evaluate("window.scrollTo(0, document.body.scrollHeight)")
→ browser_wait_for(time=2)
→ browser_snapshot() 检查是否有新内容出现

场景：弹窗/确认框
→ 先 snapshot() 检查是否有 dialog role
→ browser_handle_dialog(accept=True/False)

场景：iframe 内容
→ browser_evaluate("document.querySelector('iframe').src")
→ browser_navigate(iframe_url) 直接访问 iframe 页面
```

**登录墙检测和处理**
```
检测：snapshot() 中出现以下文字之一：
"登录" "注册" "Sign in" "Log in" "继续阅读" "查看完整内容"

处理顺序：
1. 检查真实浏览器模式下是否已有 session（快照中无登录按钮）
2. 如无 session，暂停并提示用户：
   "{平台名} 需要登录。请在浏览器中完成登录，完成后告诉我继续。"
3. 用户确认后，重新 navigate 并继续
4. 不要在代码或对话中传递明文密码
```

### Step 4：错误恢复

**元素未找到**
```
处理流程：
1. browser_snapshot() 重新获取页面状态
2. 检查页面 URL 是否已跳转（目标已变）
3. 检查元素是否在视口外 → scroll 后重试
4. 等待 2 秒后重新 snapshot 并重试（最多 3 次）
5. 三次失败：截图 + 描述当前页面状态，请用户确认
```

**页面加载未完成**
```
处理流程：
1. browser_evaluate("document.readyState") 检查加载状态
2. 如状态为 loading → browser_wait_for(time=5)
3. 如状态为 complete 但内容未出现 → 可能是 SPA，
   browser_wait_for(text="期望出现的特征文字")
4. 超时阈值：15 秒，超过则报告并请用户确认
```

**验证码拦截**
```
检测：snapshot 中出现 "captcha" "验证" "滑动" "机器人" "人机验证"
处理：
1. 立即暂停自动化
2. 告知用户：遇到验证码，请手动完成验证
3. 等待用户确认后继续
4. 不尝试绕过验证码（技术或法律风险）
```

### Step 5：常用操作模板

**登录流程**
```
navigate(login_url)
snapshot() → 找用户名和密码输入框 ref
type(username_ref, username)
type(password_ref, password)  ← 密码从环境变量获取，不硬编码
click(submit_ref)
wait_for(success_indicator)    ← 等登录成功特征词出现
snapshot() 验证：快照中应有用户名/头像，无"登录"按钮
```

**表单填写**
```
navigate(form_url)
snapshot() → 识别所有表单字段 ref
逐字段执行 type / select / click(checkbox_ref)
如有文件上传：browser_file_upload(paths=["/绝对路径/文件"])
click(submit_ref)
wait_for(confirmation_text)
extract(confirmation_number_ref) → 保存结果
```

**翻页抓取**
```
collected = []
while True:
    snapshot()
    data = extract(content_area_ref)
    collected.append(data)

    next_btn = 快照中找"下一页"按钮
    if not next_btn or next_btn.disabled:
        break
    click(next_btn_ref)
    wait_for(page_changed_indicator)

return collected
```

---

## 输出格式

```
## 浏览器自动化结果

目标：{用户的原始目标}
执行步骤：{n} 步
状态：成功 / 部分成功（{原因}）/ 失败（{原因}）

### 收集的数据
{结构化数据，JSON 格式，超过 50 条时截断并标注总数}

### 执行摘要
- 步骤 1-3：{说明}
- 步骤 4-8：{说明}

### 遇到的问题（如有）
{描述遇到的错误和实际处理方式}
```

---

## Gotchas

**每次操作前必须重新 snapshot**
- SPA 路由跳转后所有 ref 失效，不能复用上次的 ref
- 点击后页面内容局部更新，也可能使部分 ref 失效
- 不要缓存 ref，每步都重新从最新 snapshot 中取

**真实浏览器模式是必要条件**
- 无头模式下，很多网站的 Bot detection 会拒绝访问或返回空内容
- MCP Playwright 默认连接已有浏览器实例，保持已有的登录 session
- 如果 session 意外丢失，检查是否创建了新的浏览器上下文

**中文输入不触发 onChange**
- 直接 type() 中文有时不触发 React/Vue 的 onChange 事件
- 解决：type 后用 evaluate 触发 input 事件：
  `el.dispatchEvent(new Event('input', {bubbles: true}))`

**自定义下拉菜单**
- 现代网站大量使用 div 模拟下拉（不是原生 select 元素）
- 不能用 browser_select_option，需先 click 打开菜单，再 click 目标选项
- 识别方法：snapshot() 中检查元素 role 是否为 listbox / option

**无限滚动的终止条件**
- 判断方式：scroll 后记录内容数量，如连续两次数量不变则认为加载完毕
- 不要假设无限滚动会自动结束，必须设置最大滚动次数上限（如 20 次）
