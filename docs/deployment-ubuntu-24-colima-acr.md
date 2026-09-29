# Colima + 阿里云 ACR 部署流程

本流程替代服务器本地构建：本地 Mac 使用 Colima 构建 \`linux/amd64\` 镜像，推送到 ACR；ECS 只拉取 ACR 镜像运行。

固定配置：

- 域名：\`jingjity.xin\`
- ECS：\`182.92.6.195\`
- ACR：\`crpi-0mzy172e4og0xh7s.cn-hangzhou.personal.cr.aliyuncs.com\`
- 镜像：\`crpi-0mzy172e4og0xh7s.cn-hangzhou.personal.cr.aliyuncs.com/docker_soren/mydocker\`

先在 ACR 创建命名空间 \`docker_soren\` 和私有仓库 \`mydocker\`。

## 一、本地 Mac 构建和推送

项目根目录的 Dockerfile：

\`\`\`dockerfile
FROM node:22.23.2-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 8787
CMD ["npm", "run", "start"]
\`\`\`

项目根目录的 \`.dockerignore\`：

\`\`\`gitignore
node_modules
dist
data
.git
.env
*.log
\`\`\`

\`\`\`bash
# 本地 Mac。
brew install docker docker-buildx colima
colima start --cpu 4 --memory 8 --disk 60
docker context use colima

cd /Users/firstmac/code/jingji/jingji
docker login --username=soren_1 crpi-0mzy172e4og0xh7s.cn-hangzhou.personal.cr.aliyuncs.com

# 使用提交号作为镜像版本。
TAG=$(git rev-parse --short HEAD)
IMAGE=crpi-0mzy172e4og0xh7s.cn-hangzhou.personal.cr.aliyuncs.com/docker_soren/mydocker:$TAG
docker buildx build --platform linux/amd64 --tag "$IMAGE" --push .
docker buildx imagetools inspect "$IMAGE"
\`\`\`

## 二、ECS root 安装 Docker 运行环境

\`\`\`bash
apt update && apt install -y ca-certificates curl nginx ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "\$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list >/dev/null
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
usermod -aG docker deploy
install -d -o deploy -g deploy -m 0700 /srv/jingji/data
# 阿里云安全组放行 80/443，22 限定运维 IP；不要开放 8787。
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
\`\`\`

重新登录 deploy：

\`\`\`bash
docker login --username=soren_1 crpi-0mzy172e4og0xh7s.cn-hangzhou.personal.cr.aliyuncs.com
TAG=<镜像tag>
docker pull crpi-0mzy172e4og0xh7s.cn-hangzhou.personal.cr.aliyuncs.com/docker_soren/mydocker:$TAG
mkdir -p /srv/jingji
nano /srv/jingji/.env
\`\`\`

\`.env\`：

\`\`\`dotenv
PORT=8787
HOST=0.0.0.0
DATABASE_PATH=/app/data/training-monitor.db
JWT_SECRET=替换为高熵随机密钥
AI_BASE_URL=https://你的兼容OpenAI接口/v1
AI_API_KEY=仅服务器保存的AI密钥
AI_MODEL=你的模型名
AI_TIMEOUT_MS=180000
\`\`\`

\`\`\`bash
chmod 600 /srv/jingji/.env
printf 'IMAGE_TAG=%s\n' "$TAG" > /srv/jingji/.env.compose
chmod 600 /srv/jingji/.env.compose
nano /srv/jingji/compose.yaml
\`\`\`

\`compose.yaml\`：

\`\`\`yaml
services:
  app:
    image: crpi-0mzy172e4og0xh7s.cn-hangzhou.personal.cr.aliyuncs.com/docker_soren/mydocker:$IMAGE_TAG
    env_file: [./.env]
    ports: ["127.0.0.1:8787:8787"]
    volumes: ["./data:/app/data"]
    restart: unless-stopped
    init: true
\`\`\`

\`\`\`bash
cd /srv/jingji
docker compose --env-file .env.compose config
docker compose --env-file .env.compose pull
docker compose --env-file .env.compose up -d
docker compose --env-file .env.compose ps
curl --fail http://127.0.0.1:8787/ >/dev/null && echo '应用已就绪'
\`\`\`

## 三、更新

本地 Mac 构建并推送新 tag：

\`\`\`bash
cd /Users/firstmac/code/jingji/jingji
git pull --ff-only origin dev
TAG=$(git rev-parse --short HEAD)
IMAGE=crpi-0mzy172e4og0xh7s.cn-hangzhou.personal.cr.aliyuncs.com/docker_soren/mydocker:$TAG
docker buildx build --platform linux/amd64 --tag "$IMAGE" --push .
\`\`\`

ECS deploy 更新：

\`\`\`bash
TAG=<新镜像tag>
printf 'IMAGE_TAG=%s\n' "$TAG" > /srv/jingji/.env.compose
cd /srv/jingji
docker compose --env-file .env.compose pull
docker compose --env-file .env.compose up -d
docker compose --env-file .env.compose ps
\`\`\`

Nginx、Certbot、备份和回滚沿用主部署手册；公网只开放 80/443，不要开放 8787。
