import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function intEnv(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

export const CONFIG = {
  port: intEnv('PORT', 3000),
  /** game-server-scripts 仓库所在目录（含 *-server-install.sh 与 catalog/） */
  scriptsDir: process.env.PANEL_SCRIPTS_DIR ?? '/opt/game-server-scripts',
  /** 面板私有状态目录（state JSON / JWT secret / 临时文件），0700/0600 */
  stateDir: process.env.PANEL_STATE_DIR ?? (isRoot ? '/var/lib/game-panel' : path.join(os.homedir(), '.game-panel')),
  /** 前端构建产物目录（由后端静态托管） */
  clientDir: process.env.PANEL_CLIENT_DIR ?? path.resolve(here, '../../../client/dist'),
  auditLogPath: process.env.PANEL_AUDIT_LOG ?? '/var/log/game-server-scripts/audit.log',
  taskOutputMaxBytes: 1024 * 1024,
  taskSseTailBytes: 64 * 1024,
  jwtTtlHours: 12,
  sessionGuardIntervalMs: 5000,
  sseHeartbeatMs: 15000,
  /** 长任务兜底超时 */
  taskTimeoutMs: 40 * 60 * 1000,
  configMaxBytes: 2 * 1024 * 1024,
} as const;
