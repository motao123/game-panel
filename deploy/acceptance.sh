#!/bin/bash
# 面板端到端验收脚本（在部署了面板与 game-server-scripts 的 Linux 主机上运行）
# 用法: BASE=http://127.0.0.1:3000 bash deploy/acceptance.sh <stage>
#   stage = init      初始化管理员并保存会话（/tmp/gp.cookies）
#   stage = scan      未认证扫描 + CSRF + 注入用例（自动复用 deploy/security-scan.sh）
#   stage = api       业务链路：catalog→安装 terraria→发现→backup→schedule→config-apply→restore→卸载
set -u
BASE="${BASE:-http://127.0.0.1:3000}"
JAR=/tmp/gp.cookies
PANEL_USER="${PANEL_USER:-admin}"
PANEL_PASS="${PANEL_PASS:-PanelTest#2026}"

csrf() { awk '$6=="panel_csrf" {print $7}' "$JAR" | tail -1; }
req() { # req <method> <path> [json-body]
  local m="$1" p="$2" b="${3:-}"
  if [[ -n "$b" ]]; then
    curl -s -X "$m" -b "$JAR" -H "X-CSRF-TOKEN: $(csrf)" -H 'Content-Type: application/json' -d "$b" "$BASE$p"
  else
    curl -s -X "$m" -b "$JAR" -H "X-CSRF-TOKEN: $(csrf)" "$BASE$p"
  fi
}
task_wait() { # task_wait <taskId> <timeout秒> -> 输出最终状态
  local id="$1" t="${2:-600}" i=0 st
  while (( i < t * 2 )); do
    st=$(req GET "/api/tasks/$id" | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"]["status"])' 2>/dev/null || echo unknown)
    case "$st" in success|failed) echo "$st"; return 0;; esac
    sleep 0.5; i=$((i+1))
  done
  echo timeout
}

STAGE="${1:-all}"

if [[ "$STAGE" == "init" || "$STAGE" == "all" ]]; then
  echo "=== 初始化/登录 ==="
  rm -f "$JAR"
  already=$(curl -s "$BASE/api/auth/status" | python3 -c 'import json,sys; print(str(json.load(sys.stdin)["initialized"]).lower())')
  if [[ "$already" == "false" ]]; then
    curl -s -c "$JAR" -X POST -H 'Content-Type: application/json' \
      -d "{\"username\":\"$PANEL_USER\",\"password\":\"$PANEL_PASS\"}" "$BASE/api/auth/init"
  else
    curl -s -c "$JAR" -X POST -H 'Content-Type: application/json' \
      -d "{\"username\":\"$PANEL_USER\",\"password\":\"$PANEL_PASS\"}" "$BASE/api/auth/login"
  fi
  echo; echo "cookies:"; grep -c . "$JAR"
  echo "me: $(req GET /api/auth/me)"
fi

if [[ "$STAGE" == "scan" || "$STAGE" == "all" ]]; then
  echo "=== 安全扫描（未认证 + CSRF + 注入） ==="
  AUTH="panel_token=$(awk '$6=="panel_token" {print $7}' "$JAR" | tail -1); panel_csrf=$(csrf)" \
    CSRF_TOKEN="$(csrf)" \
    bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/security-scan.sh" "$BASE"
fi

if [[ "$STAGE" == "api" || "$STAGE" == "all" ]]; then
  echo "=== [API-1] 安装目录（数据驱动） ==="
  req GET /api/install/catalog | python3 -c 'import json,sys; d=json.load(sys.stdin); print([e["gameId"] for e in d["entries"]])'

  echo "=== [API-2] 经面板任务安装 terraria（流式任务） ==="
  T=$(req POST /api/install '{"gameId":"terraria","values":{"TS_MEMORY_MAX":"2G"}}' \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["task"]["id"])')
  echo "task=$T"
  st=$(task_wait "$T" 900); echo "install task => $st"
  req GET "/api/tasks/$T" | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"]["output"][-600:])'

  echo "=== [API-3] Dashboard 自动发现 ==="
  req GET /api/games | python3 -c 'import json,sys; [print(g["id"], g["active"], g["unit"], "mem=%s"%(g["memoryCurrent"],)) for g in json.load(sys.stdin)["games"]]'

  echo "=== [API-4] 备份 backup（任务） ==="
  T=$(req POST /api/games/terraria/backups '{}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"]["id"])')
  st=$(task_wait "$T" 300); echo "backup task => $st"
  req GET /api/games/terraria/backups | python3 -c 'import json,sys; d=json.load(sys.stdin); print("count:", d["count"], "latest:", d["items"][0]["name"] if d["items"] else None, "sha256:", (d["items"][0]["sha256"][:16]+"...") if d["items"] and d["items"][0]["sha256"] else None)'

  echo "=== [API-5] 计划任务 add/list/remove ==="
  req POST /api/games/terraria/schedule '{"calendar":"*-*-* 04:00:00","command":"say hello-from-panel"}' \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print("created id:", d["id"]); print("items:", [(i["id"], i["calendar"], i["nextElapse"]) for i in d["items"]])'
  ID=$(req GET /api/games/terraria/schedule | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["items"][0]["id"] if d["items"] else "")')
  req DELETE "/api/games/terraria/schedule/$ID" | python3 -c 'import json,sys; print("after remove:", json.load(sys.stdin)["items"])'

  echo "=== [API-6] config-apply：读取→改→应用（applied） ==="
  req GET /api/games/terraria/config | python3 -c 'import json,sys; d=json.load(sys.stdin); print("path:", d["path"]); print("head:", d["content"][:120].replace(chr(10)," / "))'
  req PUT /api/games/terraria/config "$(req GET /api/games/terraria/config | python3 -c 'import json,sys; c=json.load(sys.stdin)["content"]; c=c.replace("worldname=world","worldname=world",1) if "worldname=world" in c else c; print(json.dumps({"content": c + ("\n# panel-edit-ok\n" if "# panel-edit-ok" not in c else "")}))')" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin)["result"]; print("status:", d["status"])'

  echo "=== [API-7] config-apply 回滚：坏端口导致启动失败 → rolled_back ==="
  req PUT /api/games/terraria/config "$(req GET /api/games/terraria/config | python3 -c 'import json,sys; c=json.load(sys.stdin)["content"]; print(json.dumps({"content": c.replace("port=7777","port=99999")}))')" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin)["result"]; print("status:", d["status"], "| problemConfig:", d["problemConfigPath"])'

  echo "=== [API-8] 恢复 restore latest（任务） ==="
  T=$(req POST /api/games/terraria/backups/restore '{"file":"latest"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"]["id"])')
  st=$(task_wait "$T" 600); echo "restore task => $st"

  echo "=== [API-9] 日志 SSE（采 3 秒） ==="
  timeout 3 curl -s -N -b "$JAR" "$BASE/api/games/terraria/logs/stream?lines=5" | head -6 || true

  echo "=== [API-10] 卸载（确认文本=服务名） ==="
  req GET /api/games/terraria/uninstall/preview | python3 -c 'import json,sys; d=json.load(sys.stdin)["preview"]; print("confirmName:", d["confirmName"], "| dirs:", d["dirs"])'
  T=$(req POST /api/games/terraria/uninstall '{"confirm":"terraria-server"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"]["id"])')
  st=$(task_wait "$T" 300); echo "uninstall task => $st"
  systemctl cat terraria-server 2>&1 | head -1 || true
  echo "=== 审计日志（面板侧） ==="
  req GET '/api/audit?limit=8' | python3 -c 'import json,sys; d=json.load(sys.stdin); print("total:", d["total"]); [print(" ", r["game"], r["action"], r["detail"][:60]) for r in d["rows"]]'
fi
echo "ACCEPTANCE-STAGE-$STAGE-DONE"
