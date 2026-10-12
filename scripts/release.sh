#!/usr/bin/env bash
# 竞迹生产发布脚本（Mac 本地执行）：构建推送镜像到 ACR，并切换 ECS 上的镜像标签。
# 流程与 docs/deployment-ubuntu-24.md 第 3、4、6 节一致：服务器不克隆代码、不构建镜像。
#
# 用法：
#   scripts/release.sh                 # 构建并推送当前 HEAD 短 SHA，然后部署该标签
#   scripts/release.sh --tag <sha>     # 跳过构建，直接部署/回滚到已推送的标签
#   scripts/release.sh --build-only    # 只构建推送，不部署
#   scripts/release.sh --dry-run       # 只打印将执行的命令，不做任何改动
#   scripts/release.sh --allow-dirty   # 允许工作区有未提交改动时发布（不推荐）
#
# 可用环境变量覆盖默认值：
#   IMAGE（ACR 镜像地址）、DEPLOY_USER、DEPLOY_HOST、DEPLOY_SSH_KEY、REMOTE_DIR
set -euo pipefail

IMAGE="${IMAGE:-crpi-0mzy172e4og0xh7s.cn-hangzhou.personal.cr.aliyuncs.com/docker_soren/jingji}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_HOST="${DEPLOY_HOST:-182.92.6.195}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE_DIR="${REMOTE_DIR:-/srv/jingji}"

TAG=""
BUILD_ONLY=0
DEPLOY_ONLY=0
DRY_RUN=0
ALLOW_DIRTY=0

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --tag)
      [ $# -ge 2 ] || { echo "错误：--tag 需要一个镜像标签参数" >&2; exit 2; }
      TAG="$2"; DEPLOY_ONLY=1; shift 2 ;;
    --build-only)
      BUILD_ONLY=1; shift ;;
    --dry-run)
      DRY_RUN=1; shift ;;
    --allow-dirty)
      ALLOW_DIRTY=1; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "错误：未知参数 $1（用 --help 查看用法）" >&2; exit 2 ;;
  esac
done

if [ "$BUILD_ONLY" -eq 1 ] && [ "$DEPLOY_ONLY" -eq 1 ]; then
  echo "错误：--build-only 与 --tag 不能同时使用" >&2
  exit 2
fi

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

# 远程命令在 deploy 会话执行；dry-run 时只打印。
run_remote() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] ssh %s@%s %s\n' "$DEPLOY_USER" "$DEPLOY_HOST" "$*"
  else
    ssh -i "$DEPLOY_SSH_KEY" "$DEPLOY_USER@$DEPLOY_HOST" "$@"
  fi
}

# ---------- 本地前置检查 ----------
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "错误：当前目录不是 Git 仓库" >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if [ -z "$TAG" ]; then
  if [ -n "$(git status --porcelain)" ] && [ "$ALLOW_DIRTY" -eq 0 ]; then
    echo "错误：工作区有未提交改动，镜像标签必须对应已提交代码。" >&2
    echo "先提交，或确认风险后加 --allow-dirty（此时标签仍取 HEAD，改动不会进入镜像）。" >&2
    git status --short >&2
    exit 1
  fi
  TAG="$(git rev-parse --short HEAD)"
fi

case "$TAG" in
  *[!0-9a-fA-F]*|'')
    echo "错误：镜像标签必须是十六进制 Git 提交短 SHA，收到：$TAG" >&2
    exit 2 ;;
esac

if [ "$DEPLOY_ONLY" -eq 0 ]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "错误：未找到 docker，请先安装 Colima + docker buildx（见部署手册第 3 节）" >&2
    exit 1
  fi
  if ! docker buildx version >/dev/null 2>&1; then
    echo "错误：docker buildx 不可用，检查 ~/.docker/cli-plugins/docker-buildx 软链接" >&2
    exit 1
  fi
  # 提示但不阻断：部署手册要求发布前推送到远端以便追踪版本。
  if [ "$DRY_RUN" -eq 0 ] && [ -n "$(git rev-list --branches --not --remotes -1 2>/dev/null)" ]; then
    echo "提示：本地存在未推送到远端的提交，建议先 git push，保证镜像标签可回溯。"
  fi
fi

echo "镜像标签：$TAG"

# ---------- Mac：构建并推送 ----------
if [ "$DEPLOY_ONLY" -eq 0 ]; then
  echo "== 构建并推送 $IMAGE:${TAG}（linux/amd64）=="
  run docker buildx build --platform linux/amd64 --tag "$IMAGE:$TAG" --push .
  if [ "$BUILD_ONLY" -eq 1 ]; then
    echo "已推送镜像：$IMAGE:${TAG}（--build-only，未部署）"
    exit 0
  fi
fi

# ---------- ECS：切换标签并滚动替换 ----------
echo "== 部署 $IMAGE:$TAG 到 $DEPLOY_USER@$DEPLOY_HOST:$REMOTE_DIR =="
if [ "$DRY_RUN" -eq 0 ] && [ ! -f "$DEPLOY_SSH_KEY" ]; then
  echo "错误：SSH 私钥不存在：$DEPLOY_SSH_KEY（可用 DEPLOY_SSH_KEY 覆盖）" >&2
  exit 1
fi

# 参数作为独立参数传给远程 Bash，不把目录或镜像地址插入脚本正文。
printf -v remote_command 'bash -s -- %q %q %q' "$REMOTE_DIR" "$IMAGE" "$TAG"
if [ "$DRY_RUN" -eq 1 ]; then
  echo '[dry-run] 部署成功且健康检查通过后，保留当前版和上一成功版，清理本仓库其他 SHA 镜像。'
fi
if ! run_remote "$remote_command" <<'REMOTE_RELEASE'
set -euo pipefail
cd -- "$1"
image="$2"
tag="$3"
target="$image:$tag"
history='.release-successful-images'
previous=''
umask 077

# 同一部署目录只允许一个发布进程，覆盖切换、检查和清理全过程。
exec 9>.release.lock
flock -n 9 || { echo '错误：已有发布任务执行中。' >&2; exit 1; }

is_version() {
  [[ "$1" == "$image:"* && "${1#"$image:"}" =~ ^[0-9a-fA-F]+$ ]]
}

# 优先保存发布前已健康的实际容器镜像，不根据 .env.compose 猜测。
if [ -f .env.compose ]; then
  container=$(docker compose --env-file .env.compose ps -aq app)
  if [ -n "$container" ]; then
    health=$(docker container inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container")
    candidate=$(docker container inspect --format '{{.Config.Image}}' "$container")
    if [ "$health" = healthy ] && is_version "$candidate" && [ "$candidate" != "$target" ]; then
      previous="$candidate"
    fi
  fi
fi

# 失败后的重试、回滚或重复发布，沿用此前通过检查的成功版本。
if [ -z "$previous" ] && [ -f "$history" ]; then
  while IFS= read -r candidate; do
    if is_version "$candidate" && [ "$candidate" != "$target" ]; then
      previous="$candidate"
      break
    fi
  done < "$history"
fi

printf 'IMAGE_TAG=%s\n' "$tag" > .env.compose
chmod 600 .env.compose
if ! docker compose --env-file .env.compose pull ||
   ! docker compose --env-file .env.compose up -d --wait --wait-timeout 120 --remove-orphans ||
   ! curl --fail --silent --max-time 15 http://127.0.0.1:8787/ >/dev/null; then
  echo '错误：拉取、启动或健康检查失败；保留全部镜像及成功历史。' >&2
  docker compose --env-file .env.compose logs --tail=200 app || true
  exit 1
fi
docker compose --env-file .env.compose ps

# 仅在新版本通过检查后更新记录；临时文件与目标同目录，原子替换。
temporary=$(mktemp .release-successful-images.XXXXXX)
trap 'rm -f -- "$temporary"' EXIT
printf '%s\n' "$target" > "$temporary"
if [ -n "$previous" ]; then printf '%s\n' "$previous" >> "$temporary"; fi
mv -- "$temporary" "$history"

cleanup_images() {
  if [ -z "$previous" ]; then
    echo '提示：尚无可确认的上一成功版，本次保留旧镜像并跳过清理。'
    return 0
  fi
  current_id=$(docker image inspect --format '{{.Id}}' "$target") || return 1
  previous_id=$(docker image inspect --format '{{.Id}}' "$previous") || return 1
  versions=$(docker image ls --format '{{.Repository}}:{{.Tag}}' "$image") || return 1
  echo "保留镜像：${target}、${previous}"
  while IFS= read -r version; do
    # 只处理精确匹配的仓库及 SHA 标签；不删除其他仓库或命名标签。
    is_version "$version" || continue
    id=$(docker image inspect --format '{{.Id}}' "$version") || return 1
    if [ "$id" = "$current_id" ] || [ "$id" = "$previous_id" ]; then continue; fi
    references=$(docker container ls -aq --filter "ancestor=$id") || return 1
    if [ -n "$references" ]; then
      echo "提示：镜像仍被容器引用，跳过：$version"
    elif ! docker image rm "$version"; then
      echo "提示：未能清理镜像，稍后重试：$version" >&2
    fi
  done <<< "$versions"
}

# 清理失败不影响已经成功的部署；不使用强制删除或全局 prune。
cleanup_images || echo '提示：镜像清理未完成，已保留剩余镜像。' >&2
REMOTE_RELEASE
then
  echo '部署未完成；回滚可执行：scripts/release.sh --tag <上一个可用标签>' >&2
  exit 1
fi

echo "发布成功：$IMAGE:$TAG"
