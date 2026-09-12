# Game Panel — game-server-scripts 可视化驾驶舱

单机可视化 Web 面板，为 [game-server-scripts](../game-server-scripts)（bash 一键部署脚本，systemd 管理）提供"驾驶舱"。

> **核心设计约束**：面板不重新实现任何安装/备份/恢复/计划任务/卸载逻辑。
> 一切变更操作都必须经由现有 `*-manager` 命令与安装脚本完成；面板只做表单 → 白名单环境变量 / 固定参数 → 子进程 → 流式回显。

---

## 功能总览

| 模块 | 说明 | 底层入口（唯一真源） |
|------|------|----------------------|
| 登录/初始化 | 单管理员 + bcrypt；首次访问引导设置密码，初始化后注册接口永久 403 | 面板自有状态（JSON 0600） |
| Dashboard | 自动发现已安装游戏、运行状态/CPU/内存（/proc + systemctl show）/端口/最近备份，前端 5 秒轮询 | `systemctl list-units/show`、`/proc/<pid>`、备份目录扫描 |
| 生命周期 | start / stop / restart / update，结果回显 | `<game>-manager start\|stop\|restart`、`<game>-manager update` |
| 日志 | journalctl 实时流（SSE），断线游标续传、心跳、unit 白名单 | `journalctl -u <unit>`（--show-cursor / --after-cursor） |
| 备份管理 | 列表（名/时间/大小/sha256）、一键备份、restore latest/指定文件 | `<game>-manager backup`、`<game>-manager restore <latest\|绝对路径>` |
| 安装向导 | 表单 → 白名单环境变量 → 后台任务流式回显；4 个专用脚本 + steam catalog 数据驱动 | `NONINTERACTIVE=1 bash <game>-server-install.sh`、`bash steam-server-install.sh <slug>` |
| 计划任务 | 可视化 list/add/remove + OnCalendar 模板 + 下次触发时间 | `<game>-manager schedule add/list/remove`（数据源 `/etc/<game>/tasks/*.cmd`） |
| 配置编辑 | textarea 编辑 → 保存即 config-apply（备份→写→重启→15s 健康检查→失败自动回滚） | `<game>-manager config-apply`（EDITOR 经临时包装脚本注入） |
| 审计页 | JSONL 表格 + game/action/关键字筛选 | `/var/log/game-server-scripts/audit.log` |
| 一键卸载 | 展示将删除的单元/目录/用户清单，输入服务名确认 | `NONINTERACTIVE=1 FORCE_UNINSTALL=1 bash <script> --uninstall` |
| 任务中心 | 安装/更新/备份/恢复/卸载统一任务模型：状态 + 1MB 环形缓冲 + SSE 输出订阅 + 同类互斥 | — |

## 支持的游戏（自动发现）

| 游戏 | manager | systemd unit | 配置（config-apply） | 备份目录 / 前缀 |
|------|---------|--------------|----------------------|-----------------|
| Minecraft Java | `mc-manager` | `mc-server.service` | `/opt/minecraft/server.properties` | `/opt/minecraft/backups` / `world_backup_` |
| Terraria | `terraria-manager` | `terraria-server.service` | `/opt/terraria/serverconfig.txt` | `/opt/terraria/backups` / `terraria_` |
| Valheim | `valheim-manager` | `valheim-server.service` | `/etc/valheim/credentials.env` | `/opt/valheim/backups` / `valheim_` |
| Palworld | `pal-manager` | `pal-server.service` | `.../PalWorldSettings.ini` | `/home/steam/pal-backups` / `pal_backup_` |
| steam 泛型 | `<slug>-manager` | `<slug>-server.service` | `/opt/<slug>/start.sh` | `/opt/<slug>/backups` / `<slug>_` |

steam 泛型游戏列表运行时解析 `catalog/steam-games.env`（`slug|appid|名称|端口|协议`），与内置四游戏重名时以内置为准。

---

## 目录结构

```
game-panel/
├── package.json              # 根编排脚本（install:all / typecheck / build / start）
├── server/                   # Express 4 + TypeScript ESM（strict）
│   └── src/
│       ├── index.ts          # 入口（umask 022、监听 PORT）
│       ├── app.ts            # 路由装配：health → 公开 auth → authenticateToken → csrf → 各路由 → 静态托管 → 错误处理
│       ├── auth/             # JWT（secret 0600 落盘）、securityStamp 会话、登录限速、CSRF 双重提交
│       ├── exec/             # games.ts 游戏注册表/发现、discovery.ts 状态采集、runner.ts execFile 唯一出口、validate.ts 白名单正则
│       ├── tasks/            # 任务模型（queued/running/success/failed + 1MB 环形缓冲 + 同类互斥）、安装字段白名单目录
│       ├── journal/          # journalctl 两阶段流（追赶批 + -f 跟随 + 10s cursor 刷新）
│       ├── sse/              # SSE 握手/心跳/会话守卫（5s securityStamp 复检）
│       └── routes/           # auth/games/lifecycle/logs/backups/install/tasks/schedule/config/audit/uninstall
├── client/                   # React 18 + Vite + TS + Ant Design 5
│   └── src/                  # 登录 / 总览 / 游戏详情(日志·备份·计划任务·配置·卸载) / 安装向导 / 审计 / 任务中心
└── deploy/
    ├── game-panel.service    # systemd 单元样例
    ├── install.sh            # 一键部署（install → build → 装 unit）
    ├── security-scan.sh      # 安全自测：未认证扫描 / CSRF / 注入用例
    └── acceptance*.sh        # 端到端验收脚本（共生验收复现）
```

## 部署（Ubuntu 22.04+/Debian 11+，root）

```bash
# 0) 前置：Node 18+ 与 npm（不要用 pnpm）；game-server-scripts 仓库就位
node -v            # v18.19.1 验证通过
git clone <game-server-scripts> /opt/game-server-scripts
git clone <this-repo>    /opt/game-panel

# 1) 安装依赖 + 类型检查 + 构建（前端产物由后端静态托管）
cd /opt/game-panel
npm --prefix server install
npm --prefix client install
npm --prefix server run build     # tsc -p tsconfig.json
npm --prefix client run build     # vite build

# 2) 一键部署为 systemd 服务（自动完成上述构建并安装 unit）
sudo bash deploy/install.sh /opt/game-server-scripts 3000
#    → 写入 /etc/game-panel.env（0600）：PORT / PANEL_SCRIPTS_DIR / PANEL_STATE_DIR

# 3) 浏览器访问 http://<主机>:3000，首次访问引导设置管理员账号
```

### 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `3000` | 监听端口 |
| `PANEL_SCRIPTS_DIR` | `/opt/game-server-scripts` | 脚本仓库目录（安装脚本 + catalog/） |
| `PANEL_STATE_DIR` | root: `/var/lib/game-panel` | 面板状态（state JSON 0600、JWT secret 0600、config-apply 暂存） |
| `PANEL_CLIENT_DIR` | `client/dist` | 前端构建产物目录 |
| `PANEL_AUDIT_LOG` | `/var/log/game-server-scripts/audit.log` | 审计日志路径 |

### systemd 单元样例（deploy/game-panel.service）

```ini
[Unit]
Description=Game Panel (game-server-scripts 驾驶舱)
After=network-online.target
Wants=network-online.target
# 注意：面板与游戏 unit 无任何 systemd 依赖（不 After/Requires 游戏服务）

[Service]
Type=simple
WorkingDirectory=/opt/game-panel
ExecStart=/usr/bin/node /opt/game-panel/server/dist/index.js
EnvironmentFile=-/etc/game-panel.env
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=3
User=root
# 不设 UMask：面板状态文件已显式 0600/0700；子进程（安装脚本）需要标准 root umask

[Install]
WantedBy=multi-user.target
```

> 面板需 root（安装/卸载/备份要调用 systemctl、useradd、sudo -u <game> 等）。
> 生产建议：不要把 3000 端口暴露公网，走 SSH 隧道或仅内网/堡垒机访问，并配置 HTTPS 反代。

---

## 安全设计（逐条自证）

1. **认证面收敛**：除 `GET /api/health` 与 `POST /api/auth/{status,init,login}` 外，所有路由挂 `authenticateToken`；安装/卸载/恢复/计划任务变更/生命周期/update 再挂 `requireAdmin`。无任何无认证路由组（见 `deploy/security-scan.sh` 输出，25 项受保护路由未认证全 401）。
2. **命令执行**：外部命令一律 `execFile` 固定参数数组（`exec/runner.ts`），无 shell 字符串拼接。可变参数过白名单正则（`exec/validate.ts`）：备份名 `^[A-Za-z0-9_-]+(\.tar\.gz)?$`、任务 ID `^\d{1,15}$`、unit 名 `^[A-Za-z0-9_.@-]+$`、OnCalendar `^[A-Za-z0-9*,:/_. -]+$`、cursor `^[A-Za-z0-9_.=-]+$`。
3. **路径约束**：restore 只接受 `latest` 或备份目录内文件名，`path.resolve` 后断言在白名单备份目录内（`assertWithinDir`），绝不接受任意路径。
4. **SSE 会话复检**：JWT 载荷携带 securityStamp；登出/改密轮换 stamp 后，旧 token 的 SSE 连接 5 秒内被服务端主动关闭（`event: expired`）。日志流 unit 白名单双重校验。
5. **登录限速**：账号+IP 双维度 10 次/5 分钟，key 用 sha256 截断 16 位定长（不存明文）。
6. **请求体**：登录/初始化 16kb，其余 1mb；所有字符串字段 zod 限长（用户名 ≤32、密码 ≤72、命令 ≤500、OnCalendar ≤100 等）。
7. **secret 处理**：JWT secret 首启 `crypto.randomBytes` 生成 0600 落盘，不进 URL/query/日志/命令行；安装密码字段仅经环境变量传递且输出打码（`KEY=******` + 显式值替换）；config-apply 的 EDITOR 走 0700 临时包装脚本 + 0600 暂存文件 + 环境变量，绝不拼 shell。
8. **渲染转义**：前端所有用户提供内容（审计详情/日志行/任务输出/游戏名）经 React 默认转义渲染，无 `dangerouslySetInnerHTML`。
9. **CSRF**：非 GET 请求强制双重提交（`panel_csrf` Cookie + `X-CSRF-TOKEN` 头，timingSafeEqual 比较）；会话 Cookie `panel_token` httpOnly + SameSite=Strict。
10. **无 systemd 依赖**：面板 unit 不 After/Requires 任何游戏 unit。

## 验收复现

```bash
# 面板运行后（默认 http://127.0.0.1:3000）：
BASE=http://127.0.0.1:3000 bash deploy/acceptance.sh init    # 初始化/登录（cookie 存 /tmp/gp.cookies）
BASE=http://127.0.0.1:3000 bash deploy/acceptance.sh scan    # 未认证扫描 + CSRF + 注入用例
# 业务链路分阶段（stage2 发现/备份/计划任务、stage3 config-apply/日志SSE、
# stage4 回滚/限速/会话失效、stage5+6 config-apply 回滚专测、stage7 卸载/审计）：
BASE=http://127.0.0.1:3000 bash deploy/acceptance-stage2.sh
```

## 开发

```bash
npm run install:all   # 两包安装依赖
npm run typecheck     # server + client tsc --noEmit（strict）
npm run build         # server 编译 + client vite build
npm start             # node server/dist/index.js
# client 开发：cd client && npm run dev（vite 代理 /api → localhost:3000）
```

## 许可

见上游 game-server-scripts 仓库 LICENSE。
