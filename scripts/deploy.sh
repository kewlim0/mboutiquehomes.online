#!/usr/bin/env bash
# One-command update of the live site:   npm run deploy
#
#   1) connects to the VPS (you type the VPS password ONCE; the connection is reused for every step)
#   2) uploads the code with rsync
#   3) installs dependencies and restarts the app with pm2
#   4) checks the public site from your computer
#
# It never uploads or overwrites: .env (live DB password + admin login), .mysql/ (local database),
# .db-*.json (saved connection details), node_modules/, or uploads/ (images uploaded on the live admin).
# The live database is not touched.
set -euo pipefail

HOST="${DEPLOY_HOST:-root@216.219.95.253}"
DIR="${DEPLOY_DIR:-/var/www/mboutiquehomes}"
URL="${DEPLOY_URL:-https://mboutiquehomes.online}"
APP="${DEPLOY_APP:-boutique}"

cd "$(dirname "$0")/.."

EXCLUDES=(
  --exclude node_modules
  --exclude .env
  --exclude '.env.*'
  --exclude .mysql
  --exclude '.db-*.json'
  --exclude 'uploads/*'
  --exclude .git
  --exclude .DS_Store
)
# keep the example env file in sync
EXCLUDES+=(--include .env.example)

# --dry-run-local DIR : only show what would be uploaded, into a local folder (used for testing the excludes)
if [ "${1:-}" = "--dry-run-local" ]; then
  mkdir -p "$2"
  rsync -a -n -i --include .env.example "${EXCLUDES[@]}" ./ "$2/"
  exit 0
fi

SOCK="/tmp/m-boutique-deploy-$$.sock"
SSH_OPTS=(-o ControlMaster=auto -o "ControlPath=$SOCK" -o ControlPersist=300)
cleanup() { ssh "${SSH_OPTS[@]}" -O exit "$HOST" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "1/4  连接服务器 $HOST （如提示，请输入 VPS 密码，只需要输一次）"
ssh "${SSH_OPTS[@]}" "$HOST" "echo '     已连接：' \$(hostname)"

echo
echo "2/4  上传代码到 $DIR"
ssh "${SSH_OPTS[@]}" "$HOST" "mkdir -p '$DIR/uploads'"
rsync -az -i --include .env.example "${EXCLUDES[@]}" -e "ssh ${SSH_OPTS[*]}" ./ "$HOST:$DIR/" | sed 's/^/     /'

echo
echo "3/4  安装依赖并重启网站"
ssh "${SSH_OPTS[@]}" "$HOST" "set -e; cd '$DIR'; rm -f public/admin/admin.js; npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -3; \
  echo '     服务器上残留的旧「恢复默认」接口数量（应为 0）：' \$(grep -c \"admin.post('/reset'\" server/server.js || true); \
  pm2 restart '$APP' >/dev/null; sleep 2; pm2 status '$APP' | cat"

echo
echo "4/4  从公网检查 $URL"
fail=0
check() { # description, command that must succeed
  if eval "$2" >/dev/null 2>&1; then echo "     ✓ $1"; else echo "     ✗ $1"; fail=1; fi
}
check "首页能打开 (/ 会跳到 /EN，英文版 200)"  "[ \"\$(curl -s -L -o /dev/null -w '%{http_code}' --max-time 20 '$URL/')\" = 200 ]"
check "房源接口返回数据"                     "curl -s --max-time 20 '$URL/api/content' | grep -c '\"properties\"'"
check "后台登录页是 6 位数字密码版"           "curl -s --max-time 20 '$URL/admin/login.js' | grep -c passcode"
check "面板对未登录访客不可见 (跳转到登录页)"   "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 '$URL/admin/dashboard')\" = 302 ]"
check "面板脚本不对外公开 (未登录 401)"         "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 '$URL/admin/app/admin.js')\" = 401 ]"
check "旧的公开 admin.js 已删除 (404)"           "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 '$URL/admin/admin.js')\" = 404 ]"
check "弹窗动画代码已更新 (hideModal)"          "curl -s --max-time 20 '$URL/script.js' | grep -c hideModal"
check "数据库状态页对未登录访客不可见 (/db 跳转)" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 '$URL/db')\" = 302 ]"
check "数据库状态接口未登录 401"                 "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 '$URL/api/admin/db-status')\" = 401 ]"
check "Tracker 总览页对未登录访客不可见 (/tracker/ 跳转)" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 '$URL/tracker/')\" = 302 ]"
check "SIM 页对未登录访客不可见 (/tracker/sim/ 跳转)" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 '$URL/tracker/sim/')\" = 302 ]"
check "配置文件没有暴露 (/.env = 404)"        "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 '$URL/.env')\" = 404 ]"

echo
if [ "$fail" = 0 ]; then echo "✅ 更新完成，一切正常：$URL"; else echo "⚠ 有检查没通过，请把上面的输出发给我。"; exit 1; fi

# Admin accounts now live in the database. On the first start after this update the server moves the passcode that is
# already in the live .env into the new `admins` table as the OWNER, so the current 6-digit code keeps working.
echo
echo "🔑 后台现在支持多个管理员。你现在的 6 位密码会自动变成「所有者」账号，不用重设。"
echo "   登录后到后台「管理员」页，可以给同事新增他自己的 6 位密码，也可以随时单独停用。"
