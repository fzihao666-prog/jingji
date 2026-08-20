# 竞迹训练监控平台 - Ubuntu 24.04 部署指南

本文档详细说明如何在 Ubuntu 24.04 LTS 服务器上部署竞迹训练监控平台。

> **本地开发测试**：如需在 Windows 本地测试，请参考 [WINDOWS_LOCAL_DEV.md](./WINDOWS_LOCAL_DEV.md)

---

## 目录

1. [环境要求](#环境要求)
2. [服务器准备](#服务器准备)
3. [代码部署](#代码部署)
4. [环境配置](#环境配置)
5. [构建与启动](#构建与启动)
6. [进程管理（PM2）](#进程管理pm2)
7. [Nginx 反向代理](#nginx-反向代理)
8. [SSL 证书配置](#ssl-证书配置)
9. [防火墙配置](#防火墙配置)
10. [自动启动配置](#自动启动配置)
11. [备份策略](#备份策略)
12. [故障排查](#故障排查)

---

## 环境要求

### 最低配置
- **操作系统**: Ubuntu 24.04 LTS
- **CPU**: 2 核心
- **内存**: 4 GB RAM
- **磁盘**: 20 GB 可用空间
- **网络**: 可访问互联网

### 推荐配置
- **CPU**: 4 核心及以上
- **内存**: 8 GB RAM 及以上
- **磁盘**: 50 GB SSD 及以上

### 软件依赖
- **Node.js 22.x LTS 或更高版本**（必需，项目使用 `node:sqlite` 内置模块）
- npm 10.x 或更高版本
- Git
- Nginx（可选，用于反向代理）
- PM2（可选，用于进程管理）

> ⚠️ **重要提示**：本项目使用了 Node.js 22.x 引入的 `node:sqlite` 实验性内置模块，**必须使用 Node.js 22.x 或更高版本**，20.x 版本将无法运行。

---

## 服务器准备

### 1. 系统更新

```bash
# 登录到服务器
ssh username@your-server-ip

# 更新系统软件包
sudo apt update && sudo apt upgrade -y

# 安装必要工具
sudo apt install -y curl wget git vim ufw build-essential
```

### 2. 安装 Node.js 22.x

```bash
# 添加 NodeSource 仓库
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -

# 安装 Node.js
sudo apt install -y nodejs

# 验证安装
node --version  # 应显示 v22.x.x
npm --version   # 应显示 10.x.x

# 安装 pnpm（可选，但推荐）
npm install -g pnpm
```

### 3. 创建应用用户（推荐）

```bash
# 创建专用用户
sudo useradd -m -s /bin/bash jingji

# 添加到 sudo 组（可选）
sudo usermod -aG sudo jingji

# 设置密码
sudo passwd jingji

# 切换到应用用户
su - jingji
```

---

## 代码部署

### 1. 获取代码

```bash
# 进入用户主目录
cd ~

# 克隆代码仓库（根据实际情况修改）
git clone https://your-repo-url/jingji-training-monitor.git

# 或者上传本地代码（如果使用 SCP）
# scp -r /local/path/to/code jingji@server-ip:/home/jingji/

# 进入项目目录
cd jingji-training-monitor
```

### 2. 安装依赖

```bash
# 安装项目依赖
npm install

# 如果使用 pnpm
# pnpm install
```

### 3. 创建数据目录

> ⚠️ **重要提示**：数据目录路径必须与 `.env` 文件中的 `DATABASE_PATH` 和 `ATHLETE_PHOTO_ROOT` 配置一致！

```bash
# 查看当前 .env 中的路径配置
grep -E "DATABASE_PATH|ATHLETE_PHOTO_ROOT" .env

# 创建数据目录（根据 .env 中的实际路径）
# 如果 .env 中配置的是 /home/jingji/jingji-data：
mkdir -p /home/jingji/jingji-data/uploads/athlete-photos

# 如果 .env 中配置的是 /app/jingji/data：
# mkdir -p /app/jingji/data/uploads/athlete-photos

# 设置权限
chmod 755 /home/jingji/jingji-data
chmod 755 /home/jingji/jingji-data/uploads
chmod 755 /home/jingji/jingji-data/uploads/athlete-photos
```

---

## 环境配置

### 1. 创建环境变量文件

```bash
# 复制示例环境文件
cp .env.example .env

# 编辑环境变量
vim .env
```

### 2. 环境变量配置示例

> ⚠️ **重要提示**：以下路径必须与数据目录实际位置一致！如果使用不同路径，请相应修改。

```env
# ============================================
# 竞迹训练监控平台 - 生产环境配置
# ============================================

# 服务器端口
PORT=8787

# 数据库路径（绝对路径，必须与创建的数据目录一致）
DATABASE_PATH=/home/jingji/jingji-data/training-monitor.db

# JWT 密钥（生产环境必须修改！）
# 生成命令: openssl rand -hex 48
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# 运动员照片存储根目录（绝对路径，必须与创建的数据目录一致）
ATHLETE_PHOTO_ROOT=/home/jingji/jingji-data/uploads/athlete-photos

# AI 服务配置（可选）
AI_API_KEY=your-model-studio-api-key
AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_MODEL=qwen3.7-plus

# 时区设置
TZ=Asia/Shanghai
```

**路径配置说明：**
- 如果代码部署在 `/app/jingji`，建议将数据也放在 `/app/jingji/data` 方便管理
- 如果使用 `/home/jingji/jingji-data`，确保该目录已创建且有写入权限
- `.env` 中的路径必须与 `mkdir` 创建的目录路径完全匹配

### 3. 生成 JWT 密钥

```bash
# 生成安全的 JWT 密钥
openssl rand -hex 48

# 将生成的密钥复制到 .env 文件的 JWT_SECRET 中
```

---

## 构建与启动

### 1. TypeScript 类型检查

```bash
# 运行类型检查
npm run check

# 如果有错误，需要先修复
```

### 2. 构建前端

```bash
# 构建生产版本
npm run build

# 构建输出在 dist/ 目录
ls -la dist/
```

### 3. 启动服务

#### 方式一：开发模式（测试用）

```bash
# 启动开发服务器（前端 + 后端）
npm run dev

# 或分别启动
npm run dev:web   # 仅前端
npm run dev:server # 仅后端
```

#### 方式二：生产模式

```bash
# 直接启动（前台运行，测试用）
npm start

# 服务将在 http://your-server-ip:8787 运行
```

---

## 进程管理（PM2）

### 1. 安装 PM2 和 tsx

```bash
# 全局安装 PM2
sudo npm install -g pm2

# 全局安装 tsx（PM2 需要用到）
sudo npm install -g tsx

# 验证安装
pm2 --version
tsx --version
```

### 2. 创建 PM2 配置文件

> ⚠️ **重要提示**：由于项目 `package.json` 设置了 `"type": "module"`，PM2 配置文件必须使用 `.cjs` 扩展名！

```bash
# 在项目根目录创建配置文件（注意使用 .cjs 扩展名）
vim ecosystem.config.cjs
```

```javascript
module.exports = {
  apps: [
    {
      name: 'jingji-monitor',
      script: './server/index.ts',
      interpreter: 'tsx',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 8787
      },
      // 日志配置
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // 自动重启
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      // 内存限制
      max_memory_restart: '1G',
      // 监控
      watch: false,
      // 启动延迟
      restart_delay: 3000
    }
  ]
};
```

### 3. 创建日志目录

```bash
mkdir -p ~/jingji-training-monitor/logs
```

### 4. 启动应用

```bash
# 使用 PM2 启动（注意使用 .cjs 配置文件）
pm2 start ecosystem.config.cjs

# 查看状态
pm2 status
pm2 logs

# 保存 PM2 配置
pm2 save

# 设置开机自启
pm2 startup systemd

# 运行输出的命令（根据提示）
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u jingji --hp /home/jingji
```

### 5. PM2 常用命令

```bash
# 查看日志
pm2 logs jingji-monitor

# 重启应用
pm2 restart jingji-monitor

# 停止应用
pm2 stop jingji-monitor

# 删除应用
pm2 delete jingji-monitor

# 监控资源使用
pm2 monit
```

---

## Nginx 反向代理

### 1. 安装 Nginx

```bash
sudo apt install -y nginx

# 验证安装
nginx -v
```

### 2. 配置 Nginx

```bash
# 删除默认配置
sudo rm /etc/nginx/sites-enabled/default

# 创建新配置
sudo vim /etc/nginx/sites-available/jingji-monitor
```

```nginx
server {
    listen 80;
    server_name your-domain.com;  # 修改为你的域名或服务器 IP

    # 日志配置
    access_log /var/log/nginx/jingji-access.log;
    error_log /var/log/nginx/jingji-error.log;

    # 客户端文件上传大小限制
    client_max_body_size 10M;

    # 静态文件服务（前端构建产物）
    # ⚠️ 重要：修改路径为你的实际项目路径
    # 例如：/app/jingji/dist 或 /home/jingji/jingji-training-monitor/dist
    location / {
        root /app/jingji/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # API 反向代理
    location /api/ {
        proxy_pass http://localhost:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 上传文件目录
    # ⚠️ 重要：修改路径为你的实际数据目录
    # 例如：/app/jingji/data/uploads/ 或 /home/jingji/jingji-data/uploads/
    location /uploads/ {
        alias /app/jingji/data/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
```

> ⚠️ **路径配置说明**：
> - `root` 指令指向前端构建产物目录（`dist`），必须与 `.env` 中的项目路径一致
> - `alias` 指令指向上传文件存储目录，必须与 `.env` 中的 `ATHLETE_PHOTO_ROOT` 配置一致
> - 如果部署路径不同（如 `/home/jingji/...`），请相应修改上述路径

### 3. 启用配置

```bash
# 创建符号链接
sudo ln -s /etc/nginx/sites-available/jingji-monitor /etc/nginx/sites-enabled/

# 检查配置语法
sudo nginx -t

# 重载 Nginx
sudo systemctl reload nginx
```

### 4. 设置文件权限

```bash
# 确保 Nginx 可以访问静态文件
# ⚠️ 修改路径为你的实际项目路径
sudo chown -R www-data:www-data /app/jingji/dist
sudo chmod -R 755 /app/jingji/dist

# 确保 Nginx 可以访问上传目录
# ⚠️ 修改路径为你的实际数据目录
sudo chown -R www-data:www-data /app/jingji/data/uploads
sudo chmod -R 755 /app/jingji/data/uploads
```
sudo chmod -R 755 ~/jingji-training-monitor/dist

# 确保 Nginx 可以访问上传目录
sudo chown -R www-data:www-data ~/jingji-data/uploads
sudo chmod -R 755 ~/jingji-data/uploads
```

---

## SSL 证书配置

### 方式一：使用 Let's Encrypt（推荐）

```bash
# 安装 Certbot
sudo apt install -y certbot python3-certbot-nginx

# 获取并自动配置证书
sudo certbot --nginx -d your-domain.com

# 按照提示完成配置

# 自动续期测试
sudo certbot renew --dry-run
```

### 方式二：手动配置证书

如果你已经有证书文件（例如从域名服务商下载的 `www.jingjity.xin.pem` 和 `www.jingjity.xin.key`）：

```bash
# 创建 SSL 目录
sudo mkdir -p /etc/nginx/ssl

# 上传证书文件到服务器（在本地执行）
# scp www.jingjity.xin.pem root@your-server-ip:/etc/nginx/ssl/
# scp www.jingjity.xin.key root@your-server-ip:/etc/nginx/ssl/

# 或者直接在服务器上下载/移动证书文件
sudo cp /path/to/your/www.jingjity.xin.pem /etc/nginx/ssl/
sudo cp /path/to/your/www.jingjity.xin.key /etc/nginx/ssl/

# 设置证书文件权限
sudo chmod 644 /etc/nginx/ssl/www.jingjity.xin.pem
sudo chmod 600 /etc/nginx/ssl/www.jingjity.xin.key

# 修改 Nginx 配置启用 HTTPS
sudo vim /etc/nginx/sites-available/jingji-monitor
```

```nginx
server {
    listen 80;
    server_name www.jingjity.xin jingjity.xin;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name www.jingjity.xin jingjity.xin;

    # SSL 证书（使用你的实际证书文件名）
    ssl_certificate /etc/nginx/ssl/www.jingjity.xin.pem;
    ssl_certificate_key /etc/nginx/ssl/www.jingjity.xin.key;

    # SSL 配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # 其余配置与之前相同...
    # ...
}
```

> **注意**：如果你的证书文件后缀不同（如 `.crt` 和 `.key`，或 `.pem` 和 `.key`），请相应修改上面的文件名。确保证书路径和文件名与实际文件匹配。

---

## 防火墙配置

### 1. 配置 UFW 防火墙

```bash
# 查看防火墙状态
sudo ufw status

# 默认拒绝所有传入
sudo ufw default deny incoming
sudo ufw default allow outgoing

# 允许 SSH（防止断开连接）
sudo ufw allow 22/tcp

# 允许 HTTP 和 HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 可选：直接开放应用端口（如果不使用 Nginx）
# sudo ufw allow 8787/tcp

# 启用防火墙
sudo ufw enable

# 确认规则
sudo ufw status verbose
```

### 2. 云服务器安全组配置

如果使用阿里云、腾讯云等云服务器，还需要在安全组中开放：
- 端口 22 (SSH)
- 端口 80 (HTTP)
- 端口 443 (HTTPS)
- 端口 8787（可选，如果直接暴露应用）

---

## 自动启动配置

### 1. 应用服务自动启动（PM2 已完成）

```bash
# 确认 PM2 开机自启已配置
pm2 startup

# 保存当前进程列表
pm2 save
```

### 2. Nginx 自动启动

```bash
# 确保 Nginx 开机自启
sudo systemctl enable nginx

# 启动 Nginx
sudo systemctl start nginx

# 查看状态
sudo systemctl status nginx
```

---

## 备份策略

### 1. 数据库备份脚本

```bash
# 创建备份目录
mkdir -p ~/jingji-backup

# 创建备份脚本
vim ~/backup-jingji.sh
```

```bash
#!/bin/bash

# 配置
DB_PATH="/home/jingji/jingji-data/training-monitor.db"
BACKUP_DIR="/home/jingji/jingji-backup"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="training-monitor_${DATE}.db"
RETENTION_DAYS=30

# 创建备份
cp "$DB_PATH" "$BACKUP_DIR/$BACKUP_FILE"

# 压缩备份
gzip "$BACKUP_DIR/$BACKUP_FILE"

# 删除旧备份（保留30天）
find "$BACKUP_DIR" -name "training-monitor_*.db.gz" -mtime +$RETENTION_DAYS -delete

# 输出日志
echo "[$(date)] Backup completed: ${BACKUP_FILE}.gz"
```

```bash
# 设置脚本权限
chmod +x ~/backup-jingji.sh

# 测试备份
~/backup-jingji.sh
```

### 2. 配置定时任务

```bash
# 编辑 crontab
crontab -e

# 添加每日凌晨 2 点备份
0 2 * * * /home/jingji/backup-jingji.sh >> /home/jingji/jingji-backup/backup.log 2>&1

# 保存退出
```

### 3. 远程备份（可选）

```bash
# 安装 rclone 进行云存储备份
sudo apt install -y rclone

# 配置 rclone
rclone config

# 添加同步命令到备份脚本
# rclone sync /home/jingji/jingji-backup remote:backup-bucket
```

---

## 故障排查

### 1. Node.js 版本错误（ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite）

**错误现象：**
```
Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite
```

**原因：** 项目使用了 Node.js 22.x 引入的 `node:sqlite` 内置模块，当前 Node.js 版本过低。

**解决方案：**
```bash
# 升级到 Node.js 22.x
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 验证版本
node --version  # 应显示 v22.x.x

# 重新安装依赖并启动
cd /app/jingji
rm -rf node_modules package-lock.json
npm install
npm start
```

### 2. 数据目录错误（ENOENT: no such file or directory, mkdir）

**错误现象：**
```
Error: ENOENT: no such file or directory, mkdir '/app/jingji/data'
```

**原因：** `.env` 文件中的路径配置与实际数据目录不匹配，或数据目录未创建。

**解决方案：**
```bash
# 1. 检查 .env 中的路径配置
cat .env | grep -E "DATABASE_PATH|ATHLETE_PHOTO_ROOT"

# 2. 创建对应的数据目录（根据实际配置路径）
# 示例：如果配置是 /app/jingji/data
mkdir -p /app/jingji/data/uploads/athlete-photos

# 3. 设置权限
chmod 755 /app/jingji/data
chmod 755 /app/jingji/data/uploads
chmod 755 /app/jingji/data/uploads/athlete-photos

# 4. 重新启动
npm start
```

**注意：** 如果 `/app/jingji/data` 是一个损坏的符号链接，先删除它：
```bash
rm -f /app/jingji/data
mkdir -p /app/jingji/data/uploads/athlete-photos
```

### 3. PM2 配置文件格式错误（module is not defined in ES module scope）

**错误现象：**
```
ReferenceError: module is not defined in ES module scope
This file is being treated as an ES module because it has a '.js' file extension
```

**原因：** 项目 `package.json` 设置了 `"type": "module"`，PM2 配置文件不能用 `.js` 扩展名。

**解决方案：**
```bash
# 重命名配置文件为 .cjs
mv ecosystem.config.js ecosystem.config.cjs

# 使用 .cjs 文件启动
pm2 start ecosystem.config.cjs
```

### 4. PM2 找不到 tsx 解释器

**错误现象：**
```
Error: Interpreter tsx is NOT AVAILABLE in PATH
```

**原因：** `tsx` 没有全局安装，PM2 找不到它。

**解决方案：**
```bash
# 全局安装 tsx
sudo npm install -g tsx

# 验证安装
which tsx

# 重新启动
pm2 start ecosystem.config.cjs
```

### 5. Nginx 500 Internal Server Error

**错误现象：** 浏览器访问显示 `500 Internal Server Error`

**原因：** Nginx 配置中的路径与实际项目路径不匹配。

**排查步骤：**

```bash
# 1. 检查 Nginx 错误日志
sudo tail -f /var/log/nginx/jingji-error.log

# 2. 检查 Nginx 配置中的路径是否正确
sudo cat /etc/nginx/sites-available/jingji-monitor | grep "root\|alias"

# 3. 确认前端 dist 目录存在
ls -la /app/jingji/dist/  # 修改为你的实际路径

# 4. 检查文件权限
sudo -u www-data ls /app/jingji/dist/  # 修改为你的实际路径
```

**常见解决方案：**

**方案 A：路径不匹配**
```bash
# 编辑 Nginx 配置，修改 root 和 alias 路径为你的实际路径
sudo vim /etc/nginx/sites-available/jingji-monitor

# 例如，如果代码在 /app/jingji，修改为：
# root /app/jingji/dist;
# alias /app/jingji/data/uploads/;

# 测试并重载
sudo nginx -t
sudo systemctl reload nginx
```

**方案 B：dist 目录不存在**
```bash
# 重新构建前端
cd /app/jingji  # 修改为你的实际路径
npm run build

# 确认 dist 目录生成
ls -la dist/
```

**方案 C：权限问题**
```bash
# 设置正确的文件所有者
sudo chown -R www-data:www-data /app/jingji/dist
sudo chmod -R 755 /app/jingji/dist

# 重载 Nginx
sudo systemctl reload nginx
```

### 6. 服务无法启动

```bash
# 检查端口占用
sudo lsof -i :8787
sudo netstat -tulpn | grep 8787

# 检查日志
pm2 logs

# 查看系统日志
sudo journalctl -u pm2-jingji -n 100
```

### 7. 数据库权限问题

```bash
# 检查数据库文件权限
ls -la ~/jingji-data/

# 修复权限
chmod 644 ~/jingji-data/training-monitor.db
```

### 8. Nginx 502 错误

```bash
# 检查后端服务是否运行
pm2 status
curl http://localhost:8787/api/athletes

# 检查 Nginx 错误日志
sudo tail -f /var/log/nginx/jingji-error.log

# 检查 SELinux（如果启用）
sudo getenforce
sudo setenforce 0  # 临时禁用，测试用
```

### 9. 内存不足

```bash
# 查看内存使用
free -h

# 查看进程内存使用
pm2 monit

# 增加 swap 空间
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 永久启用 swap
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 10. 磁盘空间不足

```bash
# 查看磁盘使用
df -h

# 查看大文件
sudo du -sh ~/* | sort -hr | head -10

# 清理日志
pm2 flush
sudo logrotate -f /etc/logrotate.d/nginx
```

---

## 更新部署

### 1. 应用更新流程

```bash
# 进入项目目录
cd ~/jingji-training-monitor

# 拉取最新代码
git pull origin main

# 安装新依赖
npm install

# 构建
npm run build

# 重启服务
pm2 restart jingji-monitor

# 查看状态
pm2 status
```

### 2. 数据库迁移

```bash
# 备份现有数据库
cp ~/jingji-data/training-monitor.db ~/jingji-backup/training-monitor-$(date +%Y%m%d).db

# 重启服务自动执行迁移
pm2 restart jingji-monitor

# 检查日志确认迁移成功
pm2 logs
```

---

## 安全加固

### 1. 禁用 root 登录

```bash
# 编辑 SSH 配置
sudo vim /etc/ssh/sshd_config

# 修改以下配置
PermitRootLogin no
PasswordAuthentication no  # 如果使用密钥登录

# 重启 SSH
sudo systemctl restart sshd
```

### 2. 配置 Fail2Ban

```bash
# 安装
sudo apt install -y fail2ban

# 启动
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

### 3. 定期安全更新

```bash
# 设置自动安全更新
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

## 附录

### 快速命令参考

```bash
# 查看应用状态
pm2 status

# 查看日志
pm2 logs jingji-monitor --lines 100

# 重启应用
pm2 restart jingji-monitor

# 重载 Nginx
sudo nginx -t && sudo systemctl reload nginx

# 查看资源使用
htop

# 数据库备份
~/backup-jingji.sh
```

### 目录结构

示例（以 `/app/jingji` 为部署路径）：

```
/app/jingji/                    # 应用代码目录
├── dist/                       # 前端构建产物
├── server/                     # 后端代码
├── src/                        # 前端源码
├── shared/                     # 共享代码
├── logs/                       # 应用日志
├── data/                       # 数据目录（与 .env 配置一致）
│   ├── training-monitor.db     # SQLite 数据库
│   └── uploads/                # 上传文件
│       └── athlete-photos/     # 运动员照片
├── ecosystem.config.cjs        # PM2 配置（注意是 .cjs 不是 .js）
└── .env                        # 环境变量
```

> **注意**：实际路径取决于你的部署位置，确保 Nginx 配置中的路径与此一致。
│   └── uploads/                # 上传文件
│       └── athlete-photos/     # 运动员照片
└── jingji-backup/              # 备份目录
```

### 环境变量完整列表

| 变量名 | 说明 | 默认值 | 必需 |
|--------|------|--------|------|
| PORT | 服务器端口 | 8787 | 否 |
| DATABASE_PATH | 数据库文件路径 | data/training-monitor.db | 否 |
| JWT_SECRET | JWT 签名密钥 | 自动生成 | 是 |
| ATHLETE_PHOTO_ROOT | 照片存储目录 | data/uploads/athlete-photos | 否 |
| AI_API_KEY | AI 服务 API 密钥 | - | 否 |
| AI_BASE_URL | AI 服务基础 URL | - | 否 |
| AI_MODEL | AI 模型名称 | - | 否 |
| TZ | 时区 | Asia/Shanghai | 否 |

---

## 总结

完成以上步骤后，竞迹训练监控平台应该已在 Ubuntu 24.04 服务器上成功部署并运行。

**访问地址：**
- HTTP: http://your-server-ip 或 http://your-domain.com
- HTTPS: https://your-domain.com（配置 SSL 后）

**默认登录凭据：**
- 用户名：参考项目文档或数据库种子数据
- 密码：参考项目文档

**生产环境检查清单：**
- [ ] 修改 JWT_SECRET 为强密钥
- [ ] 配置 SSL 证书
- [ ] 启用防火墙
- [ ] 设置自动备份
- [ ] 配置监控告警
- [ ] 修改默认管理员密码
- [ ] 禁用 root SSH 登录

如有问题，请查看日志文件或联系技术支持。
