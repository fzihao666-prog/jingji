# Ubuntu 24.04 生产部署手册

本文将“竞迹”部署为：公网用户 -> 阿里云中国内地 ECS 上的 Nginx（HTTPS）-> 本机 Docker 容器中的 Express。应用容器只映射到 `127.0.0.1:8787`，SQLite 数据库、上传照片和 JWT 密钥保存在宿主机目录。该结构适合当前项目的单体架构，也让日后的发布成为可回滚、不会丢数据的固定流程。

> 本文已将正式域名设为 `jingjity.xin`。`deploy`、Git 仓库地址和 ACR 镜像加速地址仍是占位符，必须替换。命令中的密钥只在服务器交互式终端输入或写入本机权限受限文件，绝不能提交到 Git。

## 0. 部署前确认

1. 准备一台有公网 IPv4 的阿里云中国内地 Ubuntu 24.04 ECS、已实名的 `jingjity.xin` 和有 `sudo` 权限的普通用户。
2. **先在阿里云 ICP 备案系统核验 `jingjity.xin` 是否支持备案并完成 ICP 备案。** 中国内地 ECS 在备案成功前不可将该域名对公网提供网站/API 服务；域名实名认证或过户后通常还要等待实名信息入库。上线后 30 日内还须完成公安联网备案。若域名后缀无法备案，只能更换可备案域名，不能靠变更端口规避。
3. 备案完成后，在 DNS 服务商处添加根域名 `@` 的 `A` 记录，使 `jingjity.xin` 指向 ECS 公网 IPv4；使用 `dig +short jingjity.xin` 确认。只有已实际配置 IPv6 连通性时才添加 `AAAA`，错误的 AAAA 记录会使部分用户和证书校验失败。
4. 在 ECS 安全组入方向放行：TCP `80/443` 来源 `0.0.0.0/0`；SSH `22` 仅允许办公网或运维固定 IP。**不要**放行 `8787`。同时确保安全组出方向未拒绝 DNS、HTTPS（软件安装/证书续期）及业务需要的 AI API 出站访问。
5. 先在开发机对待发布提交运行 `npm run check`、`npm run lint` 和相关测试。服务器不应直接承载未验证的临时代码。

当前应用在生产模式下由 `npm run start` 启动；它同时提供 React 静态文件、`/api/*`、`/uploads/*`，数据库默认是 `data/training-monitor.db`。因此不能把 `data/` 当作可随容器删除的临时目录。

## 1. 初始化服务器

以下命令以 `deploy` 用户为例。首次登录后先更新系统、创建部署目录和防火墙规则：

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git nginx ufw
sudo adduser --disabled-password --gecos '' deploy
sudo usermod -aG sudo deploy

sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status verbose

sudo install -d -o deploy -g deploy -m 0750 /srv/jingji
sudo install -d -o deploy -g deploy -m 0700 /srv/jingji/data
```

使用 SSH 公钥登录后，应关闭 root 密码登录；这一步请按组织的堡垒机与账号管理规范完成。确认 `sudo ss -lntp` 中没有应用监听 `0.0.0.0:8787` 或 `[::]:8787`。

## 2. 安装 Docker Engine 与 Compose 插件

使用 Docker 官方 APT 源安装 Docker Engine，而不是 Ubuntu 的旧 `docker.io` 包：

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker deploy
sudo systemctl enable --now docker
```

重新登录 `deploy` 使用户组生效，然后确认：

```bash
docker version
docker compose version
docker run --rm hello-world
```

Docker 官方支持 Ubuntu 24.04，并明确提醒：容器发布端口的规则可能绕过 UFW。本文的 Compose 文件只发布 `127.0.0.1:8787`，因此不会形成公网端口。

### 中国内地网络：使用 ACR 专属镜像加速器

不要配置来源不明的公共 Docker 镜像加速器。登录与该 ECS 同账号（或已授权 RAM 身份）的阿里云 **容器镜像服务 ACR** 控制台，进入“镜像工具 > 镜像加速器”，复制系统为该账号生成的专属地址。将其填入 `/etc/docker/daemon.json`；若该文件已有其他合法配置，合并 JSON 键而不是覆盖：

```json
{
  "registry-mirrors": ["https://<你的阿里云专属加速地址>"]
}
```

```bash
sudo dockerd --validate --config-file=/etc/docker/daemon.json
sudo systemctl restart docker
docker info | sed -n '/Registry Mirrors/,+3p'
```

此项只加速从 Docker Hub 拉取基础镜像（本项目的 `node:22-bookworm-slim`）；它不替代 Git、npm 或 AI 服务的网络连通性。若 `download.docker.com`、Git 仓库或 npm 访问不稳定，优先把经过评审的代码镜像放到阿里云 Codeup/企业 Git，或在 CI 中构建并推送到私有 ACR，然后由 ECS 只从私有 ACR 拉取已签名/已验证的版本；不要临时改用未知软件源或把密钥放入镜像。

## 3. 取得代码并创建服务器私有配置

以专用的只读 deploy key 或受限访问令牌从阿里云 Codeup、企业 Git 或已验证的 Git 远端克隆仓库；不要把个人 SSH 私钥留在服务器。国内生产环境优先使用同地域或稳定可达的代码托管端。下面以 SSH 地址为例：

```bash
sudo -iu deploy
git clone <仓库 SSH 地址> /srv/jingji/app
cd /srv/jingji/app
git switch <稳定分支>
git rev-parse --short HEAD
```

创建只在服务器保留的环境文件 `/srv/jingji/.env`：

```dotenv
PORT=8787
HOST=0.0.0.0
DATABASE_PATH=/app/data/training-monitor.db
JWT_SECRET=替换为至少32字节的高熵随机值
AI_BASE_URL=https://你的兼容OpenAI接口/v1
AI_API_KEY=仅服务器持有的AI密钥
AI_MODEL=你的模型名
AI_TIMEOUT_MS=180000
```

生成 JWT 密钥可在服务器运行 `openssl rand -base64 48`，将输出粘贴到文件，不要把它写入 shell 历史或工单。然后限制读取权限：

```bash
chmod 600 /srv/jingji/.env
```

`HOST=0.0.0.0` 是容器内部必要配置；对外隔离由下一节的 `127.0.0.1:8787:8787` 完成。若没有 AI 功能需求，可以省略所有 `AI_*` 项；不要以空字符串伪造真实密钥。

## 4. 添加容器化文件

在 `/srv/jingji/app/` 新建 `Dockerfile`：

```dockerfile
FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 8787
CMD ["npm", "run", "start"]
```

同时新建 `/srv/jingji/app/.dockerignore`，避免把开发依赖、构建产物、运行数据或意外存在的本地密钥送进镜像构建上下文：

```gitignore
node_modules
dist
data
.git
.env
*.log
```

再新建 `/srv/jingji/compose.yaml`：

```yaml
services:
  app:
    build:
      context: ./app
      dockerfile: Dockerfile
    env_file:
      - ./.env
    ports:
      - "127.0.0.1:8787:8787"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
    init: true
    logging:
      driver: local
      options:
        max-size: "20m"
        max-file: "5"
```

不要把包含域名或密钥的 Compose 文件、`.env` 或宿主机 `data/` 反向提交。建议将可复用的无秘密 `Dockerfile` 与 Compose 模板经代码评审后纳入仓库；当前模板可先在服务器使用，以避免改动用户现有工作区。

首次构建和启动：

```bash
cd /srv/jingji
docker compose config
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:8787/ >/dev/null && echo '应用已就绪'
```

如果失败，先查看 `docker compose logs --tail=200 app`，不要贴出 `.env` 内容。首次启动会创建或迁移 SQLite 数据；确认 `ls -la /srv/jingji/data/` 中出现数据库与 `.jwt-secret`（若没有显式 `JWT_SECRET`）后，再继续下一步。

## 5. 配置 Nginx 反向代理

复制仓库模板并替换域名。首次申请证书时先只放 HTTP 配置，避免引用尚不存在的证书文件。

创建 `/etc/nginx/sites-available/jingji`：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name jingjity.xin;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用并验证：

```bash
sudo ln -s /etc/nginx/sites-available/jingji /etc/nginx/sites-enabled/jingji
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
curl -I http://jingjity.xin/
```

应用已限制只信任本机代理传入的 `X-Forwarded-*` 头；不要将 Nginx 改为跨主机代理，也不要把容器端口改为公网发布。

## 6. 申请并启用 HTTPS 证书

在 DNS 已生效、HTTP 可从公网访问后安装 Certbot。Certbot 官方推荐 Snap 版本：

```bash
sudo apt-get remove -y certbot
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/local/bin/certbot
sudo certbot certonly --nginx -d jingjity.xin
```

选择 `certonly` 而非自动改写 Nginx，配置更可审计。成功后将 Nginx 文件替换为下列版本（证书路径按实际域名保留）：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name jingjity.xin;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name jingjity.xin;

    ssl_certificate /etc/letsencrypt/live/jingjity.xin/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/jingjity.xin/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;

    add_header Strict-Transport-Security "max-age=15552000" always;
    add_header X-Content-Type-Options "nosniff" always;
    client_max_body_size 85m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot renew --dry-run
curl -I https://jingjity.xin/
```

Certbot 会通过 systemd timer 或 cron 自动续期；`renew --dry-run` 是首次上线时必须执行的验证。若使用 CDN、负载均衡或安全策略遮蔽 80 端口，改用 DNS-01 验证，不要临时暴露应用的 8787 端口。

## 7. 首次上线验收

1. 浏览器访问 `https://jingjity.xin`，检查地址栏证书、登录、SPA 刷新和图片访问。
2. 完成一次低风险账号登录与读取操作；有授权测试账号时，验证越权账户仍收到 403。
3. 检查端口：`sudo ss -lntp | grep -E ':(80|443|8787)'`。8787 必须只显示 `127.0.0.1`。
4. 检查容器与 Nginx 日志：`docker compose logs --tail=100 app`、`sudo journalctl -u nginx -n 100 --no-pager`。
5. 微信小程序使用 `https://jingjity.xin` 作为唯一基础地址，并在微信公众平台把该域名配置为 request、uploadFile、downloadFile 合法域名。

## 8. 备份、更新与回滚

### 每日备份

SQLite 的 WAL 模式下，不要简单复制单个 `.db` 文件。使用 SQLite 在线备份命令，同时备份上传目录和 `.env`，并把生成的压缩包加密后异地保存。先安装客户端：

```bash
sudo apt install -y sqlite3
```

创建仅 root 可读的 `/usr/local/sbin/backup-jingji`：

```bash
#!/usr/bin/env bash
set -euo pipefail
backup_dir=/var/backups/jingji
stamp=$(date +%F-%H%M%S)
install -d -m 0700 "$backup_dir/$stamp"
sqlite3 /srv/jingji/data/training-monitor.db ".backup '$backup_dir/$stamp/training-monitor.db'"
cp -a /srv/jingji/data/uploads "$backup_dir/$stamp/uploads"
cp /srv/jingji/.env "$backup_dir/$stamp/env.backup"
tar -C "$backup_dir" -czf "$backup_dir/$stamp.tar.gz" "$stamp"
rm -rf "$backup_dir/$stamp"
find "$backup_dir" -name '*.tar.gz' -mtime +14 -delete
```

设置权限并通过 root 的 crontab 每日执行；异地传输应使用受控的加密备份系统：

```bash
sudo chmod 700 /usr/local/sbin/backup-jingji
sudo crontab -e
# 每日 03:20；请先手动执行一次并验证能解压、能恢复。
20 3 * * * /usr/local/sbin/backup-jingji
```

上面脚本会创建可恢复的备份；首次上线必须实际演练一次恢复到隔离目录。备份中含业务数据和密钥，不可放入公开对象存储。

### 标准更新流程

每次更新保留一个已知可用的 Git 提交号和刚更新前的备份：

```bash
sudo /usr/local/sbin/backup-jingji
sudo -iu deploy
cd /srv/jingji/app
git fetch --prune origin
git switch <稳定分支>
git pull --ff-only origin <稳定分支>
git rev-parse --short HEAD

cd /srv/jingji
docker compose build --pull app
docker compose up -d --no-deps app
docker compose ps
curl --fail http://127.0.0.1:8787/ >/dev/null
```

随后执行第 7 节的关键验收。Compose 的 `restart: unless-stopped` 能在宿主机重启后自动恢复应用；Nginx 由 systemd 管理。更新前可用 `docker compose --dry-run up --build -d` 预览 Compose 将做的变更。

### 回滚

若新版本验收失败，立即回到前一个已验证提交并重建：

```bash
sudo -iu deploy
cd /srv/jingji/app
git log --oneline -5
git switch --detach <上一条已验证提交SHA>
cd /srv/jingji
docker compose build --pull app
docker compose up -d --no-deps app
```

**不要**在不了解数据迁移影响时恢复旧代码后直接覆盖数据库。若本次版本已写入不可向后兼容的新数据，应先停止写入、保留现场、再按经过演练的数据库恢复方案从更新前备份恢复。

## 9. 运维速查

```bash
# 运行状态与最近日志
cd /srv/jingji && docker compose ps
cd /srv/jingji && docker compose logs --tail=200 app

# 重启应用（不删除数据卷）
cd /srv/jingji && docker compose restart app

# 检查 Nginx 配置与证书续期
sudo nginx -t
sudo certbot renew --dry-run

# 检查磁盘容量（数据库、上传与 Docker 镜像都会增长）
df -h /srv /var/lib/docker
docker system df
```

不要使用 `docker compose down -v`、`docker system prune --volumes` 或删除 `/srv/jingji/data`；它们可能永久丢失数据库或上传文件。

## 参考

- [Docker Engine on Ubuntu 官方安装文档](https://docs.docker.com/engine/install/ubuntu/)
- [Docker Compose 官方参考](https://docs.docker.com/reference/cli/docker/compose/)
- [Certbot 的 Nginx/Linux 官方说明](https://certbot.eff.org/instructions?ws=nginx&os=snap)
- 项目现有 [Nginx 配置模板](../deploy/nginx/jingji.conf.example) 与 [架构文档](architecture.md)
