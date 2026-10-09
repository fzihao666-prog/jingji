# Ubuntu 24.04 首次生产部署手册

本手册采用固定的发布链路：**Mac（Colima）构建 `linux/amd64` 镜像 → 阿里云 ACR → Ubuntu ECS 拉取运行 → Nginx 提供 HTTPS**。服务器不克隆代码、不构建镜像，也不访问 Docker Hub；这样可避开国内 Docker Hub 网络不稳定，并让更新和回滚只需切换镜像标签。

> 域名：`jingjity.xin`；公网 IPv4：`182.92.6.195`。
>
> ACR 镜像：`crpi-0mzy172e4og0xh7s.cn-hangzhou.personal.cr.aliyuncs.com/docker_soren/jingji`。
>
> 命令块按身份标注。root 命令不加 `sudo`；日常容器操作使用 `deploy`。命令内以 `#` 开头的是注释。若 macOS zsh 粘贴注释报 `command not found: #`，先执行 `setopt interactivecomments`，或不要复制注释行。

## 0. 上线前检查

1. 在 DNS 服务商添加根域名 `@` 的 `A` 记录，值为 `182.92.6.195`。待解析生效后执行 `dig +short jingjity.xin`，结果应为该 IP。
2. 中国内地阿里云 ECS 对外提供网站前，完成域名实名认证、ICP备案；按当地要求完成公安联网备案。未备案时不要公开上线。
3. 在阿里云安全组中仅放行：TCP 80、443（公网）；TCP 22（仅办公出口 IP / 堡垒机）。**不要放行 8787**。
4. 本地先完成项目检查和提交。SQLite 数据库、上传文件、`.env` 都只保留在服务器，不得提交至 Git 或镜像。

## 1. root：首次初始化系统、账户、Docker 与 Nginx

保持当前 root SSH 会话不断开，执行：

```bash
# 安装安全更新与后续命令需要的基础软件。
apt update && apt upgrade -y
apt install -y ca-certificates curl gnupg ufw nginx snapd

# 创建日常发布账户。已存在时跳过；该账户不设置登录密码。
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos '' deploy

# 创建应用与持久化数据目录。数据库和上传文件会放在 /srv/jingji/data。
install -d -o deploy -g deploy -m 0750 /srv/jingji
install -d -o deploy -g deploy -m 0700 /srv/jingji/data

# 先允许 SSH，再启用防火墙，避免远程会话被误断开。
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status verbose
```

### 1.1 root：为 deploy 配置 SSH 公钥

本机若还没有密钥，在 **Mac 本地终端** 创建一对密钥（私钥保留在本机，设置口令是推荐做法）：

```bash
ssh-keygen -t ed25519 -a 100 -C 'jingji-production-deploy' -f ~/.ssh/id_ed25519
# 查看并复制公钥的一整行；只复制 .pub，绝不复制 id_ed25519 私钥。
cat ~/.ssh/id_ed25519.pub
```

回到仍保持连接的 **服务器 root** 会话，粘贴该公钥的一整行：

```bash
# Ghostty 如无法运行 nano，先执行此命令，仅影响当前 SSH 会话。
export TERM=xterm-256color
install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
nano /home/deploy/.ssh/authorized_keys
# 保存后修正 SSH 要求的权限。
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
```

不要关闭 root 会话；另开一个 **Mac 本地终端** 验证 deploy：

```bash
# -i 指向 Mac 上的私钥路径，不是服务器中的 /home/deploy/.ssh/ 路径。
ssh -i ~/.ssh/id_ed25519 -o PreferredAuthentications=publickey -o PasswordAuthentication=no deploy@182.92.6.195 'id && groups'
```

验证成功后，按组织堡垒机与账号规范处理 root SSH。至少禁止 root 的密码认证；配置前先保留一个已验证可用的 deploy 会话：

```bash
# 服务器 root：先检查配置语法，再重载 SSH，不要重启服务器。
cp -a /etc/ssh/sshd_config /etc/ssh/sshd_config.bak.$(date +%F)
printf '%s\n' 'PermitRootLogin prohibit-password' 'PasswordAuthentication no' > /etc/ssh/sshd_config.d/99-jingji-hardening.conf
sshd -t && systemctl reload ssh
```

### 1.2 root：安装 Docker Engine 与 Compose 插件

Ubuntu 仓库中的 Docker 版本可能较旧，使用 Docker 官方仓库安装 Engine 和 Compose 插件：

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker --version
docker compose version

# 允许 deploy 管理 Docker；随后必须重新登录 deploy，组权限才会生效。
usermod -aG docker deploy
```

本手册的 ECS 只访问 ACR，**不要**在服务器配置 Docker Hub 镜像加速器，也不要让 `compose.yaml` 保留 `build:`。如果曾因旧流程写入了可疑的 `/etc/docker/daemon.json`，先由运维确认内容；不要盲目覆盖其他业务的 Docker 配置。

### 1.3 root：确认 Nginx

```bash
# 本文使用已购买并手动上传的阿里云证书，不安装或运行 Certbot。
nginx -v
```

## 2. deploy：首次在服务器准备运行配置

从 Mac 重新登录，使 Docker 组权限生效：

```bash
ssh -i ~/.ssh/id_ed25519 deploy@182.92.6.195
groups   # 输出中必须包含 docker
docker ps   # 不应出现 /var/run/docker.sock permission denied
```

若没有 `docker` 组，请退出后重新登录；不要执行 `chmod 666 /var/run/docker.sock`。

创建生产环境文件。`.env` 含密钥，权限必须为 600；请按项目的 `.env.example` 填写所有必填项，尤其是生产 JWT 密钥、AI 密钥和数据库路径：

```bash
cd /srv/jingji
nano .env
chmod 600 .env
```

`.env` 至少应包含（其余业务配置按 `.env.example` 补齐）：

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=8787
DATABASE_PATH=/app/data/training-monitor.db
JWT_SECRET=替换为足够长的随机密钥
```

生成随机密钥的示例（将输出复制到 `.env`，不要把输出发送到聊天或提交 Git）：

```bash
openssl rand -base64 48
```

在同一目录创建镜像标签文件。标签必须是已推送到 ACR 的 Git 提交短 SHA，例如 `0c7bd45`：

```bash
printf 'IMAGE_TAG=%s\n' 'replace-with-pushed-git-sha' > .env.compose
chmod 600 .env.compose
```

将仓库中的 `compose.yaml` 上传或复制到 `/srv/jingji/compose.yaml`。它必须只使用 ACR 镜像，关键内容如下；不要添加 `build:`：

```yaml
services:
  app:
    image: crpi-0mzy172e4og0xh7s.cn-hangzhou.personal.cr.aliyuncs.com/docker_soren/jingji:$IMAGE_TAG
    env_file:
      - ./.env
    ports:
      - '127.0.0.1:8787:8787'
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

## 3. Mac：安装 Colima，构建并推送到 ACR

在 **Mac 本地终端**，进入项目目录。以下步骤只需首次执行一次：

```bash
setopt interactivecomments
brew install docker docker-buildx colima
mkdir -p ~/.docker/cli-plugins
ln -sf "$(brew --prefix docker-buildx)/bin/docker-buildx" ~/.docker/cli-plugins/docker-buildx
chmod +x ~/.docker/cli-plugins/docker-buildx
colima start --cpu 4 --memory 8 --disk 60
docker context use colima
docker version
docker buildx version
```

若 `docker buildx version` 仍显示 unknown command，关闭并重新打开终端后重试上述软链接命令。不要使用服务器上的 Docker 来构建。

登录 ACR 并构建推送。密码应使用 ACR 控制台“访问凭证”页面生成/重置的**固定密码或临时密码**，不是阿里云网页登录密码。`Login Succeeded` 后出现本地凭据未加密警告不影响推送：

```bash
cd /Users/firstmac/code/jingji/jingji
docker login --username=soren_1 crpi-0mzy172e4og0xh7s.cn-hangzhou.personal.cr.aliyuncs.com

# 以当前 Git 提交作为不可变镜像标签；未提交代码先提交，确保版本可追踪。
TAG=$(git rev-parse --short HEAD)
IMAGE=crpi-0mzy172e4og0xh7s.cn-hangzhou.personal.cr.aliyuncs.com/docker_soren/jingji

# 强制产出 ECS 所需的 linux/amd64 镜像，并直接推送 ACR。
docker buildx build --platform linux/amd64 --tag "$IMAGE:$TAG" --push .
printf '已推送镜像：%s:%s\n' "$IMAGE" "$TAG"
```

如果 ACR 登录返回 `unauthorized: authentication required`，在 ACR 控制台重新生成访问凭证，确认用户名是 `soren_1`，并确认命名空间 `docker_soren` 中已创建仓库 `jingji`。不要尝试用阿里云账号网页登录密码。

## 4. deploy：从 ACR 拉取并启动

在服务器的 deploy 会话执行。首次需要登录 ACR；后续凭据仍有效时无需重复登录：

```bash
cd /srv/jingji
docker login --username=soren_1 crpi-0mzy172e4og0xh7s.cn-hangzhou.personal.cr.aliyuncs.com

# 填入第 3 节刚刚推送的 TAG；每次发布都要更新这里。
printf 'IMAGE_TAG=%s\n' 'replace-with-pushed-git-sha' > .env.compose
chmod 600 .env.compose

# 显式加载标签文件。不要使用裸 docker compose up -d，避免没有标签或误触发构建。
docker compose --env-file .env.compose pull
docker compose --env-file .env.compose up -d --remove-orphans
docker compose --env-file .env.compose ps
docker compose --env-file .env.compose logs --tail=200 app

# 应用只应在本机回环地址可访问。
curl --fail http://127.0.0.1:8787/ >/dev/null && echo '应用已就绪'
ss -lntp | grep ':8787' || true
```

`ss` 的结果必须是 `127.0.0.1:8787`，不能是 `0.0.0.0:8787` 或 `[::]:8787`。若 `pull` 成功而 `up` 仍试图构建 Node 镜像，说明服务器 `compose.yaml` 仍含 `build:` 或 image 指向错误，先修正文件再重试。

## 5. root：配置 Nginx 与已上传的 HTTPS 证书

本项目使用阿里云个人测试证书，不运行 Certbot。以下配置假定证书已经以 root 权限保存在：`/etc/nginx/ssl/jingjity.xin/jingjity.xin.pem` 与 `/etc/nginx/ssl/jingjity.xin/jingjity.xin.key`。证书中的域名必须覆盖 `jingjity.xin`。

```bash
# HTTP 只负责跳转 HTTPS；不要把应用端口 8787 公开给互联网。
cat > /etc/nginx/sites-available/jingjity.xin <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name jingjity.xin www.jingjity.xin;

    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name jingjity.xin www.jingjity.xin;

    ssl_certificate /etc/nginx/ssl/jingjity.xin/jingjity.xin.pem;
    ssl_certificate_key /etc/nginx/ssl/jingjity.xin/jingjity.xin.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
EOF
ln -sfn /etc/nginx/sites-available/jingjity.xin /etc/nginx/sites-enabled/jingjity.xin
rm -f /etc/nginx/sites-enabled/gdb.jingjity.xin
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

验证公网 HTTPS：

```bash
curl -I https://jingjity.xin/
curl -I http://jingjity.xin/
```

阿里云个人测试证书无法自动续期；到期前在控制台重新申请、下载并替换 `.pem` 和 `.key`，再执行 `nginx -t && systemctl reload nginx`。同一域名由多台服务器提供服务时，必须在每台服务器上分别安装证书及私钥。

## 6. 日常更新与回滚

每次更新都在 Mac 先构建推送，再在服务器切换标签；绝不在 ECS 使用 `docker compose build`。

```bash
# Mac：提交代码、构建并推送。
cd /Users/firstmac/code/jingji/jingji
git status
TAG=$(git rev-parse --short HEAD)
IMAGE=crpi-0mzy172e4og0xh7s.cn-hangzhou.personal.cr.aliyuncs.com/docker_soren/jingji
docker buildx build --platform linux/amd64 --tag "$IMAGE:$TAG" --push .

# ECS deploy：拉取新版本并滚动替换容器。
cd /srv/jingji
printf 'IMAGE_TAG=%s\n' '896c3e6' > .env.compose
chmod 600 .env.compose
docker compose --env-file .env.compose pull
docker compose --env-file .env.compose up -d --remove-orphans
curl --fail http://127.0.0.1:8787/ >/dev/null && echo '更新成功'
```

若启动或健康检查失败，使用上一次已验证的标签回滚：

```bash
cd /srv/jingji
printf 'IMAGE_TAG=%s\n' 'previous-working-tag' > .env.compose
docker compose --env-file .env.compose pull
docker compose --env-file .env.compose up -d --remove-orphans
docker compose --env-file .env.compose logs --tail=200 app
```

## 7. 备份、排障与维护

容器更新不会删除 `./data`，但数据仍需异机备份。以下由 root 设置每日 SQLite 一致性备份（先安装 sqlite3）：

```bash
apt install -y sqlite3
install -d -o deploy -g deploy -m 0700 /srv/jingji/backups
crontab -e
# 加入下面一行：每天 03:15 生成备份；备份目录应再同步到 OSS 或其他异机位置。
15 3 * * * sqlite3 /srv/jingji/data/training-monitor.db ".backup '/srv/jingji/backups/training-monitor-$(date +\%F).db'"
```

常用只读检查（deploy）：

```bash
cd /srv/jingji
docker compose --env-file .env.compose ps
docker compose --env-file .env.compose logs --tail=200 app
docker image ls 'crpi-0mzy172e4og0xh7s.cn-hangzhou.personal.cr.aliyuncs.com/docker_soren/jingji'
curl --fail http://127.0.0.1:8787/ >/dev/null && echo ok
```

常用系统与证书检查（root）：

```bash
nginx -t
systemctl status nginx --no-pager
journalctl -u docker -n 100 --no-pager
openssl x509 -in /etc/nginx/ssl/jingjity.xin/jingjity.xin.pem -noout -subject -dates
ss -lntp | grep -E ':(80|443|8787)\b' || true
```

不要执行 `docker compose down -v`，它可能删除命名卷；本项目的数据虽然使用宿主机挂载，仍应避免无必要的破坏性命令。不要把 `.env`、`.env.compose`、数据库、备份或 ACR 密码提交到仓库。
