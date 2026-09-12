#!/bin/bash
# 验收第 3 批：config-apply（applied + rolled_back）/ restore latest / 日志 SSE
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
cfg_json() { # 从服务器读配置后构造 PUT body（附加/替换后 json.dumps）
  python3 -c '
import json,sys
c = json.load(sys.stdin)["content"]
mode = sys.argv[1]
if mode == "ok":
    if "# panel-edit-ok" not in c:
        c = c + "\n# panel-edit-ok\n"
elif mode == "bad":
    c = c.replace("port=7777", "port=99999")
print(json.dumps({"content": c}))
' "$1"
}

echo "=== [API-7a] config-apply：读 → 追加注释 → 保存（期望 applied） ==="
req GET /api/games/terraria/config | python3 -c 'import json,sys; d=json.load(sys.stdin); print("path:", d["path"]); print("size:", d["sizeBytes"])'
req PUT /api/games/terraria/config "$(req GET /api/games/terraria/config | cfg_json ok)" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin)["result"]; print("status:", d["status"]); print("preChangeBackup:", d["preChangeBackupPath"]); print("output tail:", d["output"][-200:].replace(chr(10)," | "))'
grep -c 'panel-edit-ok' /opt/terraria/serverconfig.txt && echo "配置确实写入"

echo "=== [API-7b] config-apply 回滚：port=99999 启动失败（期望 rolled_back + 问题配置路径） ==="
req PUT /api/games/terraria/config "$(req GET /api/games/terraria/config | cfg_json bad)" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin)["result"]; print("status:", d["status"]); print("problemConfigPath:", d["problemConfigPath"]); print("output tail:", d["output"][-260:].replace(chr(10)," | "))'
grep -c 'port=99999' /opt/terraria/serverconfig.txt || echo "坏端口已回滚（文件中无 99999）"
echo "服务状态: $(systemctl is-active terraria-server)"

echo "=== [API-8] restore latest（任务模型，恢复前自动 pre-restore 备份） ==="
T=$(req POST /api/games/terraria/backups/restore '{"file":"latest"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"]["id"])')
echo "task=$T"
for i in $(seq 1 150); do
  st=$(req GET "/api/tasks/$T" | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"]["status"])' 2>/dev/null)
  if [ "$st" = "success" ] || [ "$st" = "failed" ]; then break; fi
  sleep 2
done
echo "restore task => $st"
req GET "/api/tasks/$T" | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"]["output"][-260:].replace(chr(10)," | "))'

echo "=== [API-9] 日志 SSE（含 cursor 与心跳，采 6 秒） ==="
timeout 6 curl -s -N -b "$JAR" "$BASE/api/games/terraria/logs/stream?lines=3" > /tmp/sse-sample.txt || true
head -8 /tmp/sse-sample.txt; echo "..."; grep -c 'event: cursor' /tmp/sse-sample.txt; grep -m1 'event: cursor' /tmp/sse-sample.txt
echo "--- 断线续传（带 cursor 重连 3 秒） ---"
CUR=$(grep -m1 -A1 'event: cursor' /tmp/sse-sample.txt | tail -1 | python3 -c 'import json,sys; print(json.load(sys.stdin)["cursor"])' 2>/dev/null || true)
if [ -n "$CUR" ]; then
  timeout 3 curl -s -N -b "$JAR" "$BASE/api/games/terraria/logs/stream?cursor=$CUR" | head -4 || true
fi
echo "STAGE3-DONE"
