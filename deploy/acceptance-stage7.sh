#!/bin/bash
# 验收第 7 批：Dashboard 活跃指标 / 生命周期 / 审计 / 卸载（收尾）
set -u
BASE="${BASE:-http://127.0.0.1:3000}"
JAR=/tmp/gp.cookies
csrf() { awk '$6=="panel_csrf" {print $7}' "$JAR" | tail -1; }
req() {
  local m="$1" p="$2" b="${3:-}"
  if [[ -n "$b" ]]; then
    curl -s --max-time 200 -X "$m" -b "$JAR" -H "X-CSRF-TOKEN: $(csrf)" -H 'Content-Type: application/json' -d "$b" "$BASE$p"
  else
    curl -s --max-time 200 -X "$m" -b "$JAR" -H "X-CSRF-TOKEN: $(csrf)" "$BASE$p"
  fi
}
task_wait() {
  local id="$1" t="${2:-300}" i=0 st
  while (( i < t * 2 )); do
    st=$(req GET "/api/tasks/$id" | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"]["status"])' 2>/dev/null || echo unknown)
    case "$st" in success|failed) echo "$st"; return 0;; esac
    sleep 1; i=$((i+1))
  done
  echo timeout
}

echo "=== [API-3b] Dashboard 活跃服务指标（两次采样取 CPU 增量） ==="
req GET /api/games/terraria | python3 -c 'import json,sys; g=json.load(sys.stdin)["game"]; print("active:",g["active"],"| pid:",g["mainPID"],"| mem:",g["memoryCurrent"],"/",g["memoryMax"],"| peak:",g["memoryPeak"])'
sleep 6
req GET /api/games/terraria | python3 -c 'import json,sys; g=json.load(sys.stdin)["game"]; print("6s 后 cpu%%:",g["cpuPercent"],"| mem:",g["memoryCurrent"])'

echo "=== [API-2b] 生命周期 restart（manager 执行） ==="
req POST /api/games/terraria/lifecycle '{"action":"restart"}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("ok:",d["ok"],"| exit:",d["exitCode"],"| output:",d["output"][:80])'
sleep 2
echo "服务状态: $(systemctl is-active terraria-server)"

echo "=== [API-11] 审计页（面板读取 JSONL + 筛选） ==="
req GET '/api/audit?limit=6' | python3 -c 'import json,sys; d=json.load(sys.stdin); print("exists:",d["exists"],"total:",d["total"]); [print(" ",r["time"],r["game"],r["action"],r["detail"][:52]) for r in d["rows"]]'
echo "-- 按 game=terraria&action=config 筛选:"
req GET '/api/audit?game=terraria&action=config&limit=4' | python3 -c 'import json,sys; [print(" ",r["action"],r["detail"][:40]) for r in json.load(sys.stdin)["rows"]]'

echo "=== [API-10] 一键卸载（确认文本=服务名 → 任务执行 --uninstall） ==="
req GET /api/games/terraria/uninstall/preview | python3 -c 'import json,sys; d=json.load(sys.stdin)["preview"]; print("confirmName:",d["confirmName"]); print("units:",d["units"]); print("dirs:",d["dirs"]); print("users:",d["users"])'
echo "-- 错误确认文本（期望 400）:"
req POST /api/games/terraria/uninstall '{"confirm":"wrong-name"}' | head -c 120; echo
T=$(req POST /api/games/terraria/uninstall '{"confirm":"terraria-server"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"]["id"])')
echo "task=$T"
st=$(task_wait "$T" 300); echo "uninstall task => $st"
echo "-- 卸载后核验:"
systemctl cat terraria-server 2>&1 | head -1
ls -d /opt/terraria /etc/terraria 2>&1 | head -2
id terraria 2>&1 | head -1
echo "-- Dashboard 中 terraria 应变为未安装:"
req GET /api/games | python3 -c 'import json,sys; g=[x for x in json.load(sys.stdin)["games"] if x["id"]=="terraria"][0]; print("installed:",g["installed"],"active:",g["active"])'
echo "STAGE7-DONE"
