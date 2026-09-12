#!/bin/bash
# 验收第 5 批：config-apply 真回滚（借助临时 Restart=no drop-in 让失败不被自动重启掩盖）
# 测试后自动清理 drop-in。
set -u
BASE="${BASE:-http://127.0.0.1:3000}"
JAR=/tmp/gp.cookies
DROPIN=/etc/systemd/system/terraria-server.service.d/zz-panel-test-norestart.conf
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
    c = c.replace("world=/opt/terraria/world/world.wld", "world=/opt/terraria/world/no-such.wld")
    c = c.replace("autocreate=3", "autocreate=0")
elif mode == "restore":
    c = c.replace("world=/opt/terraria/world/no-such.wld", "world=/opt/terraria/world/world.wld")
    c = c.replace("autocreate=0", "autocreate=3")
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

echo "（临时 drop-in: Restart=no，使启动失败不被 auto-restart 掩盖）"
mkdir -p /etc/systemd/system/terraria-server.service.d
printf '[Service]\nRestart=no\n' > "$DROPIN"
systemctl daemon-reload

echo "=== [API-7c] 坏配置（world 缺失 + autocreate=0）→ 期望 rolled_back ==="
req PUT /api/games/terraria/config "$(req GET /api/games/terraria/config | cfg_json bad)" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin)["result"]; print("status:", d["status"]); print("problemConfigPath:", d["problemConfigPath"]); print("output tail:", d["output"][-300:].replace(chr(10)," | "))'
echo "配置文件 world 行（应为原值）: $(grep '^world=' /opt/terraria/serverconfig.txt)"

echo "=== [API-7d] 恢复好配置 → 期望 applied ==="
req PUT /api/games/terraria/config "$(req GET /api/games/terraria/config | cfg_json restore)" \
  | python3 -c 'import json,sys; print("status:", json.load(sys.stdin)["result"]["status"])'
echo "服务状态: $(systemctl is-active terraria-server)"
echo "STAGE5-DONE"
