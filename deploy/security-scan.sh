#!/bin/bash
# 面板安全自测脚本：
#   1) 未认证扫描全部受保护路由（期望 401）
#   2) 已认证但缺 CSRF 头的非 GET 请求（期望 403）
#   3) 注入用例：路径穿越 / OnCalendar 换行 / unit 特殊字符 / 超长字段（期望 400/404）
# 用法:
#   bash deploy/security-scan.sh [BASE_URL]                     # 仅未认证扫描
#   AUTH="panel_token=..." CSRF_TOKEN=... bash deploy/security-scan.sh   # 附加认证态用例
set -u
BASE="${1:-http://127.0.0.1:3000}"
AUTH="${AUTH:-}"
CSRF_TOKEN="${CSRF_TOKEN:-}"
PASS=0; FAIL=0

code() { # 不带任何认证（未认证扫描）
  curl -s -o /dev/null -w '%{http_code}' "$@"
}

req_cookie() { # 带 Cookie、不带 CSRF 头（用于 403 用例）
  if [[ -n "$AUTH" ]]; then
    curl -s -o /dev/null -w '%{http_code}' -H "Cookie: $AUTH" "$@"
  else
    curl -s -o /dev/null -w '%{http_code}' "$@"
  fi
}

req_auth() { # 带 Cookie + CSRF 头（用于注入用例）
  if [[ -n "$AUTH" ]]; then
    curl -s -o /dev/null -w '%{http_code}' -H "Cookie: $AUTH" -H "X-CSRF-TOKEN: $CSRF_TOKEN" "$@"
  else
    curl -s -o /dev/null -w '%{http_code}' "$@"
  fi
}

check() { # check <期望> <实际> <描述>
  if [[ "$2" == "$1" ]]; then PASS=$((PASS+1)); echo "ok   - $3 => $2";
  else FAIL=$((FAIL+1)); echo "FAIL - $3 => $2（期望 $1）"; fi
}

echo "=== 1) 未认证扫描（期望全部 401） ==="
for p in \
  /api/games /api/games/terraria /api/games/terraria/backups \
  /api/games/terraria/schedule /api/games/terraria/config \
  /api/games/terraria/uninstall/preview /api/install/catalog /api/install \
  /api/tasks /api/tasks/deadbeef /api/audit \
  /api/games/terraria/logs/stream /api/tasks/deadbeef/stream \
  /api/auth/me /api/auth/logout; do
  if [[ "$p" == */logs/stream || "$p" == */stream ]]; then
    c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$BASE$p")
  else
    c=$(code "$BASE$p")
  fi
  check 401 "$c" "GET  $p"
done
for p in \
  /api/games/terraria/lifecycle /api/games/terraria/backups /api/games/terraria/backups/restore \
  /api/games/terraria/schedule /api/games/terraria/uninstall /api/install \
  /api/games/terraria/update; do
  c=$(code -X POST -H 'Content-Type: application/json' -d '{}' "$BASE$p")
  check 401 "$c" "POST $p"
done
c=$(code -X DELETE "$BASE/api/games/terraria/schedule/123")
check 401 "$c" "DELETE /api/games/terraria/schedule/123"
c=$(code -X PUT -H 'Content-Type: application/json' -d '{}' "$BASE/api/games/terraria/config")
check 401 "$c" "PUT   /api/games/terraria/config"
c=$(code "$BASE/api/health")
check 200 "$c" "GET   /api/health（公开）"

if [[ -n "$AUTH" ]]; then
  echo "=== 2) 已认证但缺 CSRF 头（非 GET，期望 403） ==="
  for p in /api/games/terraria/lifecycle /api/games/terraria/backups /api/install /api/auth/logout; do
    c=$(req_cookie -X POST -H 'Content-Type: application/json' -d '{}' "$BASE$p")
    check 403 "$c" "POST $p"
  done

  echo "=== 3) 注入用例（期望 400/404 拒绝） ==="
  CJ=(-H "Content-Type: application/json")

  # 路径穿越：restore 只接受 latest 或备份目录内文件名
  c=$(req_auth -X POST "${CJ[@]}" -d '{"file":"../../../etc/passwd"}' "$BASE/api/games/terraria/backups/restore")
  check 400 "$c" "restore 路径穿越 ../../../etc/passwd"
  c=$(req_auth -X POST "${CJ[@]}" -d '{"file":"/etc/shadow"}' "$BASE/api/games/terraria/backups/restore")
  check 400 "$c" "restore 绝对路径 /etc/shadow"
  c=$(req_auth -X POST "${CJ[@]}" -d '{"file":"..%2f..%2fetc%2fpasswd.tar.gz"}' "$BASE/api/games/terraria/backups/restore")
  check 400 "$c" "restore 备份名含 .. (百分号编码)"
  # OnCalendar 注入（换行 / 分号）
  c=$(req_auth -X POST "${CJ[@]}" -d '{"calendar":"*-*-* 04:00:00\nOnUnitActiveSec=1s","command":"echo hi"}' "$BASE/api/games/terraria/schedule")
  check 400 "$c" "OnCalendar 含换行"
  c=$(req_auth -X POST "${CJ[@]}" -d '{"calendar":"*-*-* 04:00:00; rm -rf /","command":"echo hi"}' "$BASE/api/games/terraria/schedule")
  check 400 "$c" "OnCalendar 含分号"
  # unit/游戏名特殊字符
  c=$(req_auth "$BASE/api/games/terraria%20;ls/backups")
  check 404 "$c" "game 名含空格分号（未知游戏 404）"
  c=$(req_auth "$BASE/api/games/..%2Fetc%2Fpasswd/backups")
  check 404 "$c" "game 名路径穿越（拒绝）"
  # 任务 ID 非数字
  c=$(req_auth -X DELETE "$BASE/api/games/terraria/schedule/abc%3Brm")
  check 400 "$c" "任务 ID 含注入"
  c=$(req_auth -X DELETE "$BASE/api/games/terraria/schedule/1%20OR%201%3D1")
  check 400 "$c" "任务 ID 含空格注入"
  # 超长字段
  LONG=$(printf 'a%.0s' $(seq 1 5000))
  c=$(req_auth -X POST "${CJ[@]}" -d "{\"calendar\":\"$LONG\",\"command\":\"x\"}" "$BASE/api/games/terraria/schedule")
  check 400 "$c" "OnCalendar 超长字段"
  c=$(req_auth -X POST "${CJ[@]}" -d "{\"username\":\"admin\",\"password\":\"$LONG\"}" "$BASE/api/auth/login")
  check 400 "$c" "登录超长密码字段"
fi

echo ""
echo "安全扫描结果: 通过 $PASS / $((PASS + FAIL))"
[[ $FAIL -eq 0 ]] || exit 1
