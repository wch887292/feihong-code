# VoltAgent / awesome-agent-skills 技能目录

> 来源：https://github.com/VoltAgent/awesome-agent-skills（官方+社区 Agent Skills 精选，SKILL.md 格式）
> 生成日期：2026-08-29 · 目录条目：582 条 · 厂商：48 家

## 一、已接入可安装技能（标准 raw 路径直连）

以下技能已通过 `scripts/install-voltagent-skills.mjs` 安装到 `~/.feihong-code/skills/`，
并收录于 `templates/market/voltagent-index.json`（`fhcode skill-market search/install` 可用）。

| 技能 | 来源仓库 | 说明 |
|---|---|---|
| docx | - | Create, edit, and analyze Word documents |
| doc-coauthoring | - | Collaborative document editing and co-authoring |
| pptx | - | Create, edit, and analyze PowerPoint presentations |
| xlsx | - | Create, edit, and analyze Excel spreadsheets |
| pdf | - | Extract text, create PDFs, and handle forms |
| algorithmic-art | - | Create generative art using p5.js with seeded randomness |
| canvas-design | - | Design visual art in PNG and PDF formats |
| frontend-design | - | Frontend design and UI/UX development tools |
| slack-gif-creator | - | Create animated GIFs optimized for Slack size constraints |
| theme-factory | - | Style artifacts with professional themes or generate custom themes |
| web-artifacts-builder | - | Build complex claude.ai HTML artifacts with React and Tailwind |
| mcp-builder | - | Create MCP servers to integrate external APIs and services |
| webapp-testing | - | Test local web applications using Playwright |
| brand-guidelines | - | Apply Anthropic's brand colors and typography to artifacts |
| internal-comms | - | Write status reports, newsletters, and FAQs |
| skill-creator | - | Guide for creating skills that extend Claude's capabilities |
| composio | - | Connect AI agents to 1000+ external apps with managed authentication |
| agents-sdk | - | Build stateful AI agents with scheduling, RPC, and MCP servers |
| cloudflare | - | Comprehensive Cloudflare platform skill covering Workers, Pages, storage, AI, networking, security, and IaC |
| cloudflare-email-service | - | Send transactional email and route inbound mail with Cloudflare Email Sending and Email Routing |
| durable-objects | - | Stateful coordination with RPC, SQLite, and WebSockets |
| web-perf | - | Audit Core Web Vitals and render-blocking resources |
| workers-best-practices | - | Review and author Workers code against production best practices and wrangler.jsonc conventions |
| wrangler | - | Deploy and manage Workers, KV, R2, D1, Vectorize, Queues, Workflows |

## 二、完整目录（582 条，按厂商分组）

> 各厂商技能仓库路径不一，标准路径未命中的技能可用官方命令安装：
> `npx skills add https://github.com/<owner>/<repo> --skill <name>`

| 厂商 | 数量 | 技能 |
|---|---|---|
| microsoft | 133 | cloud-solution-architect, continual-learning, copilot-sdk, entra-agent-id, frontend-design-review, github-issue-creator, mcp-builder, podcast-generation, skill-creator, azure-ai-document-intelligence-dotnet, azure-ai-openai-dotnet, azure-ai-projects-dotnet, azure-ai-voicelive-dotnet, azure-eventgrid-dotnet, azure-eventhub-dotnet, azure-identity-dotnet, azure-maps-search-dotnet, azure-mgmt-apicenter-dotnet, azure-mgmt-apimanagement-dotnet, azure-mgmt-applicationinsights-dotnet, azure-mgmt-arizeaiobservabilityeval-dotnet, azure-mgmt-botservice-dotnet, azure-mgmt-fabric-dotnet, azure-mgmt-mongodbatlas-dotnet, azure-mgmt-weightsandbiases-dotnet, azure-resource-manager-cosmosdb-dotnet, azure-resource-manager-durabletask-dotnet, azure-resource-manager-mysql-dotnet, azure-resource-manager-playwright-dotnet, azure-resource-manager-postgresql-dotnet, azure-resource-manager-redis-dotnet, azure-resource-manager-sql-dotnet, azure-search-documents-dotnet, azure-security-keyvault-keys-dotnet, azure-servicebus-dotnet, m365-agents-dotnet, microsoft-azure-webjobs-extensions-authentication-events-dotnet, azure-ai-anomalydetector-java, azure-ai-contentsafety-java, azure-ai-formrecognizer-java, azure-ai-projects-java, azure-ai-vision-imageanalysis-java, azure-ai-voicelive-java, azure-appconfiguration-java, azure-communication-callautomation-java, azure-communication-callingserver-java, azure-communication-chat-java, azure-communication-common-java, azure-communication-sms-java, azure-compute-batch-java, azure-cosmos-java, azure-data-tables-java, azure-eventgrid-java, azure-eventhub-java, azure-identity-java, azure-messaging-webpubsub-java, azure-monitor-ingestion-java, azure-monitor-opentelemetry-exporter-java, azure-monitor-query-java, azure-security-keyvault-keys-java, azure-security-keyvault-secrets-java, azure-storage-blob-java, agent-framework-azure-ai-py, agents-v2-py, azure-ai-contentsafety-py, azure-ai-contentunderstanding-py, azure-ai-ml-py, azure-ai-projects-py, azure-ai-textanalytics-py, azure-ai-transcription-py, azure-ai-translation-document-py, azure-ai-translation-text-py, azure-ai-vision-imageanalysis-py, azure-ai-voicelive-py, azure-appconfiguration-py, azure-containerregistry-py, azure-cosmos-db-py, azure-cosmos-py, azure-data-tables-py, azure-eventgrid-py, azure-eventhub-py, azure-identity-py, azure-keyvault-py, azure-messaging-webpubsubservice-py, azure-mgmt-apicenter-py, azure-mgmt-apimanagement-py, azure-mgmt-botservice-py, azure-mgmt-fabric-py, azure-monitor-ingestion-py, azure-monitor-opentelemetry-exporter-py, azure-monitor-opentelemetry-py, azure-monitor-query-py, azure-search-documents-py, azure-servicebus-py, azure-speech-to-text-rest-py, azure-storage-blob-py, azure-storage-file-datalake-py, azure-storage-file-share-py, azure-storage-queue-py, fastapi-router-py, m365-agents-py, pydantic-models-py, azure-cosmos-rust, azure-eventhub-rust, azure-identity-rust, azure-keyvault-certificates-rust, azure-keyvault-keys-rust, azure-keyvault-secrets-rust, azure-storage-blob-rust, azure-ai-contentsafety-ts, azure-ai-document-intelligence-ts, azure-ai-projects-ts, azure-ai-translation-ts, azure-ai-voicelive-ts, azure-appconfiguration-ts, azure-cosmos-ts, azure-eventhub-ts, azure-identity-ts, azure-keyvault-keys-ts, azure-keyvault-secrets-ts, azure-microsoft-playwright-testing-ts, azure-monitor-opentelemetry-ts, azure-postgres-ts, azure-search-documents-ts, azure-servicebus-ts, azure-storage-blob-ts, azure-storage-file-share-ts, azure-storage-queue-ts, azure-web-pubsub-ts, frontend-ui-dark-ts, m365-agents-ts, react-flow-node-ts, zustand-store-ts |
| openai | 42 | cloudflare-deploy, develop-web-game, doc, gh-address-comments, gh-fix-ci, imagegen, jupyter-notebook, linear, netlify-deploy, notion-knowledge-capture, notion-meeting-intelligence, notion-research-documentation, notion-spec-to-implementation, openai-docs, pdf, playwright, render-deploy, screenshot, security-best-practices, security-ownership-map, security-threat-model, sentry, sora, speech, spreadsheet, transcribe, vercel-deploy, yeet, aspnet-core, chatgpt-apps, figma, figma-code-connect-components, figma-create-design-system-rules, figma-create-new-file, figma-generate-design, figma-generate-library, figma-implement-design, figma-use, frontend-skill, playwright-interactive, slides, winui-app |
| getsentry | 28 | sentry-sdk-setup, sentry-workflow, sentry-fix-issues, sentry-code-review, sentry-pr-code-review, sentry-create-alert, sentry-feature-setup, sentry-otel-exporter-setup, sentry-setup-ai-monitoring, sentry-sdk-upgrade, sentry-sdk-skill-creator, sentry-android-sdk, sentry-browser-sdk, sentry-cloudflare-sdk, sentry-cocoa-sdk, sentry-dotnet-sdk, sentry-elixir-sdk, sentry-flutter-sdk, sentry-go-sdk, sentry-nestjs-sdk, sentry-nextjs-sdk, sentry-node-sdk, sentry-php-sdk, sentry-python-sdk, sentry-react-native-sdk, sentry-react-sdk, sentry-ruby-sdk, sentry-svelte-sdk |
| garrytan | 27 | office-hours, plan-ceo-review, plan-eng-review, plan-design-review, design-consultation, design-review, review, investigate, qa, qa-only, cso, ship, land-and-deploy, canary, benchmark, document-release, retro, browse, setup-browser-cookies, autoplan, codex, careful, freeze, guard, unfreeze, setup-deploy, gstack-upgrade |
| flutter | 22 | flutter-adding-home-screen-widgets, flutter-animating-apps, flutter-architecting-apps, flutter-building-forms, flutter-building-layouts, flutter-building-plugins, flutter-caching-data, flutter-embedding-native-views, flutter-handling-concurrency, flutter-handling-http-and-json, flutter-implementing-navigation-and-routing, flutter-improving-accessibility, flutter-interoperating-with-native-apis, flutter-localizing-apps, flutter-managing-state, flutter-reducing-app-size, flutter-setting-up-on-linux, flutter-setting-up-on-macos, flutter-setting-up-on-windows, flutter-testing-apps, flutter-theming-apps, flutter-working-with-databases |
| trailofbits | 21 | ask-questions-if-underspecified, audit-context-building, building-secure-contracts, burpsuite-project-parser, claude-in-chrome-troubleshooting, constant-time-analysis, culture-index, differential-review, dwarf-expert, entry-point-analyzer, firebase-apk-scanner, insecure-defaults, modern-python, property-based-testing, semgrep-rule-creator, semgrep-rule-variant-creator, sharp-edges, spec-to-code-compliance, static-analysis, testing-handbook-skills, variant-analysis |
| anthropics | 17 | docx, doc-coauthoring, pptx, xlsx, pdf, algorithmic-art, canvas-design, frontend-design, slack-gif-creator, theme-factory, web-artifacts-builder, mcp-builder, webapp-testing, brand-guidelines, internal-comms, skill-creator, template |
| googleworkspace | 17 | gws-shared, gws-drive, gws-sheets, gws-gmail, gws-calendar, gws-admin-reports, gws-docs, gws-slides, gws-tasks, gws-people, gws-chat, gws-classroom, gws-forms, gws-keep, gws-events, gws-modelarmor, gws-workflow |
| fal-ai-community | 15 | fal-3d, fal-audio, fal-generate, fal-image-edit, fal-kling-o3, fal-lip-sync, fal-platform, fal-realtime, fal-restore, fal-train, fal-tryon, fal-upscale, fal-video-edit, fal-vision, fal-workflow |
| auth0 | 14 | auth0-android, auth0-angular, auth0-aspnetcore-api, auth0-express, auth0-fastify, auth0-fastify-api, auth0-mfa, auth0-migration, auth0-nextjs, auth0-nuxt, auth0-quickstart, auth0-react, auth0-react-native, auth0-vue |
| huggingface | 13 | hf-cli, hugging-face-dataset-viewer, hugging-face-datasets, hugging-face-evaluation, hugging-face-jobs, hugging-face-model-trainer, hugging-face-paper-pages, hugging-face-paper-publisher, hugging-face-tool-builder, hugging-face-trackio, hugging-face-vision-trainer, huggingface-gradio, transformers.js |
| WordPress | 13 | wordpress-router, wp-project-triage, wp-block-development, wp-block-themes, wp-plugin-development, wp-rest-api, wp-interactivity-api, wp-abilities-api, wp-wpcli-and-ops, wp-performance, wp-phpstan, wp-playground, wpds |
| apollographql | 13 | apollo-client, apollo-connectors, apollo-federation, apollo-kotlin, apollo-mcp-server, apollo-router, apollo-router-plugin-creator, apollo-server, graphql-operations, graphql-schema, rover, rust-best-practices, skill-creator |
| netlify | 12 | netlify-functions, netlify-edge-functions, netlify-blobs, netlify-db, netlify-image-cdn, netlify-forms, netlify-frameworks, netlify-caching, netlify-config, netlify-cli-and-deploy, netlify-deploy, netlify-ai-gateway |
| firebase | 12 | developing-genkit-dart, developing-genkit-go, developing-genkit-js, firebase-ai-logic-basics, firebase-app-hosting-basics, firebase-auth-basics, firebase-basics, firebase-data-connect-basics, firebase-firestore-enterprise-native-mode, firebase-firestore-standard, firebase-hosting-basics, firebase-security-rules-auditor |
| hashicorp | 11 | azure-verified-modules, new-terraform-provider, provider-resources, provider-test-patterns, provider-actions, run-acceptance-tests, refactor-module, terraform-search-import, terraform-style-guide, terraform-stacks, terraform-test |
| expo | 11 | building-native-ui, expo-api-routes, expo-cicd-workflows, expo-deployment, expo-dev-client, expo-tailwind-setup, expo-ui-jetpack-compose, expo-ui-swift-ui, native-data-fetching, upgrading-expo, use-dom |
| brave | 11 | answers, bx, images-search, llm-context, local-descriptions, local-pois, news-search, spellcheck, suggest, videos-search, web-search |
| MiniMax-AI | 11 | cli, frontend-dev, fullstack-dev, android-native-dev, ios-application-dev, shader-dev, gif-sticker-maker, minimax-pdf, pptx-generator, minimax-xlsx, minimax-docx |
| coinbase | 9 | authenticate-wallet, fund, monetize-service, pay-for-service, query-onchain-data, search-for-service, send-usdc, trade, x402 |
| cloudflare | 8 | agents-sdk, cloudflare, cloudflare-email-service, durable-objects, sandbox-sdk, web-perf, workers-best-practices, wrangler |
| datadog-labs | 8 | dd-apm, dd-docs, dd-llmo-eval-bootstrap, dd-llmo-eval-trace-rca, dd-llmo-experiment-analyzer, dd-logs, dd-monitors, dd-pup |
| greensock | 8 | gsap-core, gsap-timeline, gsap-scrolltrigger, gsap-plugins, gsap-utils, gsap-react, gsap-performance, gsap-frameworks |
| makenotion | 8 | knowledge-capture, meeting-intelligence, research-documentation, spec-to-implementation, knowledge-capture, meeting-intelligence, research-documentation, spec-to-implementation |
| better-auth | 7 | best-practices, explain-error, providers, create-auth, emailAndPassword, organization, twoFactor |
| figma | 7 | figma-code-connect-components, figma-create-design-system-rules, figma-create-new-file, figma-generate-design, figma-generate-library, figma-implement-design, figma-use |
| binance | 7 | crypto-market-rank, meme-rush, query-address-info, query-token-audit, query-token-info, trading-signal, spot |
| browserbase | 7 | browser, browserbase-cli, cookie-sync, fetch, functions, search, ui-test |
| mongodb | 7 | mongodb-mcp-setup, mongodb-connection, mongodb-schema-design, atlas-stream-processing, mongodb-natural-language-querying, mongodb-query-optimizer, mongodb-search-and-ai |
| clickhouse | 6 | clickhouse-best-practices, chdb-datastore, chdb-sql, clickhouse-architecture-advisor, clickhousectl-cloud-deploy, clickhousectl-local-dev |
| google-labs-code | 6 | design-md, enhance-prompt, react-components, remotion, shadcn-ui, stitch-loop |
| duckdb | 6 | attach-db, query, read-file, duckdb-docs, read-memories, install-duckdb |
| addyosmani | 6 | web-quality-audit, performance, core-web-vitals, accessibility, seo, best-practices |
| firecrawl | 5 | firecrawl-build, firecrawl-build-interact, firecrawl-build-onboarding, firecrawl-build-scrape, firecrawl-build-search |
| voltagent | 4 | create-voltagent, voltagent-best-practices, voltagent-core-reference, voltagent-docs-bundle |
| google-gemini | 4 | gemini-api-dev, vertex-ai-api-dev, gemini-live-api-dev, gemini-interactions-api |
| tinybirdco | 4 | tinybird-best-practices, tinybird-cli-guidelines, tinybird-python-sdk-guidelines, tinybird-typescript-sdk-guidelines |
| sanity-io | 4 | sanity-best-practices, content-modeling-best-practices, seo-aeo-best-practices, content-experimentation-best-practices |
| callstackincubator | 3 | react-native-best-practices, github, upgrading-react-native |
| neondatabase | 3 | neon-postgres, claimable-postgres, neon-postgres-egress-optimizer |
| vercel-labs | 3 | next-best-practices, next-cache-components, next-upgrade |
| stripe | 2 | stripe-best-practices, upgrade-stripe |
| coderabbitai | 2 | autofix, code-review |
| composiohq | 1 | composio |
| supabase | 1 | postgres-best-practices |
| remotion-dev | 1 | remotion |
| replicate | 1 | replicate |
| typefully | 1 | typefully |

---
晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 2026-08-29
