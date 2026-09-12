#!/bin/bash
# 验收第 6 批：config-apply rolled_back（借助临时 ExecStartPre=/bin/false drop-in 使 restart 立即失败）
# 说明：gsc_config_apply 的 15s 健康检查语义是“重启后连续 15 次检查均非 active 才回滚”；
# terraria 为 Type=simple 且 1 秒内即进入 active，无法在真实游戏内触发该路径，
# 故用 drop-in 模拟“重启即失败”的服务，验证面板 → manager → 回滚 的完整链路。
set -u
BASE="${BASE:-http://127.0.0.1:3000}"
JAR=/tmp/gp.cookies
DROPIN=/etc/systemd/system/terraria-server.service.d/zz-panel-test-failstart.conf
csrf() { awk '$6=="panel_csrf" {print $7}' "$JAR" | tail -1; }
req() {
  local m="$1" p="$2" b="${3:-}"
  if [[ -n "$b" ]]; then
    curl -s --max-time 200 -X "$m" -b "$JAR" -H "X-CSRF-TOKEN: $(csrf)" -H 'Content-Type: application/json' -d "$b" "$BASE$p"
  else
    curl -s --max-time 200 -X "$m" -b "$JAR" -H "X-CSRF-TOKEN: $(csrf)" "$BASE$p"
  fi
}
cfg_json() {
  python3 -c '
import json,sys
c = json.load(sys.stdin)["content"]
mode = sys.argv[1]
if mode == "bad":
    c = c.replace("motd=Welcome to Terraria Server!", "motd=BAD-CHANGE-SHOULD-ROLLBACK")
print(json.dumps({"content": c}))
' "$1"
}

cleanup() {
  rm -f "$DROPIN"
  rmdir /etc/systemd/system/terraria-server.service.d 2>/dev/null || true
  systemctl daemon-reload
  systemctl reset-failed terraria-server 2>/dev/null || true
  systemctl restart terraria-server 2>/dev/null || true
}
trap cleanup EXIT

echo "（临时 drop-in: ExecStartPre=/bin/false → systemctl restart 立即失败）"
mkdir -p /etc/systemd/system/terraria-server.service.d
printf '[Service]\nExecStartPre=/bin/false\n' > "$DROPIN"
systemctl daemon-reload

echo "=== [API-7e] config-apply 回滚路径：重启即失败 → 期望 rolled_back + 问题配置路径 ==="
req PUT /api/games/terraria/config "$(req GET /api/games/terraria/config | cfg_json bad)" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin)["result"]; print("status:", d["status"]); print("problemConfigPath:", d["problemConfigPath"]); print("output tail:", d["output"][-320:].replace(chr(10)," | "))'
echo "配置文件 motd 行（应已回滚为 Welcome）: $(grep '^motd=' /opt/terraria/serverconfig.txt)"
echo "审计日志: $(tail -3 /var/log/game-server-scripts/audit.log | grep -o '\"action\":\"[a-z_]*\"' | tr '\n' ' ')"
echo "STAGE6-DONE"
