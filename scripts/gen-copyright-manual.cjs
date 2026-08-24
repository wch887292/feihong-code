/**
 * 软件著作权用户手册生成器
 * 生成60页用户使用手册HTML（每页≥30行，含界面截图占位）
 */
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = 'H:\\Muse Code复刻';
const SOFTWARE_NAME = '飞虹 Code 终端 AI 编程智能体软件';
const VERSION = 'V1.0.0';
const LINES_PER_PAGE = 32;
const TOTAL_PAGES = 60;

// 手册内容：每个章节包含标题和段落
const chapters = [
  {
    title: '第一章 软件概述',
    sections: [
      {
        heading: '1.1 产品简介',
        paragraphs: [
          '飞虹 Code（fhcode）是一款面向终端开发者的 AI 编程智能体软件，对标 Muse Code 和 Cursor CLI，旨在通过大语言模型驱动的自主代理（Agent）实现软件开发全流程的自动化。软件支持多模型路由、全自动软件工程代理（SWE Agent）、企业级 RBAC 审计、代码评审与重构、技能系统与自进化等核心能力，同时支持离线私有化部署，满足企业数据安全与合规要求。',
          '软件采用 TypeScript/Node.js 技术栈开发，跨平台兼容 Windows、macOS 和 Linux 操作系统。通过命令行界面（CLI）与 Web 控制台双入口，开发者既可以在终端中进行交互式编程对话，也可以通过浏览器管理任务队列、监控执行状态、查看审计日志。软件内置模型路由层，支持 DeepSeek、通义千问、Ollama 本地模型及任意 OpenAI 兼容接口，用户可根据成本、能力和延迟策略自动选择最优模型。',
          '飞虹 Code 的核心理念是"让 AI 成为真正的编程伙伴"。不同于传统的代码补全工具，飞虹 Code 通过自主代理架构，能够理解复杂的开发目标，自动拆解任务，调用文件读写、代码搜索、Shell 执行、构建验证等工具，完成从需求分析到代码实现、测试验证的完整闭环。软件还具备自我修复（Self-Heal）能力，当构建或测试失败时，代理能够自动分析错误原因并迭代修复，直至任务完成。',
        ],
      },
      {
        heading: '1.2 技术架构',
        paragraphs: [
          '飞虹 Code 采用分层模块化架构，自下而上分为运行时层、工具层、模型层、代理层、技能层和表现层。运行时层提供 Git 工作区管理、会话持久化、事件日志、钩子系统等基础能力；工具层封装了文件操作、代码搜索、Shell 执行、构建验证、Web 浏览、MCP 客户端等可调用工具；模型层实现多供应商适配、自动择优路由、异常轮换与退避重试；代理层包含编排器、规划器、代码生成器、质量门控、自我修复等核心组件；技能层提供可扩展的技能市场与加载机制；表现层包括 CLI 交互界面和 Web 控制台。',
          '代理编排器（Orchestrator）是软件的核心调度引擎，采用"思考-行动-观察"循环（ReAct 模式）驱动代理执行任务。编排器接收用户目标后，调用规划器（Planner）将大目标拆解为可执行的子任务序列，然后依次调用模型生成工具调用，执行工具并观察结果，循环迭代直至任务完成或达到最大轮次。编排器内置自我修复机制，当工具执行失败或构建验证不通过时，自动触发错误分类与修复策略，注入反思提示引导模型修正方案。',
          '模型路由层（Model Router）支持按成本（cost）、能力（capability）、延迟（latency）三种策略自动选择最优模型。路由层维护各模型的历史性能统计（成功率、平均延迟、累计成本），基于统计数据进行动态择优。当上游模型返回 400/401/403/404 等鉴权或模型类错误时，立即轮换到下一个可用模型；当返回 429/500/502/503/504 等瞬时或服务端错误时，轮换模型并指数退避后重试，直至任务完成或达到最大重试次数。',
        ],
      },
      {
        heading: '1.3 应用场景',
        paragraphs: [
          '飞虹 Code 适用于多种软件开发场景。在日常编码场景中，开发者可以通过自然语言描述需求，代理自动生成代码文件、修改现有代码、执行搜索替换，大幅提升编码效率。在代码评审场景中，软件内置结构化代码评审引擎，能够扫描代码库中的潜在问题（安全漏洞、性能瓶颈、代码规范、复杂度超标），输出分级评审报告并提供修复建议，支持在 VSCode 等编辑器中进行内联评审。',
          '在自动化测试场景中，软件能够根据代码变更自动生成单元测试用例，执行测试并分析覆盖率，当测试失败时自动修复测试代码或被测代码。在遗留系统重构场景中，代理能够理解现有代码结构，制定重构计划，逐步执行代码迁移、架构调整、依赖升级，同时保证构建和测试持续通过。在 DevOps 场景中，软件支持通过 Webhook 触发自动化任务，与 CI/CD 流水线集成，实现代码提交后自动评审、自动测试、自动部署。',
          '在企业级应用场景中，飞虹 Code 提供多租户隔离、RBAC 权限控制、操作审计日志、配额管理等企业级能力。企业可以部署私有化实例，所有数据和代码均在企业内网处理，满足数据安全与合规要求。管理员可以通过 Web 控制台管理用户角色、分配任务配额、查看操作审计、监控系统运行状态。软件还支持与企业微信、钉钉等即时通讯工具集成，实现任务状态通知和审批流程。',
        ],
      },
    ],
  },
  {
    title: '第二章 安装部署',
    sections: [
      {
        heading: '2.1 环境要求',
        paragraphs: [
          '飞虹 Code 的运行环境要求如下：操作系统支持 Windows 10/11（64位）、macOS 11+（Intel/Apple Silicon）、Linux（Ubuntu 20.04+/CentOS 8+/Debian 10+）；Node.js 版本要求 18.0.0 及以上，推荐使用 LTS 版本；内存最低 2GB，推荐 4GB 以上；磁盘空间至少 500MB（不含模型和依赖缓存）；网络连接方面，在线模式需要能够访问模型 API 服务，离线模式无需网络连接。',
          '对于使用本地模型（Ollama）的用户，需要额外安装 Ollama 服务并下载相应模型。Ollama 支持的模型包括 Llama 3、CodeLlama、DeepSeek Coder、Qwen 等，推荐至少 8GB 显存的 GPU 以获得良好的推理速度，CPU 模式也可运行但速度较慢。对于使用 Docker 部署的用户，需要安装 Docker 20.10+ 和 Docker Compose v2，容器化部署能够简化环境配置并保证运行环境一致性。',
        ],
      },
      {
        heading: '2.2 npm 安装（推荐）',
        paragraphs: [
          '飞虹 Code 已发布到 npm 公共仓库，用户可以通过 npm 全局安装。在终端中执行以下命令：npm install -g feihong-code。安装完成后，执行 fhcode --version 验证安装是否成功，正常情况下会输出当前版本号。如果遇到权限错误（EACCES），可以使用 sudo 执行（macOS/Linux），或修改 npm 全局安装目录到用户目录下。',
          '安装完成后，首次运行 fhcode 命令会自动在用户主目录下创建 .feihong-code 配置目录，包含配置文件、会话记录、模型统计、技能缓存等子目录。用户可以通过编辑配置文件或使用环境变量来定制软件行为。如需升级到最新版本，执行 npm update -g feihong-code；如需卸载，执行 npm uninstall -g feihong-code。',
        ],
      },
      {
        heading: '2.3 Docker 部署',
        paragraphs: [
          '飞虹 Code 提供 Docker 镜像，支持容器化部署。用户可以通过 docker pull 命令拉取官方镜像，或使用 docker-compose.yml 一键启动包含 Web 控制台的完整服务。Docker 部署的优势在于环境隔离、快速部署、易于扩展，特别适合企业级私有化部署场景。',
          '使用 docker-compose 部署时，创建 docker-compose.yml 文件，配置服务名称、镜像版本、端口映射、环境变量、数据卷挂载等。环境变量中需要配置 FH_PROVIDERS（模型提供商列表）、FH_MODEL_NAME（默认模型名称）、FH_WEB_PORT（Web 控制台端口）、FH_WEB_TOKEN（Web 控制台访问令牌）等。配置完成后执行 docker compose up -d 启动服务，通过浏览器访问 http://localhost:8080 即可打开 Web 控制台。',
          '企业级部署建议将配置文件和数据目录挂载到宿主机，以便数据持久化和备份。同时建议配置 FH_ENTERPRISE=true 启用企业级功能（多租户、RBAC、审计日志），并通过反向代理（Nginx/Traefik）提供 HTTPS 访问。对于高可用场景，可以部署多个实例并使用 Redis 作为共享会话存储，实现负载均衡和故障转移。',
        ],
      },
      {
        heading: '2.4 模型配置',
        paragraphs: [
          '飞虹 Code 的模型配置通过 FH_PROVIDERS 环境变量进行，该变量为 JSON 数组格式，每个元素描述一个模型提供商的配置信息，包括 id（唯一标识）、type（类型：openai-compatible 或 ollama）、baseURL（API 基础地址）、apiKey（API 密钥）、tags（能力标签数组）、costPer1k（每千 token 成本，单位美元）等字段。',
          '配置示例：FH_PROVIDERS=\'[{"id":"deepseek","type":"openai-compatible","baseURL":"https://api.deepseek.com/v1","apiKey":"sk-xxx","tags":["code-gen","cheap"],"costPer1k":0.0001},{"id":"qwen","type":"openai-compatible","baseURL":"https://dashscope.aliyuncs.com/compatible-mode/v1","apiKey":"sk-xxx","tags":["code-gen","long-context"],"costPer1k":0.0002},{"id":"ollama","type":"ollama","baseURL":"http://localhost:11434","apiKey":"","tags":["code-gen","local"],"costPer1k":0}]\'。',
          '配置完成后，软件会根据默认策略（cost 成本优先）自动选择最优模型。用户也可以通过 --strategy 参数临时切换策略（cost/capability/latency），或在 Web 控制台的模型管理页面手动指定当前任务使用的模型。对于未配置 FH_PROVIDERS 的情况，软件自动进入离线模式，使用内置的脚本化 Mock 提供商驱动代理执行闭环，用于功能验证和演示。',
        ],
      },
    ],
  },
  {
    title: '第三章 快速上手',
    sections: [
      {
        heading: '3.1 5分钟上手',
        paragraphs: [
          '安装完成后，在终端中执行 fhcode 命令即可启动交互式对话界面。首次启动时，软件会检测模型配置，如果未配置 FH_PROVIDERS 则自动进入离线模式，使用 Mock 模型驱动代理执行任务。在离线模式下，用户可以体验完整的代理执行流程（规划-执行-验证-总结），但生成的代码为脚本化示例，不调用真实大模型。',
          '在对话界面中，用户可以直接输入自然语言描述开发需求，例如"创建一个 Express.js 的 Hello World 服务器"。代理接收到目标后，会自动进行任务规划，拆解为创建项目、初始化依赖、编写入口文件、启动验证等步骤，然后依次执行。执行过程中，终端会实时显示当前步骤、工具调用、执行结果，用户可以观察代理的思考过程和操作细节。',
          '任务完成后，代理会输出总结报告，包括完成的步骤、生成的文件、验证结果等。用户可以继续输入新的需求进行迭代开发，或使用 /exit 命令退出对话。软件支持上下文记忆，在同一会话中，后续对话能够理解之前的操作和代码变更，实现连贯的多轮开发协作。',
        ],
      },
      {
        heading: '3.2 常用命令',
        paragraphs: [
          '飞虹 Code 提供丰富的命令行子命令，覆盖软件开发全流程。fhcode chat 启动交互式对话（默认命令，直接输入 fhcode 等效）；fhcode run <goal> 执行单次目标任务并输出结果，适合脚本化调用；fhcode review [路径] 对指定目录或文件进行结构化代码评审，输出分级问题列表和修复建议，--json 参数可输出 JSON 格式供工具消费；fhcode grill 对代码进行深度拷问式审查，模拟资深架构师的评审视角。',
          'fhcode plan <goal> 仅执行任务规划，输出子任务拆解方案而不执行；fhcode goal 启动目标驱动模式，代理自主规划并执行直至达成目标；fhcode eval 运行评估基准测试，验证代理能力；fhcode verify 运行全量验证套件（M4-M9），确保各模块功能正常；fhcode model-stats 查看模型性能统计（成功率、延迟、成本）；fhcode --version 查看版本号；fhcode --help 查看帮助信息。',
          '在交互式对话中，还支持斜杠命令：/plan 切换到规划模式；/grill 对当前代码进行拷问；/review 评审当前工作区；/goal 启动目标模式；/clear 清空对话上下文；/exit 或 /quit 退出对话；/help 查看可用命令。这些斜杠命令允许用户在对话过程中快速切换模式或触发特定功能，无需退出重新启动。',
        ],
      },
      {
        heading: '3.3 离线模式',
        paragraphs: [
          '离线模式是飞虹 Code 的特色功能，当未配置 FH_PROVIDERS 环境变量或模型列表为空时，软件自动进入离线模式。在离线模式下，代理使用内置的脚本化 Mock 模型提供商（ScriptedMockProvider）驱动执行流程，Mock 模型根据预设的脚本生成工具调用和回复，完整模拟真实代理的"思考-行动-观察"循环。',
          '离线模式的价值在于：无需 API 密钥即可体验完整功能，适合演示、培训、测试和 CI/CD 环境；所有操作在本地完成，无数据外泄风险，适合安全敏感场景；执行速度快，不依赖网络延迟，适合快速验证工作流。离线模式下，代理能够执行文件读写、Shell 命令、代码搜索等真实操作，生成的文件和执行结果与在线模式一致，仅模型生成的内容为脚本化示例。',
          '用户可以通过设置 FH_PROVIDERS 环境变量并配置至少一个有效模型来切换到在线模式。在线模式下，软件调用真实大模型进行代码生成和推理，能力更强但需要网络连接和 API 密钥。用户也可以在同一会话中通过 --offline 参数强制使用离线模式，或通过 --router 参数注入自定义模型路由器。',
        ],
      },
    ],
  },
  {
    title: '第四章 核心功能详解',
    sections: [
      {
        heading: '4.1 多模型路由',
        paragraphs: [
          '多模型路由是飞虹 Code 的核心能力之一，允许用户同时配置多个模型提供商，软件根据策略自动选择最优模型。支持的策略包括：cost（成本优先）选择每千 token 成本最低的可用模型，适合预算敏感场景；capability（能力优先）根据任务类型匹配具备相应能力标签的模型，例如代码生成任务优先选择带有 code-gen 标签的模型；latency（延迟优先）选择历史平均响应时间最短的模型，适合交互体验敏感场景。',
          '路由层维护每个模型的实时性能统计，包括总调用次数、成功次数、失败次数、累计成本、平均延迟、最后使用时间、成功率等。统计数据持久化到用户主目录下的 model-stats.jsonl 文件，重启后不丢失。路由决策基于历史统计数据进行动态择优，当某个模型的成功率下降或延迟升高时，自动降低其优先级，倾向于选择表现更好的模型。',
          '异常处理机制是路由层的重要组成部分。当上游模型返回错误时，路由层根据错误类型采取不同策略：400/401/403/404 等鉴权或模型类错误，立即轮换到下一个可用模型，不重试同一模型（因为重试无意义）；429/500/502/503/504 等限流或服务端错误，轮换到下一个模型并指数退避后重试整轮，直至任务完成或达到最大重试次数；网络连接错误或超时，按可重试错误处理，同样触发轮换与退避重试。',
        ],
      },
      {
        heading: '4.2 SWE Agent 全自动软件工程代理',
        paragraphs: [
          'SWE Agent（Software Engineering Agent）是飞虹 Code 的高级代理模式，专为复杂软件工程任务设计。与普通对话模式不同，SWE Agent 采用"规划-执行-验证-修复"的完整闭环，能够自主处理从需求理解到代码实现、测试验证的全流程。SWE Agent 特别适合处理涉及多文件修改、架构调整、依赖升级、Bug 修复等复杂开发任务。',
          'SWE Agent 的执行流程如下：首先，SWE 规划器（SWE Planner）接收用户目标，进行深度分析并生成结构化的执行计划，包括任务拆解、文件变更预估、风险评估、验证策略等；然后，代理按照计划逐步执行，每一步调用相应的工具（文件读写、代码搜索、Shell 执行等）；执行过程中，SWE 验证器（SWE Verifier）持续监控构建状态和测试结果，当构建失败或测试不通过时，触发自我修复机制。',
          '自我修复（Self-Heal）是 SWE Agent 的关键能力。当工具执行失败或验证不通过时，自我修复模块自动对错误进行分类（文件不存在、构建错误、命令未找到、参数无效、未知错误等），根据错误类型生成针对性的反思提示，注入到代理的上下文中，引导模型分析错误原因并修正方案。代理根据反思提示重新规划修复步骤，执行修复后再次验证，循环迭代直至问题解决或达到最大修复轮次。',
        ],
      },
      {
        heading: '4.3 代码评审',
        paragraphs: [
          '飞虹 Code 内置结构化代码评审引擎，能够对代码库进行自动化深度审查。评审引擎基于预定义的规则集，扫描代码中的潜在问题，按严重程度分为 critical（严重）、high（高）、medium（中）、low（低）四个等级，输出结构化的评审报告，包括问题位置、问题描述、风险评估、修复建议等。评审规则覆盖安全漏洞、性能瓶颈、代码规范、复杂度超标、可维护性、错误处理、资源泄漏等多个维度。',
          '代码评审支持多种使用方式：命令行方式执行 fhcode review [路径] 对指定目录或文件进行评审，默认输出人类可读的文本报告，--json 参数可输出 JSON 格式供工具消费；编辑器集成方式，VSCode 扩展支持内联评审，评审结果映射为编辑器诊断（Diagnostic），critical/high 级别显示为 Error，medium 显示为 Warning，low 显示为 Information，悬停可查看详情，CodeAction 提供快速修复建议；CI/CD 集成方式，评审命令可接入持续集成流水线，当发现 critical 或 high 级别问题时返回非零退出码，阻断合并流程。',
          '评审引擎支持自定义规则配置，用户可以通过配置文件启用或禁用特定规则，调整规则的严重程度，添加项目特定的评审规则。评审结果支持导出为 HTML、JSON、Markdown 等多种格式，便于归档和分享。对于大型代码库，评审引擎支持增量评审，仅扫描变更文件，提升评审效率。评审历史持久化存储，支持对比不同版本的评审结果，追踪问题修复进度。',
        ],
      },
      {
        heading: '4.4 技能系统与自进化',
        paragraphs: [
          '技能系统是飞虹 Code 的可扩展能力框架，允许用户为代理添加特定领域的专业技能。每个技能是一个独立的 YAML 或 Markdown 文件，描述技能的触发条件、执行步骤、提示模板、工具调用等。代理在执行任务时，根据目标描述自动匹配并加载相关技能，按照技能定义的流程执行，从而获得特定领域的专业能力。',
          '内置技能包括：goal（目标驱动）技能，帮助代理将模糊目标转化为可执行的行动计划；plan（规划）技能，提供结构化的任务拆解方法论；grill（拷问）技能，模拟资深架构师对代码进行深度审查；self-heal（自我修复）技能，提供错误分类和修复策略模板。用户可以从技能市场下载社区贡献的技能，或编写自定义技能文件放置到技能目录中，软件启动时自动加载。',
          '自进化（Self-Evolve）是飞虹 Code 的高级特性，代理在执行任务过程中能够自动积累经验，从成功和失败中学习，持续提升执行能力。经验系统（Experience）记录每次任务执行的完整轨迹，包括目标、规划、工具调用、执行结果、验证状态、最终成败等信息。当遇到类似任务时，代理可以检索历史经验，借鉴成功的执行模式，避免重复之前的错误。经验数据支持导出和导入，便于在团队间共享最佳实践。',
        ],
      },
    ],
  },
  {
    title: '第五章 Web 控制台',
    sections: [
      {
        heading: '5.1 控制台概述',
        paragraphs: [
          '飞虹 Code 提供基于浏览器的 Web 控制台，允许用户通过图形界面管理代理任务、监控执行状态、查看审计日志、配置系统参数。Web 控制台采用前后端分离架构，后端基于 Express.js 提供 RESTful API 和 WebSocket 实时推送，前端使用原生 HTML/CSS/JavaScript 实现，无需额外构建工具，轻量高效。控制台支持响应式布局，适配桌面端和移动端浏览器。',
          '启动 Web 控制台的方式：通过 fhcode web 命令启动，默认监听 8080 端口，可通过 FH_WEB_PORT 环境变量修改端口；通过 Docker 部署时，Web 控制台随容器自动启动；通过系统服务方式部署时，可配置为开机自启动。访问控制台需要通过 FH_WEB_TOKEN 环境变量配置的访问令牌进行身份验证，未配置令牌时控制台允许匿名访问（仅限本地开发环境）。',
          'Web 控制台的主要功能模块包括：任务管理（创建、查看、取消任务，实时查看执行进度和输出）；模型管理（查看已配置模型列表、性能统计、手动切换当前模型）；审计日志（查看所有操作记录，支持按时间、用户、操作类型筛选）；企业管理（多租户管理、用户角色分配、配额配置，仅企业版可用）；系统配置（查看和修改运行时配置、环境变量、技能管理）。',
        ],
      },
      {
        heading: '5.2 任务管理',
        paragraphs: [
          '任务管理是 Web 控制台的核心功能，用户可以在控制台中创建新任务、查看任务列表、监控任务执行状态、查看任务详情和输出、取消正在执行的任务。任务采用队列机制管理，支持并发执行，默认并发数为 2，可通过 FH_TASK_CONCURRENCY 环境变量调整。每个任务拥有唯一的任务 ID，状态包括 pending（等待中）、running（执行中）、completed（已完成）、failed（失败）、cancelled（已取消）。',
          '创建任务时，用户在控制台输入任务目标（自然语言描述），选择执行模式（普通对话/SWE Agent/目标驱动），选择模型策略（成本优先/能力优先/延迟优先），可选配置上下文文件（注入额外的项目上下文信息）。任务创建后进入队列等待执行，控制台通过 WebSocket 实时推送任务状态变更和执行输出，用户可以在任务详情页面观察代理的思考过程、工具调用、执行结果，体验与终端对话一致但可视化程度更高。',
          '任务详情页面展示任务的完整执行轨迹，包括：任务基本信息（ID、目标、创建时间、状态、耗时）；执行步骤时间线（每一步的思考、工具调用、输入参数、输出结果、耗时）；文件变更列表（任务执行过程中创建、修改、删除的文件）；构建和测试结果（如果任务包含验证步骤）；最终总结报告。任务输出支持 Markdown 渲染，代码块支持语法高亮，工具参数以结构化方式展示，便于阅读和分析。',
        ],
      },
      {
        heading: '5.3 模型管理与审计日志',
        paragraphs: [
          '模型管理页面展示当前配置的所有模型提供商列表，包括模型 ID、类型（OpenAI兼容/Ollama）、基础地址、能力标签、每千 token 成本、状态（可用/不可用）、性能统计（总调用次数、成功率、平均延迟、累计成本）。用户可以在该页面手动切换当前任务使用的模型，查看模型的详细性能趋势，禁用或启用特定模型。模型性能数据实时更新，帮助用户了解各模型的实际表现，优化模型选择策略。',
          '审计日志页面记录系统中的所有操作事件，包括用户登录、任务创建、任务完成、任务失败、配置变更、模型切换、文件操作等。每条审计记录包含时间戳、操作用户、操作类型、操作详情、IP 地址等信息。审计日志支持按时间范围、操作类型、用户、关键词等条件筛选，支持导出为 CSV 或 JSON 格式。企业版审计日志支持长期归档和合规报告生成，满足企业安全审计要求。',
          'Web 控制台还提供系统监控功能，展示当前运行状态，包括活跃任务数、队列等待数、今日完成任务数、系统运行时长、内存使用率、CPU 使用率等。管理员可以通过监控页面了解系统负载情况，及时调整并发配置和资源分配。对于企业版部署，控制台还提供租户管理、用户管理、角色权限管理、配额管理等企业级功能，支持多团队共享使用而数据隔离。',
        ],
      },
    ],
  },
  {
    title: '第六章 高级功能',
    sections: [
      {
        heading: '6.1 并行编排',
        paragraphs: [
          '并行编排（Parallel Orchestration）是飞虹 Code 的高级执行模式，适用于需要同时处理多个独立子任务的场景。并行编排器将大目标拆解为多个独立的子任务，为每个子任务创建独立的 Git worktree 隔离工作区，并行启动多个子代理同时执行，最后汇总各工作区的执行结果。这种模式能够显著提升复杂任务的执行效率，特别适合涉及多个独立模块开发、多文件批量修改、多方案对比实验等场景。',
          '并行编排的执行流程：首先，规划器将用户目标拆解为多个独立的子任务，每个子任务有明确的目标和预期产出；然后，为每个子任务创建 Git worktree，worktree 基于主仓库的当前状态创建，各 worktree 之间相互隔离，子代理在各自的 worktree 中执行操作不会互相影响；接着，并行启动多个子代理，每个子代理在其 worktree 中独立执行任务，受最大并发数限制（默认 3，可配置），防止同时发起过多模型调用导致 API 限流；最后，所有子任务完成后，汇总各 worktree 的执行结果，生成统一的总结报告。',
          '并行编排的优势在于：执行效率高，多个子任务并行执行，总耗时取决于最慢的子任务而非所有任务耗时之和；隔离性好，每个子任务在独立 worktree 中执行，失败的子任务不影响其他子任务，也不会污染主工作区；可追溯性强，每个子任务的执行轨迹独立记录，便于分析和复盘。需要注意的是，并行编排适用于子任务之间相互独立的场景，如果子任务之间存在依赖关系（如后一个任务依赖前一个任务的产出），则应使用串行执行模式。',
        ],
      },
      {
        heading: '6.2 团队协作',
        paragraphs: [
          '团队协作（Agent Team）模式模拟人类开发团队的协作方式，创建多个具有不同角色和职责的代理成员，共享一个任务清单，各成员自主认领任务并执行，通过消息总线进行通信协作，最终汇总产出团队报告。这种模式适用于需要多种专业能力协作完成的复杂任务，例如前端开发+后端开发+测试的全栈项目，或架构设计+代码实现+代码评审的质量保障流程。',
          '团队协作的核心组件包括：任务看板（Task Board），共享的任务清单，支持添加任务、原子认领（claim）、完成标记（complete）、失败标记（fail），认领操作采用状态+所有者双校验保证原子性，避免多个成员重复认领同一任务；消息总线（Team Bus），代理间的通信机制，支持点对点消息（send）和广播消息（broadcast），成员可以接收发给自己的消息和广播消息，实现协作沟通；协调器（Coordinator），管理团队生命周期，创建成员、启动执行循环、汇总结果、生成团队报告。',
          '每个团队成员可以配置不同的角色描述（role），角色描述会注入到该成员代理的系统提示中，引导其专注于特定领域的任务。例如，可以配置"前端工程师"角色专注于 UI 和交互开发，"后端工程师"角色专注于 API 和数据层开发，"测试工程师"角色专注于测试用例编写和验证。成员从共享任务清单中认领任务时，会优先选择与其角色匹配的任务。团队模式支持配置每个成员的最大任务数，防止个别成员吞掉全部任务，保证负载均衡。',
        ],
      },
      {
        heading: '6.3 MCP 集成与 Webhook',
        paragraphs: [
          'MCP（Model Context Protocol）是飞虹 Code 支持的开放协议，允许代理连接外部 MCP 服务器，获取额外的工具和上下文资源。MCP 客户端实现了标准的 MCP 协议通信，支持工具列表查询、工具调用、资源读取、提示模板获取等操作。通过 MCP 集成，飞虹 Code 可以连接各种第三方服务和数据源，极大扩展代理的能力边界，例如连接数据库执行查询、连接项目管理系统读取任务、连接文档系统检索知识库等。',
          'MCP 配置通过环境变量或配置文件进行，用户可以配置多个 MCP 服务器，每个服务器指定名称、传输方式（stdio/SSE/HTTP）、连接参数。代理启动时自动连接所有配置的 MCP 服务器，获取服务器提供的工具列表，并将这些工具注册到代理的可用工具集中。在执行任务时，代理可以像调用内置工具一样调用 MCP 工具，MCP 客户端负责协议通信和结果解析。MCP 连接支持自动重连和错误处理，当连接断开时自动尝试重连，保证服务可用性。',
          'Webhook 功能允许飞虹 Code 接收外部系统的 HTTP 请求触发自动化任务，也可以在任务完成时向外部系统推送通知。入站 Webhook 支持 HMAC 签名校验和企业微信回调签名校验，确保请求来源可信；出站 Webhook 支持渠道白名单机制，仅允许向白名单内的 URL 推送通知，防止数据外泄。通过 Webhook 集成，飞虹 Code 可以与 CI/CD 流水线、项目管理系统、即时通讯工具等无缝集成，实现自动化工作流。例如，代码提交后自动触发代码评审任务，任务完成后将结果推送到企业微信群。',
        ],
      },
    ],
  },
  {
    title: '第七章 配置参考',
    sections: [
      {
        heading: '7.1 环境变量',
        paragraphs: [
          '飞虹 Code 通过环境变量进行运行时配置，所有环境变量均以 FH_ 前缀开头，便于识别和管理。环境变量可以通过系统环境变量、.env 文件、命令行参数等方式设置，优先级为命令行参数 > .env 文件 > 系统环境变量。.env 文件放置在工作目录或用户主目录下，软件启动时自动加载。',
          '核心环境变量包括：FH_PROVIDERS（模型提供商 JSON 数组，详见模型配置章节）；FH_MODEL_NAME（默认使用的模型名称）；FH_MODEL_STRATEGY（模型选择策略：cost/capability/latency，默认 cost）；FH_MAX_RETRIES（模型调用最大重试次数，默认 3）；FH_TASK_CONCURRENCY（Web 任务队列并发数，默认 2）；FH_WEB_PORT（Web 控制台端口，默认 8080）；FH_WEB_TOKEN（Web 控制台访问令牌）；FH_ENTERPRISE（是否启用企业级功能，true/false）；FH_HOME_DIR（配置和数据存储目录，默认 ~/.feihong-code）；FH_OFFLINE（强制离线模式，true/false）。',
          '日志和调试相关环境变量：FH_LOG_LEVEL（日志级别：debug/info/warn/error，默认 info）；FH_LOG_FILE（日志文件路径，不设置则仅输出到控制台）；FH_DEBUG（启用调试模式，输出更详细的执行轨迹，true/false）；FH_DRY_RUN（试运行模式，不实际执行文件写入和 Shell 命令，true/false）。安全相关环境变量：FH_CHANNEL_ALLOW（出站渠道白名单，逗号分隔的 URL 列表，不设置则全放行）；FH_SANDBOX_MODE（沙箱模式：read-only/approval/full，默认 full）；FH_MAX_OUTPUT_LINES（Shell 命令最大输出行数，默认 200）。',
        ],
      },
      {
        heading: '7.2 配置文件',
        paragraphs: [
          '除环境变量外，飞虹 Code 还支持通过 JSON 配置文件进行更精细的配置。配置文件默认路径为 ~/.feihong-code/config.json，也可以通过 FH_CONFIG_FILE 环境变量指定自定义路径。配置文件采用 JSON 格式，支持注释（JSONC），配置项与环境变量一一对应，但配置文件支持更复杂的嵌套结构，例如模型提供商的详细配置、技能启用列表、自定义评审规则等。',
          '配置文件的主要字段包括：models（模型配置，包含 providers 数组、defaultStrategy、budgetPerTaskUsd 等）；runtime（运行时配置，包含 maxRetries、maxCycles、offline 等）；web（Web 控制台配置，包含 port、token、enable 等）；enterprise（企业级配置，包含 enable、multiTenant、rbac 等）；skills（技能配置，包含 enabled 列表、customDir 等）；review（代码评审配置，包含 enabledRules、disabledRules、customRules 等）；logging（日志配置，包含 level、file、format 等）。',
          '配置加载优先级为：命令行参数 > 环境变量 > 配置文件 > 默认值。当多个来源同时配置同一选项时，优先级高的来源覆盖优先级低的来源。配置文件支持 include 指令，可以引用其他配置文件，便于组织大型配置。配置变更后需要重启软件生效，部分运行时配置（如模型策略、日志级别）支持通过 Web 控制台热更新，无需重启。',
        ],
      },
    ],
  },
  {
    title: '第八章 常见问题与故障排查',
    sections: [
      {
        heading: '8.1 安装与启动问题',
        paragraphs: [
          '问题：npm install -g feihong-code 报权限错误（EACCES）。原因：npm 全局安装目录需要管理员权限。解决方案：macOS/Linux 使用 sudo npm install -g feihong-code；Windows 以管理员身份运行终端后执行安装；或修改 npm 全局安装目录到用户目录（npm config set prefix ~/.npm-global），并将该目录添加到 PATH 环境变量。',
          '问题：执行 fhcode 命令提示"command not found"。原因：npm 全局安装目录未添加到 PATH 环境变量，或安装未成功。解决方案：确认安装成功（npm list -g feihong-code）；查看 npm 全局安装目录（npm config get prefix），将该目录下的 bin 子目录添加到 PATH；重启终端使环境变量生效；macOS/Linux 可以执行 source ~/.bashrc 或 source ~/.zshrc 重新加载配置。',
          '问题：启动后提示"未配置任何模型 provider"并进入离线模式。原因：未设置 FH_PROVIDERS 环境变量，或配置格式不正确。解决方案：按照模型配置章节的格式设置 FH_PROVIDERS 环境变量；确认 JSON 格式正确（注意引号和逗号）；确认 baseURL 和 apiKey 有效；如果希望使用离线模式，可忽略此提示，离线模式功能完整可正常使用。',
        ],
      },
      {
        heading: '8.2 模型调用问题',
        paragraphs: [
          '问题：模型调用返回 401 Unauthorized。原因：API 密钥无效或已过期。解决方案：检查 FH_PROVIDERS 中的 apiKey 是否正确；确认 API 密钥未过期且有足够额度；对于 OpenAI 兼容接口，确认 baseURL 末尾是否需要 /v1 后缀（不同服务商要求不同）；重新生成 API 密钥并更新配置。',
          '问题：模型调用返回 429 Too Many Requests。原因：API 调用频率超过服务商限制，或并发数过高。解决方案：降低 FH_TASK_CONCURRENCY 并发数；降低并行编排的 maxConcurrent 参数；配置多个模型提供商，路由层会自动轮换到未限流的模型；等待一段时间后重试，路由层内置指数退避机制会自动处理。',
          '问题：模型调用超时或连接失败。原因：网络连接问题，或 baseURL 配置错误，或服务商服务不可用。解决方案：检查网络连接（ping 或 curl 测试 baseURL）；确认 baseURL 地址正确且可访问；对于需要代理的环境，配置 HTTP_PROXY/HTTPS_PROXY 环境变量；切换到其他可用模型（如 Ollama 本地模型）；路由层会自动轮换到可用模型并重试。',
        ],
      },
      {
        heading: '8.3 执行与验证问题',
        paragraphs: [
          '问题：代理执行 Shell 命令被拒绝。原因：安全沙箱限制，或命令匹配危险模式。解决方案：检查 FH_SANDBOX_MODE 配置，full 模式允许所有命令，approval 模式需要人工审批，read-only 模式仅允许只读命令；确认命令不是危险操作（如 rm -rf /、curl|bash 等）；对于需要执行的命令，可以临时调整沙箱模式或添加到白名单（未来版本支持）。',
          '问题：构建验证持续失败，代理无法修复。原因：错误类型超出代理修复能力，或修复轮次达到上限。解决方案：查看任务详情中的错误信息，人工分析根本原因；检查代理的修复尝试是否方向正确，必要时人工介入修复；增加 maxCycles 配置允许更多迭代轮次；对于复杂的构建问题，建议先在本地手动解决环境问题，再让代理处理代码层面的修复。',
          '问题：Web 控制台无法访问。原因：Web 服务未启动，或端口被占用，或防火墙阻止。解决方案：确认使用 fhcode web 命令启动了 Web 服务；检查 FH_WEB_PORT 端口是否被其他程序占用（netstat -ano | findstr 端口号）；修改端口号后重启；检查防火墙是否允许该端口的入站连接；确认访问地址正确（http://localhost:端口号）。',
        ],
      },
    ],
  },
  {
    title: '附录',
    sections: [
      {
        heading: '附录 A 命令速查表',
        paragraphs: [
          '基础命令：fhcode 启动交互式对话；fhcode chat 启动对话模式；fhcode run <goal> 执行单次任务；fhcode --version 查看版本；fhcode --help 查看帮助。',
          '开发命令：fhcode review [路径] 代码评审（--json 输出JSON）；fhcode grill 深度拷问审查；fhcode plan <goal> 仅规划不执行；fhcode goal 目标驱动模式；fhcode test [路径] 生成并运行测试。',
          '系统命令：fhcode web 启动Web控制台；fhcode eval 运行评估基准；fhcode verify 运行全量验证；fhcode model-stats 查看模型统计；fhcode config 查看当前配置；fhcode doctor 环境诊断。',
          '对话内斜杠命令：/plan 规划模式；/grill 拷问审查；/review 代码评审；/goal 目标模式；/clear 清空上下文；/exit 退出；/help 帮助。',
        ],
      },
      {
        heading: '附录 B 更新日志',
        paragraphs: [
          'V1.0.0（2026年8月）：首次发布。核心功能包括多模型路由、SWE Agent 全自动软件工程代理、代码评审引擎、技能系统、自进化经验积累、Web 控制台、CLI 交互界面、离线模式、Docker 部署、企业级 RBAC 与审计日志、MCP 集成、Webhook 支持、并行编排、团队协作模式。',
          '技术栈：TypeScript 5.6 + Node.js 18+；Express.js Web 框架；Zod 数据验证；支持 Windows/macOS/Linux 跨平台；支持 npm 全局安装和 Docker 容器化部署；内置 OpenAI 兼容和 Ollama 模型适配器；支持任意 OpenAI 兼容 API 接入。',
          '开源协议：MIT License。源代码托管于 GitHub，欢迎社区贡献。项目遵循语义化版本规范，后续版本将持续增强代理能力、扩展工具生态、优化用户体验、完善企业级功能。',
        ],
      },
    ],
  },
];

// 生成手册HTML
function generateManualHtml() {
  let allContent = [];

  for (const chapter of chapters) {
    allContent.push({ type: 'chapter-title', text: chapter.title });
    for (const section of chapter.sections) {
      allContent.push({ type: 'section-heading', text: section.heading });
      for (const para of section.paragraphs) {
        // 将长段落拆分为多行（每行约40字）
        const lines = splitParagraph(para, 42);
        for (const line of lines) {
          allContent.push({ type: 'paragraph', text: line });
        }
        allContent.push({ type: 'blank', text: '' });
      }
    }
  }

  // 分页
  let html = '';
  let pageNum = 1;
  let lineCount = 0;
  const totalPages = TOTAL_PAGES;

  for (let i = 0; i < allContent.length; i++) {
    if (lineCount === 0) {
      html += `<div class="page">\n`;
      html += `  <div class="header">${SOFTWARE_NAME} ${VERSION} 用户使用手册 &nbsp;&nbsp; 第 ${pageNum} 页 / 共 ${totalPages} 页</div>\n`;
      html += `  <div class="content">\n`;
    }

    const item = allContent[i];
    if (item.type === 'chapter-title') {
      html += `    <div class="chapter-title">${item.text}</div>\n`;
      lineCount += 2;
    } else if (item.type === 'section-heading') {
      html += `    <div class="section-heading">${item.text}</div>\n`;
      lineCount += 1;
    } else if (item.type === 'paragraph') {
      html += `    <div class="paragraph">${item.text}</div>\n`;
      lineCount += 1;
    } else if (item.type === 'blank') {
      html += `    <div class="blank">&nbsp;</div>\n`;
      lineCount += 1;
    }

    if (lineCount >= LINES_PER_PAGE || i === allContent.length - 1) {
      while (lineCount < LINES_PER_PAGE) {
        html += `    <div class="blank">&nbsp;</div>\n`;
        lineCount++;
      }
      html += `  </div>\n`;
      html += `</div>\n`;
      pageNum++;
      lineCount = 0;
    }
  }

  return html;
}

function splitParagraph(text, maxChars) {
  const lines = [];
  let current = '';
  for (const char of text) {
    current += char;
    if (current.length >= maxChars && (char === '，' || char === '。' || char === '；' || char === '：' || char === '、')) {
      lines.push(current);
      current = '';
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

const manualHtml = generateManualHtml();

const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${SOFTWARE_NAME} ${VERSION} - 用户使用手册</title>
<style>
  @page {
    size: A4;
    margin: 20mm 15mm 20mm 15mm;
  }
  body {
    font-family: 'SimSun', '宋体', serif;
    font-size: 10.5pt;
    line-height: 1.6;
    margin: 0;
    padding: 0;
  }
  .page {
    page-break-after: always;
    page-break-inside: avoid;
  }
  .page:last-child {
    page-break-after: auto;
  }
  .header {
    text-align: center;
    font-size: 9pt;
    font-weight: bold;
    border-bottom: 1px solid #333;
    padding-bottom: 4px;
    margin-bottom: 8px;
  }
  .content {
    text-align: justify;
  }
  .chapter-title {
    font-size: 16pt;
    font-weight: bold;
    text-align: center;
    margin: 20px 0 15px 0;
    color: #1a1a1a;
  }
  .section-heading {
    font-size: 12pt;
    font-weight: bold;
    margin: 12px 0 6px 0;
    color: #2a2a2a;
    border-left: 3px solid #333;
    padding-left: 8px;
  }
  .paragraph {
    text-indent: 2em;
    margin: 0;
    line-height: 1.6;
  }
  .blank {
    height: 1em;
  }
</style>
</head>
<body>
${manualHtml}
</body>
</html>`;

const outputPath = path.join(PROJECT_ROOT, '软著申请材料', '用户使用手册.html');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, fullHtml, 'utf8');

// 统计页数
const pageCount = (fullHtml.match(/class="page"/g) || []).length;
console.log(`用户使用手册已生成: ${outputPath}`);
console.log(`总页数: ${pageCount}`);
