# 飞虹 Code (fhcode) — 稳定部署镜像
# 多阶段构建：构建阶段编译 TS -> dist，运行阶段仅携带生产依赖。
# 注意：本项目用 src/web/express.d.ts 提供本地 Express 类型声明，
# 不依赖 @types/express，因此构建是密封（hermetic）且可复现的。

# ---------- 构建阶段 ----------
FROM node:20-slim AS build
WORKDIR /app

# 先拷贝清单并安装全部依赖（含 devDependencies：typescript/tsx）
COPY package.json package-lock.json* ./
RUN npm install

# 再拷贝源码并构建（tsc 编译 + 复制 Web 静态资源，不依赖 scripts/copy-web.cjs）
COPY . .
RUN npx tsc && node -e "const {cpSync,mkdirSync,existsSync}=require('fs'),{join}=require('path');const s=join(process.cwd(),'src','web','public'),d=join(process.cwd(),'dist','web','public');if(existsSync(s)){mkdirSync(d,{recursive:true});cpSync(s,d,{recursive:true});console.log('[copy-web] done')}"

# ---------- 运行阶段 ----------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    FH_HOME=/data/fhcode \
    FH_WEB_PORT=8080

# 仅安装生产依赖（express / zod）
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# 拷贝构建产物与必要元数据
COPY --from=build /app/dist ./dist
COPY --from=build /app/README.md ./README.md
COPY --from=build /app/LICENSE ./LICENSE

# FH_HOME 持久化：会话 / 审计链 / 租户数据
VOLUME ["/data/fhcode"]

EXPOSE 8080

# 默认以 Web 控制台模式启动（企业运维入口）
# 如需纯 CLI，可覆盖：docker run ... node dist/cli/index.js --help
ENTRYPOINT ["node", "dist/cli/index.js"]
CMD ["serve", "--port", "8080"]
