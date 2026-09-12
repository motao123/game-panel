#!/bin/bash
# 面板部署脚本：在目标 Linux 主机上，本仓库构建产物安装为 systemd 服务。
# 用法: sudo bash deploy/install.sh [/path/to/game-server-scripts] [PORT]
set -euo pipefail

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
SCRIPTS_DIR="${1:-/opt/game-server-scripts}"
PANEL_PORT="${2:-3000}"
UNIT_DST=/etc/systemd/system/game-panel.service
ENV_DST=/etc/game-panel.env

[[ $EUID -eq 0 ]] || { echo "请用 root 运行"; exit 1; }
command -v node >/dev/null || { echo "需要 node 18+"; exit 1; }
command -v npm >/dev/null || { echo "需要 npm"; exit 1; }

echo "==> npm install（server + client，仅 npm）"
npm --prefix "$REPO_DIR/server" install --no-audit --no-fund
npm --prefix "$REPO_DIR/client" install --no-audit --no-fund

echo "==> typecheck + build"
npm --prefix "$REPO_DIR/server" run build
npm --prefix "$REPO_DIR/client" run build

echo "==> 安装 systemd 单元"
sed -e "s#/opt/game-panel#$REPO_DIR#g" "$REPO_DIR/deploy/game-panel.service" > "$UNIT_DST"

echo "==> 写入 $ENV_DST（0600）"
mkdir -p /etc /var/lib/game-panel
cat > "$ENV_DST" <<EOF
PORT=${PANEL_PORT}
PANEL_SCRIPTS_DIR=${SCRIPTS_DIR}
PANEL_STATE_DIR=/var/lib/game-panel
EOF
chmod 600 "$ENV_DST"
mkdir -p /var/lib/game-panel && chmod 700 /var/lib/game-panel

systemctl daemon-reload
systemctl enable --now game-panel.service
sleep 1
systemctl --no-pager status game-panel.service | head -8 || true
echo "==> 完成: http://127.0.0.1:${PANEL_PORT}"
