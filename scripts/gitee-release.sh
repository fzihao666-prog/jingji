#!/usr/bin/env bash
# 在 Gitee 专用发布主机执行，输入为本次已通过 CI 的完整提交 SHA。
set -euo pipefail
revision="${1:-}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo '错误：需要完整 Git 提交 SHA。' >&2; exit 2; }
: "${IMAGE:?请配置 ACR 镜像地址}"
: "${DEPLOY_HOST:?请配置 ECS 主机}"
: "${DEPLOY_USER:?请配置 SSH 用户}"
: "${REMOTE_DIR:?请配置 ECS 应用目录}"
: "${DEPLOY_SSH_KEY:?请配置 SSH 私钥文件路径}"
export IMAGE DEPLOY_HOST DEPLOY_USER REMOTE_DIR DEPLOY_SSH_KEY
for command in docker git ssh ssh-keygen flock; do
  command -v "$command" >/dev/null || { echo "错误：未安装 $command。" >&2; exit 1; }
done
docker buildx version >/dev/null
[ -f "$DEPLOY_SSH_KEY" ] || { echo '错误：SSH 私钥文件不存在。' >&2; exit 1; }
ssh-keygen -F "$DEPLOY_HOST" >/dev/null || { echo '错误：请先核实并登记 ECS 主机公钥到 known_hosts。' >&2; exit 1; }

# 锁覆盖构建、推送和部署；临时源码目录每次独立，锁存放在固定主机路径。
exec 9>"${GITEE_RELEASE_LOCK_FILE:-$HOME/.jingji-gitee-release.lock}"
flock -n 9 || { echo '错误：已有 Gitee 发布任务执行中。' >&2; exit 1; }
if [ -n "${ACR_USERNAME:-}${ACR_PASSWORD:-}" ]; then
  : "${ACR_USERNAME:?ACR 用户名和密码必须同时提供}"
  : "${ACR_PASSWORD:?ACR 用户名和密码必须同时提供}"
  printf '%s' "$ACR_PASSWORD" | docker login "${IMAGE%%/*}" --username "$ACR_USERNAME" --password-stdin
fi

cd -- "$(dirname "$0")/.."
docker buildx build --platform linux/amd64 --tag "$IMAGE:$revision" --push .
# 源码归档不含 .git；现有 release.sh --tag 需要 Git 根目录，但不会读取提交。
git init -q .
bash scripts/release.sh --tag "$revision"
