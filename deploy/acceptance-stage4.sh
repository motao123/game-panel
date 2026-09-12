#!/bin/bash
# 验收第 4 批：config-apply 真回滚（port=777 特权端口） / SSE 断线续传 / 登录限速 / 登出会话失效
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
cfg_json() {
  python3 -c '
import json,sys
c = json.load(sys.stdin)["content"]
mode = sys.argv[1]
if mode == "bad":
    # terraria 快速崩溃向量：世界文件不存在 + 关闭自动创建（启动约 4 秒即失败，落在 15s 健康检查窗口内）
    c = c.replace("world=/opt/terraria/world/world.wld", "world=/opt/terraria/world/no-such.wld")
    c = c.replace("autocreate=3", "autocreate=0")
elif mode == "restore":
    c = c.replace("world=/opt/terraria/world/no-such.wld", "world=/opt/terraria/world/world.wld")
    c = c.replace("autocreate=0", "autocreate=3")
print(json.dumps({"content": c}))
' "$1"
}

echo "=== [API-7c] config-apply 真回滚：world 缺失+autocreate=0（服务 4 秒内启动失败 → 自动回滚） ==="
req PUT /api/games/terraria/config "$(req GET /api/games/terraria/config | cfg_json bad)" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin)["result"]; print("status:", d["status"]); print("problemConfigPath:", d["problemConfigPath"]); print("output tail:", d["output"][-300:].replace(chr(10)," | "))'
echo "配置文件 world 行: $(grep '^world=' /opt/terraria/serverconfig.txt)"
echo "服务状态: $(systemctl is-active terraria-server)"

echo "=== [API-7d] 把端口改回 7777（applied） ==="
req PUT /api/games/terraria/config "$(req GET /api/games/terraria/config | cfg_json restore)" \
  | python3 -c 'import json,sys; print("status:", json.load(sys.stdin)["result"]["status"])'

echo "=== [SEC-2] SSE 会话失效（securityStamp）：登出后旧连接 5 秒内被关闭 ==="
timeout 10 curl -s -N -b "$JAR" "$BASE/api/games/terraria/logs/stream?lines=1" > /tmp/sse2.txt 2>&1 &
SSE_PID=$!
sleep 3
curl -s -X POST -b "$JAR" -H "X-CSRF-TOKEN: $(csrf)" "$BASE/api/auth/logout" -o /dev/null
wait $SSE_PID
echo "SSE 尾部事件:"; tail -4 /tmp/sse2.txt
echo "（重新登录恢复会话）"
curl -s -c "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"'"$PANEL_PASS"'"}' "$BASE/api/auth/login" -o /dev/null
echo "me: $(req GET /api/auth/me)"

echo "=== [API-9b] SSE 断线续传：记 cursor → 制造日志 → 带 cursor 重连（应拿到中间日志，无重复） ==="
timeout 4 curl -s -N -b "$JAR" "$BASE/api/games/terraria/logs/stream?lines=1" > /tmp/sse3a.txt 2>&1 || true
CUR=$(grep -A1 -m1 'event: cursor' /tmp/sse3a.txt | tail -1 | python3 -c 'import json,sys; print(json.load(sys.stdin)["cursor"])' 2>/dev/null || true)
echo "cursor=${CUR:0:40}..."
systemctl restart terraria-server   # 制造新日志
sleep 2
timeout 4 curl -s -N -b "$JAR" "$BASE/api/games/terraria/logs/stream?cursor=$CUR" > /tmp/sse3b.txt 2>&1 || true
echo "重连后 hello: $(grep -m1 'resuming' /tmp/sse3b.txt)"
echo "重连后拿到行数: $(grep -c 'event: line' /tmp/sse3b.txt)"
grep -m2 'event: line' /tmp/sse3b.txt
echo "=== [SEC-1] 登录限速：11 次错误密码（期望第 11 次 429） ==="
for i in $(seq 1 11); do
  c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"wrong-pass-xxxx"}' "$BASE/api/auth/login")
  printf '%s ' "$c"
done
echo


echo "STAGE4-DONE"
