#!/bin/bash
# 验收第 2 批：发现/备份/计划任务
set -u
BASE="${BASE:-http://127.0.0.1:3000}"
JAR=/tmp/gp.cookies
csrf() { awk '$6=="panel_csrf" {print $7}' "$JAR" | tail -1; }
req() {
  local m="$1" p="$2" b="${3:-}"
  if [[ -n "$b" ]]; then
    curl -s --max-time 20 -X "$m" -b "$JAR" -H "X-CSRF-TOKEN: $(csrf)" -H 'Content-Type: application/json' -d "$b" "$BASE$p"
  else
    curl -s --max-time 20 -X "$m" -b "$JAR" -H "X-CSRF-TOKEN: $(csrf)" "$BASE$p"
  fi
}

echo "=== [API-3] Dashboard 自动发现（systemctl list-units + /etc/<game> + catalog 对照） ==="
req GET /api/games | python3 -c '
import json,sys
for g in json.load(sys.stdin)["games"]:
    line = "%-12s installed=%-5s active=%-9s unit=%-26s mem=%s cpu=%s%% backups=%d" % (
        g["id"], g["installed"], g["active"], g["unit"], g["memoryCurrent"], g["cpuPercent"], g["lastBackup"]["count"])
    print(line)
'

echo "=== [API-5] 备份 backup（任务模型） ==="
T=$(req POST /api/games/terraria/backups '{}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"]["id"])')
echo "task=$T"
for i in $(seq 1 120); do
  st=$(req GET "/api/tasks/$T" | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"]["status"])' 2>/dev/null)
  if [ "$st" = "success" ] || [ "$st" = "failed" ]; then break; fi
  sleep 2
done
echo "backup task => $st"
req GET /api/games/terraria/backups | python3 -c 'import json,sys; d=json.load(sys.stdin); i=d["items"][0] if d["items"] else {}; print("count:", d["count"], "| latest:", i.get("name"), "| size:", i.get("sizeBytes"), "| sha256:", (i.get("sha256") or "")[:16]+"...")'

echo "=== [API-6] 计划任务 add/list/remove ==="
req POST /api/games/terraria/schedule '{"calendar":"*-*-* 04:00:00","command":"say hello-from-panel"}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("created id:", d["id"]); print("items:", [(i["id"], i["calendar"], i["nextElapse"], i["command"]) for i in d["items"]])'
ID=$(req GET /api/games/terraria/schedule | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["items"][0]["id"] if d["items"] else "")')
echo "cmd 文件内容: $(cat /etc/terraria/tasks/$ID.cmd 2>/dev/null) | timer 状态: $(systemctl is-active terraria-server-task-$ID.timer 2>&1)"
req DELETE "/api/games/terraria/schedule/$ID" | python3 -c 'import json,sys; print("after remove:", json.load(sys.stdin)["items"])'
echo "STAGE2-DONE"
