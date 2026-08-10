# 飞虹 Code (fhcode) 容器化部署
# 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
FROM node:18-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:18-alpine AS runner
# 多子代理并行(--parallel)依赖 git worktree 隔离，需安装 git
RUN apk add --no-cache git
WORKDIR /app
ENV NODE_ENV=production
ENV FH_HOME=/data/feihong-code
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
VOLUME ["/data/feihong-code"]
ENTRYPOINT ["node", "dist/cli/index.js"]
CMD ["--help"]
