# 飞虹 Code Electron 桌面版

## 快速开始

### 开发模式运行

```bash
# 1. 先构建项目
npm run build

# 2. 启动 Electron 桌面版
npm run electron
```

### 打包成 Windows 安装包

```bash
# 打包成 NSIS 安装包 + 便携版
npm run electron:build

# 只打包不发布
npm run electron:dist

# 只生成目录（不打包成安装包，用于测试）
npm run electron:pack
```

打包产物在 `release/` 目录下。

## 功能特性

- ✅ 独立桌面窗口，不依赖浏览器
- ✅ 内置 Web 服务器，启动即用
- ✅ 系统托盘，最小化到后台运行
- ✅ 防止多开，第二个实例自动激活已有窗口
- ✅ 外部链接用系统浏览器打开
- ✅ 预加载脚本，安全暴露 Electron API
- ✅ 支持 NSIS 安装包和便携版

## 目录结构

```
electron/
├── main.js      # Electron 主进程
├── preload.js   # 预加载脚本（渲染进程与主进程通信桥梁）
└── icon.png     # 应用图标（可选）
```

## 前端适配

前端页面可以通过以下方式检测是否在 Electron 环境：

```javascript
if (window.isElectron) {
  // 在 Electron 环境中
  console.log('Electron 版本:', window.electronAPI.versions.electron);

  // 调用 Electron API
  window.electronAPI.window.minimize();
  window.electronAPI.shell.openExternal('https://example.com');
  window.electronAPI.notification.show('标题', '内容');
}
```

## 配置说明

### 修改端口

默认端口 8080，可以通过环境变量修改：

```bash
set FH_WEB_PORT=9090
npm run electron
```

### 修改窗口大小

编辑 `electron/main.js` 中的 `createWindow` 函数：

```javascript
mainWindow = new BrowserWindow({
  width: 1400,   // 窗口宽度
  height: 900,    // 窗口高度
  minWidth: 1024, // 最小宽度
  minHeight: 680, // 最小高度
  // ...
});
```

## 常见问题

### Q: 启动后白屏？
A: 检查是否已运行 `npm run build`，确保 `dist/` 目录存在。

### Q: 端口被占用？
A: 修改 `FH_WEB_PORT` 环境变量，或关闭占用 8080 端口的程序。

### Q: 如何打开开发者工具？
A: 编辑 `electron/main.js`，在 `ready-to-show` 事件中取消注释 `mainWindow.webContents.openDevTools()`。

### Q: 打包失败？
A: 确保网络通畅，electron-builder 需要下载 Electron 二进制文件。国内用户建议配置镜像：
```bash
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

## 工作台形态路线规划（对标 Skyalytic Wing）

**现状**：桌面壳已就绪——内置 Web 服务器 + 主窗口加载 Web 控制台，支持离线私有化运行、系统托盘、防多开、外部链接走系统浏览器。当前加载的是「管理与任务控制台」，尚缺面向最终用户的「AI 工作台」前端形态。

对标 Skyalytic Wing 的「浏览器 + Office + 画布 + 智能体」工作台，fhcode 的差异化路线应叠加「安全私有化 + 企业审计 + SWE 深度」，而非简单复刻 GUI：

- **阶段 A（短期｜复用 T6 成果）**：在现有 Web 控制台增加「技能面板」，按分类展示内置/市场技能（编码 / 办公 / 调研 / 安全…）并标 ★ 官方精选，用户一键触发。
- **阶段 B（中期）**：内置浏览器视图——复用 desktop-touch 的 see/act/verify 或 webview 加载网页供 AI 观察与操作，对标 Skyalytic「浏览器」模块。
- **阶段 C（中期）**：画布 / 知识空间——可视化梳理思路、素材与 AI 产出，对标 Skyalytic「画布」模块。
- **阶段 D（长期）**：智能体团队可视化编排面板——复用 `fhcode team` / `agent-team` 的并行与消息总线能力，图形化编排多智能体分工。

> 该路线为长期架构项；GUI 前端实现需独立前端工程与可视化验证，不在本轮静态优化范围内。本阶段完成现状侦察与路线固化。

---

## 完整 GUI 对标立项规划（独立大项）

> 立项背景：参见 `fhcode-vs-skyalytic-对标测评.md`。Skyalytic Wing 2.0.0 以「浏览器 + Office + 画布 + 智能体」桌面工作台形态，内置 59 个开箱技能、积分订阅，体验零门槛。fhcode 当前 Web 控制台偏「管理与任务」形态，在 **办公通用集成(2/5)、智能体编排可视化(2/5)、工作流可视化(1/5)、生态运营(3/5)** 四项短板明显。本立项目标：在不牺牲「安全私有化 + 企业审计 + SWE 深度」护城河的前提下，补齐最终用户向的工作台体验。

### 一、对标目标与差距（What & Gap）

| 维度 | Skyalytic Wing | fhcode 现状 | 目标落差 |
|------|---------------|------------|---------|
| 办公通用集成 | 59 技能含 docx/pptx/xlsx/摘要/联网 | 内置 11 技能（T4 已补 docx/pptx/xlsx/summarize/web-research） | ✅ 已基本补齐 |
| 技能面板 GUI | 分类市场 + 一键装 | 阶段 A 已交付（分类分组 + ★ 精选 + 内置筛选） | ✅ 已完成 |
| 浏览器模块 | 内置网页观察/操作 | 有 desktop-touch see/act/verify，无 GUI 视图 | ⚠️ 阶段 B |
| 画布模块 | 可视化素材/思路空间 | 无 | ⚠️ 阶段 C |
| 智能体编排 GUI | 图形化多智能体 | `fhcode team` 有 CLI，无可视化 | ⚠️ 阶段 D |
| 生态运营 | 官方市场 + 榜单 | skill-market 有分类/精选(T6)，缺榜单页 | ⚠️ 运营增强 |

### 二、架构方案（How）

- **底座复用**：已有 `electron/main.js` 桌面壳 + `src/web/server.ts`（Express）+ `src/web/public/`（原生 HTML/JS 静态前端）。新增视图为 `index.html` 的 `data-view="xxx"` + `public/js/` 下独立渲染模块，**不引入前端框架**，保持零构建依赖、静态直托管，降低桌面包体积与维护成本。
- **后端**：新视图所需数据走既有 `/api/*` 域；浏览器/画布/编排按需新增路由（沿用 `registerExtraApis` / 域路由拆分模式，遵守「web 模块不反向 import cli/*」边界）。
- **技能数据闭环**：阶段 A 已打通 `skills/*/SKILL.md` → `/api/skills/market?source=builtin` → 分类面板，后续视图统一复用此数据源。

### 三、里程碑（When）

- **M1 阶段 A（已完成）**：技能面板分类 + ★ 精选 + 内置筛选。
- **M2 阶段 B｜浏览器视图**：`data-view="browser"`，webview 加载 URL，暴露「让 AI 观察当前页 / 执行点击」按钮（复用 desktop-touch API）。验收：能加载网页并触发一次 see+act。
- **M3 阶段 C｜画布视图**：`data-view="canvas"`，Canvas/SVG 自由画板 + 卡片节点（思路/素材/AI 产出），本地持久化。验收：可增删节点并保存/重载。
- **M4 阶段 D｜智能体编排面板**：`data-view="orchestrator"`，图形化拖拽节点编排 `fhcode team` 多智能体，生成 YAML/JSON 配置并一键发起。验收：可视化编排 → 实际跑通一个 2 智能体并行任务。
- **M5 运营增强**：技能市场增加「热门榜 / 下载榜 / 官方精选置顶」，数据源自 T6 的 FEATURED + downloads。验收：榜单页可筛选并跳转安装。

### 四、验证方式（Verify）

- **每阶段**：`node node_modules/typescript/bin/tsc --noEmit` 全绿；前端 JS `node --check` 语法校验。
- **GUI 验收**：本地 `npm run build && npm run electron`，或在桌面环境 `curl` 起服务打页，逐项对照里程碑验收清单（每项 PASS 再进下一阶段）。
- **回归**：技能面板/市场既有用例不回退（`loadMarket` `renderMarketGrid` 行为保持）。

### 五、风险与依赖（Risk）

- 桌面 GUI 需可视化环境实跑验证，CI 无法覆盖 → 每阶段交付前需人工打页。
- webview 安全：浏览器视图需开 `webPreferences` 权限，须维持 `contextIsolation` + 沙箱，避免 XSS 越权。
- 包体积：原生前端零框架已控体积；若阶段 C/D 引入重型库，需评估 electron 包体影响。

### 六、成功标准（Done）

1. 最终用户体验对齐 Skyalytic 三大件（浏览器 / 画布 / 智能体）的可见形态；
2. 全程保持 Apache-2.0 可审计 + 离线私有化 + RBAC 审计链差异化；
3. 内置技能广度 ≥ 50（含 T4 办公/调研类），技能面板分类可达、一键触发。
