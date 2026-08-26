// 生成 10 个官方 Skill 模板（生态 0→1 第一步）
// 目标：templates/skills/<id>/SKILL.md，脚手架 `fhcode skill-new <name> --template <id>` 复制使用
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const outDir = join(root, 'templates', 'skills');

const TEMPLATES = [
  {
    id: 'code-review',
    title: 'Code Review 代码审查',
    desc: '对指定文件/改动进行系统代码审查：定位缺陷、安全问题、可维护性问题，输出分级问题清单。',
    body: `## 触发
当用户说"审查这段代码/帮我 review / 检查这个 PR 的改动"时使用。

## 执行步骤
1. 明确审查对象（文件路径或改动范围），必要时用 git diff 获取改动
2. 按以下维度逐项检查：
   - 正确性：边界条件、空值、竞态、异常路径
   - 安全：注入、敏感信息、权限、依赖风险（OWASP Top 10）
   - 可维护性：命名、重复代码、职责划分、可测试性
   - 性能：复杂度、不必要的重复计算、I/O 阻塞
3. 输出分级问题清单：🔴 严重（必修）/ 🟡 建议（应修）/ 🟢 优化（可选）
4. 每条问题给出：位置（文件:行）、问题说明、修复建议、示例代码

## 输出格式
\`\`\`
审查对象：<文件/范围>
🔴 严重（N）…
🟡 建议（N）…
🟢 优化（N）…
总体结论：…
\`\`\`
`,
  },
  {
    id: 'git-flow',
    title: 'Git Flow 流程助手',
    desc: 'Git 提交规范、分支管理、rebase/合并、冲突解决的操作指引。',
    body: `## 触发
当用户涉及 commit / branch / rebase / merge / 冲突解决 / 回滚时使用。

## 执行步骤
1. 先查看当前状态：git status / git log --oneline -5 / git branch
2. 提交规范：conventional commits（feat/fix/docs/style/refactor/perf/test/chore），正文说明为什么
3. 分支操作：新功能用 feat/<name>，修复用 fix/<name>，完成后合并回主分支
4. rebase 冲突：git rebase --continue 前先解决冲突文件，git add 后继续
5. 回滚：区分 revert（保留历史）与 reset（丢弃历史），谨慎操作

## 输出格式
给出可直接执行的命令序列 + 每步说明 + 风险提示。
`,
  },
  {
    id: 'api-design',
    title: 'REST API 设计评审',
    desc: '对 API 设计进行评审：资源建模、状态码、校验、版本化、安全、文档。',
    body: `## 触发
当用户设计/评审 REST API、接口文档、OpenAPI 规范时使用。

## 执行步骤
1. 评审资源建模：RESTful 资源 + 动作语义（GET 幂等、POST 创建、PUT 全量、PATCH 部分）
2. 状态码：200/201/400/401/403/404/409/422/500 使用是否准确
3. 输入校验：必填/类型/边界/枚举；错误响应格式统一
4. 版本化：/v1/ 前缀或 header；兼容性策略
5. 安全：认证/授权、限流、敏感字段脱敏、防注入
6. 文档：OpenAPI 完整性（schema/示例/错误码）

## 输出格式
逐项评审结论 + 修改建议（含示例 JSON 响应）。
`,
  },
  {
    id: 'refactor',
    title: '代码重构建议',
    desc: '对既有代码提出可落地的重构方案：保持行为不变的前提下提升可读性、可维护性与性能。',
    body: `## 触发
当用户说"这段代码太乱/帮我重构/优化下结构"时使用。

## 执行步骤
1. 先理解行为：读代码，确定输入输出契约（先写/确认测试覆盖）
2. 识别坏味道：长函数、重复代码、过度嵌套、魔法数字、职责混乱
3. 给出重构方案（保持行为不变）：
   - 提取函数/类、消除重复、简化条件、引入常量/枚举
   - 每步说明"为什么安全"（有测试兜底）
4. 提供重构前/后代码对比
5. 强调：重构 ≠ 加功能，逐步小步提交，每步跑测试

## 输出格式
问题 → 方案 → 重构前后对比 → 验证方式。
`,
  },
  {
    id: 'test-gen',
    title: '单元测试生成',
    desc: '为指定函数/模块生成高质量单元测试：覆盖正常/边界/异常路径。',
    body: `## 触发
当用户说"帮这个函数写测试/补测试/覆盖率太低"时使用。

## 执行步骤
1. 读目标函数/模块，理解输入输出与依赖
2. 设计测试用例矩阵：
   - 正常路径（典型输入）
   - 边界（空、极值、0、超大、类型边界）
   - 异常（非法输入、依赖抛错、超时）
   - 纯函数优先测，外部依赖用 mock/stub
3. 按项目测试框架（node:test / jest / vitest）生成
4. 用例命名规范：should_<行为>_when_<条件>
5. 给出运行命令，确认可通过

## 输出格式
测试代码 + 用例矩阵说明 + 运行结果。
`,
  },
  {
    id: 'doc-gen',
    title: '代码文档生成',
    desc: '为代码生成文档：模块说明、函数注释、README、CHANGELOG。',
    body: `## 触发
当用户说"给这段代码写文档/生成 README/补注释"时使用。

## 执行步骤
1. 读代码，理解模块职责、公开 API、数据流
2. 生成内容：
   - 模块级：职责、使用场景、依赖
   - 函数级：参数、返回、异常、示例（JSDoc 风格）
   - 文档风格与项目一致（中文/英文）
3. 注释只解释"为什么"，不逐行翻译代码
4. README：一句话定位 + 快速开始 + 配置 + 示例 + FAQ
5. CHANGELOG：按 Conventional Commits 归类

## 输出格式
按需交付：API 文档 / README / CHANGELOG 片段。
`,
  },
  {
    id: 'security-audit',
    title: '安全审计（OWASP）',
    desc: '对代码进行安全审计：OWASP Top 10、敏感信息、依赖漏洞、注入风险。',
    body: `## 触发
当用户说"安全审计/检查安全问题/有没有漏洞"时使用。

## 执行步骤
1. 静态扫描面：
   - 注入：SQL/命令/路径/XSS（拼接用户输入处重点）
   - 敏感信息：密钥/令牌/个人数据是否落库、日志、响应
   - 认证授权：越权访问、弱校验、会话管理
   - 依赖：npm audit / osv-scanner 结果解读
2. 逐项给出：位置、漏洞类型（映射 OWASP Top 10）、风险等级、修复代码
3. 输出修复优先级：P0（立即修）/ P1（近期）/ P2（规划）

## 输出格式
审计报告：发现清单（位置+类型+等级+修复方案）+ 优先级 + 未发现项声明（限定检查范围）。
`,
  },
  {
    id: 'performance',
    title: '性能优化分析',
    desc: '定位性能瓶颈并给出优化方案：复杂度、I/O、缓存、并发。',
    body: `## 触发
当用户说"太慢了/性能问题/优化下速度/内存泄漏"时使用。

## 执行步骤
1. 先量化：不要凭空优化，指出如何测量（benchmark、profile、日志耗时）
2. 常见瓶颈排查：
   - 算法复杂度（O(n²)→O(n log n)）
   - 重复计算/循环内 I/O
   - 无缓存/缓存失效策略
   - 阻塞（同步 I/O、串行请求可并行化）
   - 内存：大对象、未释放引用、流式处理
3. 给出：瓶颈定位 → 量化方法 → 优化方案 → 预期收益 → 验证方法

## 输出格式
瓶颈分析表 + 优化前后对比 + 收益预估。
`,
  },
  {
    id: 'dependency-upgrade',
    title: '依赖升级检查',
    desc: '检查依赖版本、升级风险与兼容性，生成安全升级方案。',
    body: `## 触发
当用户说"升级依赖/检查过时包/依赖有漏洞"时使用。

## 执行步骤
1. 现状盘点：package.json 依赖清单 + 版本范围
2. 检查：npm outdated / npm audit / osv-scanner 结果
3. 升级分级：
   - patch：直接升（低风险）
   - minor：读 changelog，关注破坏性变更
   - major：大版本，检查 breaking changes + 迁移指南
4. 每项升级：当前 → 目标版本、风险、影响面、验证方式
5. 输出分阶段升级顺序（先安全补丁，后大版本）

## 输出格式
依赖升级清单（含风险与验证）+ 建议顺序。
`,
  },
  {
    id: 'onboarding',
    title: '新项目上手导读',
    desc: '快速理解陌生代码库：架构、目录、入口、构建运行、关键模块。',
    body: `## 触发
当用户说"这个项目怎么跑/看不懂这个仓库/帮我熟悉代码"时使用。

## 执行步骤
1. 快速扫描：README、package.json（scripts/deps）、目录结构、配置文件
2. 产出仓库地图：
   - 技术栈与运行方式（npm scripts / docker / env）
   - 目录职责（src 分层、入口、测试）
   - 核心数据流/请求链路（入口 → 路由 → 业务 → 存储）
3. 标记关键文件与重要模块（含行号）
4. 给出"从哪开始读"的路径建议 + 常见任务操作指南（加接口/加页面）

## 输出格式
仓库导读：技术栈 / 运行 / 目录地图 / 数据流 / 关键文件 / 上手路径。
`,
  },
];

for (const t of TEMPLATES) {
  const dir = join(outDir, t.id);
  mkdirSync(dir, { recursive: true });
  const sk = `---
name: "${t.title}"
description: "${t.desc}"
---

# ${t.title}

<!-- 模板占位：使用 \`fhcode skill-new <name> --template ${t.id}\` 复制并定制 -->

${t.body.trim()}
`;
  writeFileSync(join(dir, 'SKILL.md'), sk, 'utf8');
  console.log(`✓ templates/skills/${t.id}/SKILL.md`);
}
console.log(`\n生成 ${TEMPLATES.length} 个官方模板完成`);
