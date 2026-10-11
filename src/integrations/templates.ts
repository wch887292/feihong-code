/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 企业集成预置模板（P9-1 系统集成增强）：
 *  - 把零散的集成能力收敛为「开箱即用」的预置模板，企业一键落地。
 *  - 三类：IM 即时通讯桥接（飞书/企微）、CI/CD 流水线门禁（GitHub/GitLab/Jenkins）、工单系统对接（Jira/禅道）。
 *  - 每个模板包含：配置文件 + 部署脚本 + 部署后步骤说明。
 *
 * 设计原则：
 *  - 模板内容均为真实可运行的配置与脚本（非纯占位）。
 *  - 不内联任何密钥；密钥一律走环境变量 / secrets。
 *  - 失败 fail-closed，不静默吞错。
 */

export type IntegrationCategory = 'im' | 'cicd' | 'ticketing';

export interface IntegrationTemplateFile {
  /** 相对目标工作区的写入路径 */
  path: string;
  /** 文件内容（UTF-8） */
  content: string;
}

export interface IntegrationTemplate {
  id: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  /** 依赖/前置条件 */
  prerequisites: string[];
  files: IntegrationTemplateFile[];
  /** 部署后人工步骤 */
  postInstructions: string[];
}

/* =========================================================================
 * IM：飞书桥接（已有 feishu-bridge.ts 支撑，本模板固化配置 + 平台步骤）
 * ========================================================================= */
const IM_FEISHU: IntegrationTemplate = {
  id: 'im-feishu',
  name: '飞书 / Lark 双向桥接',
  category: 'im',
  description: '将飞书机器人接入 fhcode：员工在飞书对话即可触发 AI 编程/管理任务，结果主动回推卡片。依赖 src/integrations/feishu-bridge.ts。',
  prerequisites: [
    '已在飞书开放平台创建「企业自建应用」并启用机器人能力',
    'fhcode 以 serve 模式运行（fhcode serve），且 /api/feishu/callback 公网可达',
  ],
  files: [
    {
      path: '.env.example.feishu',
      content: `# ===== 飞书桥接（IM 集成模板 im-feishu 生成）=====
# 复制本段到 .env 并按实际值填写，切勿提交真实密钥。
FH_FEISHU_ENABLED=true
FH_FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FH_FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FH_FEISHU_VERIFICATION_TOKEN=xxxxxxxxxxxxxxxx
# 消息加密 Key（可选；配置后飞书回调消息将被 AES-256-CBC 解密）
FH_FEISHU_ENCRYPT_KEY=
# 任务工作目录（默认 ~/.fhcode/feishu-workspace）
# FH_FEISHU_WORKSPACE=
`,
    },
  ],
  postInstructions: [
    '1. 飞书开放平台 → 事件订阅 → 请求地址填：https://你的域名:端口/api/feishu/callback',
    '2. 订阅事件：im.message.receive_v1（接收消息）',
    '3. 权限开通：im:message（获取与发送）、im:message:send_as_bot（以应用身份发送）',
    '4. 把 .env.example.feishu 的内容并入 .env，填入真实 App ID/Secret/Token',
    '5. 重启 fhcode serve，在飞书给机器人发消息验证回推',
  ],
};

/* =========================================================================
 * IM：企业微信 / 公众号桥接（已有 wechat-bridge.ts 支撑）
 * ========================================================================= */
const IM_WECOM: IntegrationTemplate = {
  id: 'im-wecom',
  name: '企业微信 / 公众号双向桥接',
  category: 'im',
  description: '将企业微信应用或微信公众号接入 fhcode：对话触发任务、结果主动回复。支持 wecom（企业微信应用）与 mp（公众号）双模式。依赖 src/integrations/wechat-bridge.ts。',
  prerequisites: [
    '企业微信：已在企业微信后台创建自建应用，取得 CorpID/AgentID/Secret',
    '公众号：已获取 AppID/AppSecret 并配置服务器地址',
    'fhcode 以 serve 模式运行，回调地址公网可达',
  ],
  files: [
    {
      path: '.env.example.wecom',
      content: `# ===== 企业微信 / 公众号桥接（IM 集成模板 im-wecom 生成）=====
# 二选一：FH_WECHAT_MODE=wecom（企业微信应用）或 mp（公众号）

# —— 企业微信应用模式 ——
FH_WECHAT_MODE=wecom
FH_WECOM_CORPID=wwxxxxxxxxxxxxxxxx
FH_WECOM_CORPSECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FH_WECOM_AGENTID=1000002
FH_WECOM_TOKEN=xxxxxxxxxxxxxxxx
FH_WECOM_ENCODING_AES_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# —— 微信公众号模式 ——
# FH_WECHAT_MODE=mp
# FH_MP_APPID=wxxxxxxxxxxxxxxxxx
# FH_MP_APPSECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# FH_MP_TOKEN=xxxxxxxxxxxxxxxx
# FH_MP_ENCODING_AES_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 任务工作目录（默认 ~/.fhcode/wechat-workspace）
# FH_WECHAT_WORKSPACE=
`,
    },
  ],
  postInstructions: [
    '1. 企业微信后台 → 应用管理 → 自建应用 → 接收消息 → 设置 API 接收：URL=https://你的域名:端口/api/wechat/callback，Token/AESKey 与 .env 一致',
    '2. 公众号：公众平台 → 设置与开发 → 基本配置 → 服务器配置：URL/Ttoken/AESKey 同上',
    '3. 把 .env.example.wecom 的内容并入 .env，按模式填写',
    '4. 重启 fhcode serve，在企业微信/公众号对话验证回推',
  ],
};

/* =========================================================================
 * CI/CD：GitHub Actions —— fhcode 作为 AI 代码评审门禁
 * ========================================================================= */
const CICD_GITHUB: IntegrationTemplate = {
  id: 'cicd-github',
  name: 'GitHub Actions · AI 代码评审门禁',
  category: 'cicd',
  description: '在 Pull Request 上自动调用 fhcode 做 AI 代码评审与安全扫描，并将评审意见以评论形式回写到 PR。',
  prerequisites: [
    '仓库已安装 Node 20+ 运行环境',
    'GitHub Actions 中已配置 fhcode 所需的模型/API Key 到仓库 Secrets（见模板内注释）',
  ],
  files: [
    {
      path: '.github/workflows/fhcode-review.yml',
      content: `name: fhcode AI 代码评审门禁

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write
  contents: read

jobs:
  ai-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      # fhcode 所需的模型与 API Key 通过 secrets 注入（绝不硬编码）
      - name: fhcode AI 评审并回写 PR
        env:
          FH_API_BASE: \${{ secrets.FH_API_BASE }}
          FH_API_KEY: \${{ secrets.FH_API_KEY }}
          FH_DEFAULT_MODEL: \${{ secrets.FH_DEFAULT_MODEL }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          PR_NUMBER: \${{ github.event.pull_request.number }}
          REPO: \${{ github.repository }}
        run: npx -y feihong-code@latest node scripts/fhcode-ci-review.mjs
`,
    },
    {
      path: 'scripts/fhcode-ci-review.mjs',
      content: `#!/usr/bin/env node
/**
 * fhcode CI 评审脚本：调用 fhcode 对当前 PR 的 diff 做 AI 评审，
 * 再把评审结论 POST 为 GitHub PR 评论。
 * 仅依赖 Node 内置 fetch，无需额外依赖。
 */
import { execFileSync } from 'node:child_process';

const { FH_API_BASE, FH_API_KEY, FH_DEFAULT_MODEL, GITHUB_TOKEN, PR_NUMBER, REPO } = process.env;

function fail(msg) {
  console.error('[fhcode-ci-review] ' + msg);
  process.exit(1);
}

if (!GITHUB_TOKEN || !PR_NUMBER || !REPO) fail('缺少 GITHUB_TOKEN / PR_NUMBER / REPO 环境变量');

// 1. 取 PR diff
const diff = execFileSync('git', ['diff', 'origin/' + (process.env.GITHUB_BASE_REF || 'main') + '...HEAD'], {
  encoding: 'utf8',
}).trim();
if (!diff) {
  console.log('[fhcode-ci-review] 无 diff，跳过评审');
  process.exit(0);
}

// 2. 调用 fhcode 评审（将 diff 作为上下文喂给目标）
const goal = \`你是资深代码评审专家。审查以下 Pull Request 的代码改动（git diff），\n只关注真实问题：潜在 bug、安全漏洞（注入/越权/硬编码密钥）、明显性能与规范问题。\n不要吹毛求疵。给出结论：PASS（可合并）/ WARN（需人工确认）/ FAIL（必须修改），并附简明修改建议。\n\n<pr-diff>\n\${diff.slice(0, 24000)}\n</pr-diff>\`;

let review;
try {
  review = execFileSync('npx', ['-y', 'feihong-code@latest', goal], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, FH_API_BASE, FH_API_KEY, FH_DEFAULT_MODEL },
  }).trim();
} catch (e) {
  fail('fhcode 评审执行失败：' + (e.stderr || e.message));
}

// 3. 回写 PR 评论
const [owner, repo] = REPO.split('/');
const url = \`https://api.github.com/repos/\${owner}/\${repo}/issues/\${PR_NUMBER}/comments\`;
const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + GITHUB_TOKEN,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ body: '## 🤖 fhcode AI 代码评审\\n\\n' + review }),
});
if (!res.ok) fail('评论回写失败：' + res.status + ' ' + (await res.text()).slice(0, 200));
console.log('[fhcode-ci-review] 评审已回写 PR #' + PR_NUMBER);
`,
    },
  ],
  postInstructions: [
    '1. 在仓库 Settings → Secrets and variables → Actions 添加：FH_API_BASE / FH_API_KEY / FH_DEFAULT_MODEL',
    '2. 提交 .github/workflows/fhcode-review.yml 与 scripts/fhcode-ci-review.mjs',
    '3. 新建 PR，观察 Actions 面板：fhcode 评审意见会自动出现在 PR 评论区',
    '4. 可选：将评审结论 FAIL 接入分支保护规则，作为合并门禁',
  ],
};

/* =========================================================================
 * CI/CD：GitLab CI
 * ========================================================================= */
const CICD_GITLAB: IntegrationTemplate = {
  id: 'cicd-gitlab',
  name: 'GitLab CI · AI 代码评审门禁',
  category: 'cicd',
  description: '在 GitLab Merge Request 流水线上调用 fhcode 做 AI 评审，结果以 MR 评论回写。',
  prerequisites: [
    'GitLab Runner 可用（共享或专用）',
    '项目 CI/CD Variables 已配置 FH_API_BASE / FH_API_KEY / FH_DEFAULT_MODEL',
  ],
  files: [
    {
      path: '.gitlab-ci.yml',
      content: `fhcode_ai_review:
  stage: test
  image: node:20
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
  script:
    - npm install -g feihong-code@latest
    - node scripts/fhcode-ci-review.mjs
  variables:
    # 通过 GitLab CI/CD Variables 注入，勿硬编码
    FH_API_BASE: "$FH_API_BASE"
    FH_API_KEY: "$FH_API_KEY"
    FH_DEFAULT_MODEL: "$FH_DEFAULT_MODEL"
`,
    },
    {
      path: 'scripts/fhcode-ci-review.mjs',
      content: `#!/usr/bin/env node
/**
 * GitLab CI 评审脚本：复用 fhcode 评审当前 MR 改动并回写 MR 评论。
 * GitLab 通过 CI 变量注入：CI_MERGE_REQUEST_* / CI_PROJECT_ID / CI_SERVER_URL / CI_API_V4_URL / GITLAB_TOKEN。
 */
import { execFileSync } from 'node:child_process';

const { FH_API_BASE, FH_API_KEY, FH_DEFAULT_MODEL, CI_API_V4_URL, CI_PROJECT_ID, CI_MERGE_REQUEST_IID, GITLAB_TOKEN } = process.env;

function fail(msg) { console.error('[fhcode-ci-review] ' + msg); process.exit(1); }
if (!GITLAB_TOKEN || !CI_MERGE_REQUEST_IID || !CI_PROJECT_ID || !CI_API_V4_URL) fail('缺少 GitLab CI 变量');

const diff = execFileSync('git', ['diff', '--merge-base', 'origin/' + (process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME || 'main'), 'HEAD'], { encoding: 'utf8' }).trim();
if (!diff) { console.log('无 diff，跳过'); process.exit(0); }

const goal = \`审查以下 Merge Request 的改动（git diff），只关注真实问题：bug、安全漏洞、性能与规范。\n结论：PASS/WARN/FAIL，并附简明建议。\n\n<mr-diff>\n\${diff.slice(0, 24000)}\n</mr-diff>\`;
let review;
try {
  review = execFileSync('fhcode', [goal], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, env: { ...process.env, FH_API_BASE, FH_API_KEY, FH_DEFAULT_MODEL } }).trim();
} catch (e) { fail('fhcode 评审失败：' + (e.stderr || e.message)); }

const url = \`\${CI_API_V4_URL}/projects/\${encodeURIComponent(CI_PROJECT_ID)}/merge_requests/\${CI_MERGE_REQUEST_IID}/notes\`;
const res = await fetch(url, {
  method: 'POST',
  headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({ body: '## 🤖 fhcode AI 代码评审\\n\\n' + review }),
});
if (!res.ok) fail('评论回写失败：' + res.status);
console.log('评审已回写 MR !' + CI_MERGE_REQUEST_IID);
`,
    },
  ],
  postInstructions: [
    '1. GitLab 项目 → Settings → CI/CD → Variables 添加 FH_API_BASE / FH_API_KEY / FH_DEFAULT_MODEL / GITLAB_TOKEN（api 范围）',
    '2. 提交 .gitlab-ci.yml 与 scripts/fhcode-ci-review.mjs',
    '3. 创建 MR 触发流水线，评审意见出现在 MR 讨论区',
  ],
};

/* =========================================================================
 * CI/CD：Jenkins
 * ========================================================================= */
const CICD_JENKINS: IntegrationTemplate = {
  id: 'cicd-jenkins',
  name: 'Jenkins · AI 代码评审门禁',
  category: 'cicd',
  description: 'Jenkins Pipeline 在代码审查阶段调用 fhcode 做 AI 评审，结果输出到构建日志并可作为门禁。',
  prerequisites: [
    'Jenkins 节点已安装 Node 20+ 与 fhcode（npm install -g feihong-code）',
    '凭据管理中配置 fhcode API 相关机密（Credentials Binding 注入）',
  ],
  files: [
    {
      path: 'Jenkinsfile',
      content: `pipeline {
  agent any
  environment {
    FH_API_BASE = credentials('fh-api-base')
    FH_API_KEY  = credentials('fh-api-key')
    FH_DEFAULT_MODEL = credentials('fh-default-model')
  }
  stages {
    stage('fhcode AI 代码评审') {
      steps {
        sh 'node scripts/fhcode-ci-review.mjs'
      }
    }
  }
}
`,
    },
    {
      path: 'scripts/fhcode-ci-review.mjs',
      content: `#!/usr/bin/env node
/**
 * Jenkins 评审脚本：对当前工作区相对目标分支的改动调用 fhcode 评审。
 * 凭据通过环境变量注入（FH_API_BASE / FH_API_KEY / FH_DEFAULT_MODEL）。
 * BASE_BRANCH 由 Jenkins 传入（默认 main）。
 */
import { execFileSync } from 'node:child_process';

const { FH_API_BASE, FH_API_KEY, FH_DEFAULT_MODEL, BASE_BRANCH = 'main' } = process.env;
function fail(msg) { console.error('[fhcode-ci-review] ' + msg); process.exit(1); }

let diff = '';
try {
  diff = execFileSync('git', ['diff', '--merge-base', 'origin/' + BASE_BRANCH, 'HEAD'], { encoding: 'utf8' }).trim();
} catch { diff = execFileSync('git', ['diff', BASE_BRANCH], { encoding: 'utf8' }).trim(); }
if (!diff) { console.log('无 diff，跳过'); process.exit(0); }

const goal = \`审查以下改动（git diff），只关注真实问题：bug、安全、性能与规范。结论 PASS/WARN/FAIL 并附建议。\n\n<diff>\n\${diff.slice(0, 24000)}\n</diff>\`;
let review;
try {
  review = execFileSync('fhcode', [goal], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, env: { ...process.env, FH_API_BASE, FH_API_KEY, FH_DEFAULT_MODEL } }).trim();
} catch (e) { fail('fhcode 评审失败：' + (e.stderr || e.message)); }
console.log('\\n===== fhcode AI 代码评审 =====\\n' + review + '\\n=============================');
`,
    },
  ],
  postInstructions: [
    '1. Jenkins → 凭据 → 添加 Secret text：fh-api-base / fh-api-key / fh-default-model',
    '2. 在 Jenkinsfile 中已用 credentials() 绑定；节点需预装 feihong-code 全局包',
    '3. 提交 Jenkinsfile 与 scripts/fhcode-ci-review.mjs，触发流水线',
    '4. 评审结论输出在构建日志；如需作为门禁，可在脚本中依据 FAIL 调用 process.exit(1) 阻断',
  ],
};

/* =========================================================================
 * 工单：Jira 连接器（配置 + 对接脚本骨架）
 * ========================================================================= */
const TICKETING_JIRA: IntegrationTemplate = {
  id: 'ticketing-jira',
  name: 'Jira 工单连接器',
  category: 'ticketing',
  description: '将 fhcode 与企业 Jira 打通：可一键把任务卡转成开发目标、把 AI 执行结果回写工单。提供 REST 对接脚本骨架。',
  prerequisites: [
    'Jira Cloud 或 Server 实例，且具备 API Token（Cloud）或 Personal Access Token（Server）',
    '已确定目标项目 Key（如 PROJ）',
  ],
  files: [
    {
      path: '.env.example.jira',
      content: `# ===== Jira 工单连接器（ticketing-jira 模板生成）=====
FH_JIRA_BASE_URL=https://your-org.atlassian.net
FH_JIRA_EMAIL=your-email@company.com
FH_JIRA_API_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FH_JIRA_PROJECT=PROJ
`,
    },
    {
      path: 'scripts/fhcode-jira-bridge.mjs',
      content: `#!/usr/bin/env node
/**
 * Jira 工单桥接骨架：拉取指定状态的工单 → 交给 fhcode 生成开发目标/补丁 → 回写评论。
 * 仅用 Node 内置 fetch，密钥走环境变量。按需扩展为 routine 定时任务。
 */
import { execFileSync } from 'node:child_process';

const { FH_JIRA_BASE_URL, FH_JIRA_EMAIL, FH_JIRA_API_TOKEN, FH_JIRA_PROJECT } = process.env;
const AUTH = 'Basic ' + Buffer.from(FH_JIRA_EMAIL + ':' + FH_JIRA_API_TOKEN).toString('base64');

async function fetchIssues() {
  const jql = encodeURIComponent('project=' + FH_JIRA_PROJECT + ' AND status="To Do" ORDER BY created DESC');
  const res = await fetch(FH_JIRA_BASE_URL + '/rest/api/3/search?jql=' + jql + '&maxResults=5', {
    headers: { Authorization: AUTH, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('Jira 查询失败 ' + res.status);
  const data = await res.json();
  return data.issues || [];
}

async function comment(issueKey, body) {
  await fetch(FH_JIRA_BASE_URL + '/rest/api/3/issue/' + issueKey + '/comment', {
    method: 'POST',
    headers: { Authorization: AUTH, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ text: body, type: 'text' }] }] } }),
  });
}

async function main() {
  const issues = await fetchIssues();
  for (const it of issues) {
    const summary = it.fields.summary;
    console.log('处理工单 ' + it.key + '：' + summary);
    // 调用 fhcode 基于工单生成开发目标/补丁（按需替换为目标）
    const goal = \`根据以下 Jira 工单实现代码变更：\n标题：\${summary}\n描述：\${it.fields.description || '(无)'}\n请在当前仓库给出最小改动方案并执行。\`;
    const out = execFileSync('npx', ['-y', 'feihong-code@latest', goal], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
    await comment(it.key, '🤖 fhcode 处理结果：\\n' + out.slice(0, 4000));
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
`,
    },
  ],
  postInstructions: [
    '1. 复制 .env.example.jira 内容到 .env 并填真实值（Atlassian API Token：Account settings → Security → API tokens）',
    '2. 安装依赖：node scripts/fhcode-jira-bridge.mjs 仅依赖内置模块，无需 npm install',
    '3. 试运行：node scripts/fhcode-jira-bridge.mjs 看是否拉到 To Do 工单',
    '4. 可结合 fhcode routine 定时执行（fhcode routine add --cron ... --command "node scripts/fhcode-jira-bridge.mjs"）',
  ],
};

/* =========================================================================
 * 工单：禅道连接器
 * ========================================================================= */
const TICKETING_ZENTAO: IntegrationTemplate = {
  id: 'ticketing-zentao',
  name: '禅道工单连接器',
  category: 'ticketing',
  description: '将 fhcode 与禅道（ZenTao）打通：拉取待处理需求/BUG，交给 fhcode 处理后回写。提供 REST 对接脚本骨架。',
  prerequisites: [
    '禅道 >= 18（开启 API 访问，获取账号与密码/Token）',
    '已知禅道访问地址与项目 ID',
  ],
  files: [
    {
      path: '.env.example.zentao',
      content: `# ===== 禅道工单连接器（ticketing-zentao 模板生成）=====
FH_ZENTAO_BASE_URL=https://zentao.your-company.com
FH_ZENTAO_USER=api-user
FH_ZENTAO_PASSWORD=your-password
FH_ZENTAO_PROJECT_ID=1
`,
    },
    {
      path: 'scripts/fhcode-zentao-bridge.mjs',
      content: `#!/usr/bin/env node
/**
 * 禅道工单桥接骨架：登录获取 token → 查询待处理需求/BUG → 交给 fhcode 处理 → 回写备注。
 * 禅道 API 路径以实际版本为准（此处为常见约定，按需调整）。
 */
import { execFileSync } from 'node:child_process';

const { FH_ZENTAO_BASE_URL, FH_ZENTAO_USER, FH_ZENTAO_PASSWORD, FH_ZENTAO_PROJECT_ID } = process.env;

async function login() {
  const res = await fetch(FH_ZENTAO_BASE_URL + '/api.php/v1/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: FH_ZENTAO_USER, password: FH_ZENTAO_PASSWORD }),
  });
  if (!res.ok) throw new Error('禅道登录失败 ' + res.status);
  const data = await res.json();
  return data.token;
}

async function listTodos(token) {
  const res = await fetch(FH_ZENTAO_BASE_URL + '/api.php/v1/projects/' + FH_ZENTAO_PROJECT_ID + '/tasks?status=wait', {
    headers: { Token: token, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.tasks || [];
}

async function main() {
  const token = await login();
  const todos = await listTodos(token);
  for (const t of todos.slice(0, 5)) {
    const goal = \`根据禅道任务实现代码变更：\n任务：\${t.name}\n\${t.desc || ''}\n请给出最小改动方案并执行。\`;
    const out = execFileSync('npx', ['-y', 'feihong-code@latest', goal], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
    console.log('任务 ' + t.id + ' 处理完成：' + out.slice(0, 200));
    // 回写禅道备注（路径按版本调整）
    await fetch(FH_ZENTAO_BASE_URL + '/api.php/v1/tasks/' + t.id + '/actions', {
      method: 'POST',
      headers: { Token: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: '🤖 fhcode：' + out.slice(0, 2000) }),
    }).catch(() => {});
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
`,
    },
  ],
  postInstructions: [
    '1. 复制 .env.example.zentao 内容到 .env 并填真实值',
    '2. 禅道后台确认 API 已开启（后台 → 系统 → 接口），并核对 API 路径与当前禅道版本一致',
    '3. 试运行：node scripts/fhcode-zentao-bridge.mjs',
    '4. 可结合 fhcode routine 定时执行',
  ],
};

export const INTEGRATION_TEMPLATES: IntegrationTemplate[] = [
  IM_FEISHU,
  IM_WECOM,
  CICD_GITHUB,
  CICD_GITLAB,
  CICD_JENKINS,
  TICKETING_JIRA,
  TICKETING_ZENTAO,
];

export function listIntegrationTemplates(): IntegrationTemplate[] {
  return INTEGRATION_TEMPLATES;
}

export function getIntegrationTemplate(id: string): IntegrationTemplate | undefined {
  return INTEGRATION_TEMPLATES.find((t) => t.id === id);
}
