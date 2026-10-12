# syntax=docker/dockerfile:1
# 构建阶段跑在宿主机原生架构（arm64 Mac 上快 5~10 倍），产物 dist 与架构无关；
# 运行阶段才用目标架构（linux/amd64），安装含 sharp 预编译二进制与 tsx 运行时的完整依赖。
FROM --platform=$BUILDPLATFORM node:22.23.2-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# BuildKit 缓存挂载：npm 下载缓存跨构建复用，lockfile 变更时不必重新下载全部依赖。
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22.23.2-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production
EXPOSE 8787
CMD ["npm", "run", "start"]
