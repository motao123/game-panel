import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import { notFound } from '../errors.js';
import { RE_GAME_ID } from './validate.js';

export interface PortInfo {
  port: number;
  proto: 'tcp' | 'udp';
  label: string;
}

export interface UninstallPlan {
  units: string[];
  files: string[];
  dirs: string[];
  users: string[];
}

export interface GameDef {
  id: string;
  kind: 'builtin' | 'steam';
  label: string;
  manager: string;
  unit: string;
  etcDir: string;
  tasksDir: string;
  backupDir: string;
  backupPrefix: string;
  configPath: string | null;
  ports: PortInfo[];
  /** 相对 scriptsDir 的安装脚本名 */
  installScript: string;
  /** steam 泛型游戏的 slug */
  slug: string | null;
  uninstall: UninstallPlan;
}

const bin = (n: string): string => `/usr/local/bin/${n}`;

const BUILTINS: readonly GameDef[] = [
  {
    id: 'minecraft',
    kind: 'builtin',
    label: 'Minecraft Java',
    manager: bin('mc-manager'),
    unit: 'mc-server.service',
    etcDir: '/etc/minecraft',
    tasksDir: '/etc/minecraft/tasks',
    backupDir: '/opt/minecraft/backups',
    backupPrefix: 'world_backup_',
    configPath: '/opt/minecraft/server.properties',
    ports: [
      { port: 25565, proto: 'tcp', label: '游戏' },
      { port: 25575, proto: 'tcp', label: 'RCON' },
    ],
    installScript: 'minecraft-server-install.sh',
    slug: null,
    uninstall: {
      units: ['mc-server.service', 'mc-server-backup.service', 'mc-server-backup.timer'],
      files: [bin('mc-manager')],
      dirs: ['/opt/minecraft', '/etc/minecraft'],
      users: ['minecraft'],
    },
  },
  {
    id: 'terraria',
    kind: 'builtin',
    label: 'Terraria',
    manager: bin('terraria-manager'),
    unit: 'terraria-server.service',
    etcDir: '/etc/terraria',
    tasksDir: '/etc/terraria/tasks',
    backupDir: '/opt/terraria/backups',
    backupPrefix: 'terraria_',
    configPath: '/opt/terraria/serverconfig.txt',
    ports: [{ port: 7777, proto: 'tcp', label: '游戏' }],
    installScript: 'terraria-server-install.sh',
    slug: null,
    uninstall: {
      units: ['terraria-server.service', 'terraria-server-backup.service', 'terraria-server-backup.timer'],
      files: [bin('terraria-manager')],
      dirs: ['/opt/terraria', '/etc/terraria'],
      users: ['terraria'],
    },
  },
  {
    id: 'valheim',
    kind: 'builtin',
    label: 'Valheim',
    manager: bin('valheim-manager'),
    unit: 'valheim-server.service',
    etcDir: '/etc/valheim',
    tasksDir: '/etc/valheim/tasks',
    backupDir: '/opt/valheim/backups',
    backupPrefix: 'valheim_',
    configPath: '/etc/valheim/credentials.env',
    ports: [
      { port: 2456, proto: 'udp', label: '游戏' },
      { port: 2457, proto: 'udp', label: '查询' },
    ],
    installScript: 'valheim-server-install.sh',
    slug: null,
    uninstall: {
      units: ['valheim-server.service', 'valheim-server-backup.service', 'valheim-server-backup.timer'],
      files: [bin('valheim-manager')],
      dirs: ['/opt/valheim', '/etc/valheim'],
      users: ['valheim'],
    },
  },
  {
    id: 'palworld',
    kind: 'builtin',
    label: 'Palworld 幻兽帕鲁',
    manager: bin('pal-manager'),
    unit: 'pal-server.service',
    etcDir: '/etc/palworld',
    tasksDir: '/etc/palworld/tasks',
    backupDir: '/home/steam/pal-backups',
    backupPrefix: 'pal_backup_',
    configPath: '/home/steam/PalServer/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini',
    ports: [
      { port: 8211, proto: 'udp', label: '游戏' },
      { port: 27015, proto: 'udp', label: '查询' },
    ],
    installScript: 'palworld-server-install.sh',
    slug: null,
    uninstall: {
      units: [
        'pal-server.service',
        'pal-server-backup.service',
        'pal-server-backup.timer',
        'pal-server-restart.service',
        'pal-server-restart.timer',
      ],
      files: [bin('pal-manager'), bin('pal-backup'), bin('pal-rcon'), bin('pal-stop'), bin('pal-graceful-restart')],
      dirs: ['/home/steam/PalServer', '/etc/palworld', '/home/steam/pal-backups', '/var/log/palworld'],
      users: ['steam'],
    },
  },
];

export interface SteamCatalogEntry {
  slug: string;
  appid: string;
  name: string;
  port: number;
  proto: 'tcp' | 'udp';
}

/** 解析 catalog/steam-games.env（slug|appid|名称|端口|协议），失败返回空数组 */
export function loadSteamCatalog(): SteamCatalogEntry[] {
  const file = path.join(CONFIG.scriptsDir, 'catalog', 'steam-games.env');
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out: SteamCatalogEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length === 0 || t.startsWith('#')) continue;
    const parts = t.split('|');
    if (parts.length < 5) continue;
    const slug = parts[0]?.trim() ?? '';
    const appid = parts[1]?.trim() ?? '';
    const name = parts[2]?.trim() ?? slug;
    const port = Number.parseInt(parts[3]?.trim() ?? '', 10);
    const proto = (parts[4]?.trim() ?? 'udp') === 'tcp' ? 'tcp' : 'udp';
    if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(slug) || !/^\d+$/.test(appid)) continue;
    out.push({ slug, appid, name, port: Number.isFinite(port) ? port : 0, proto });
  }
  return out;
}

function steamGameDef(entry: SteamCatalogEntry): GameDef {
  const svc = `${entry.slug}-server`;
  return {
    id: entry.slug,
    kind: 'steam',
    label: `${entry.name} (steam)`,
    manager: bin(`${entry.slug}-manager`),
    unit: `${svc}.service`,
    etcDir: `/etc/${entry.slug}`,
    tasksDir: `/etc/${entry.slug}/tasks`,
    backupDir: `/opt/${entry.slug}/backups`,
    backupPrefix: `${entry.slug}_`,
    configPath: `/opt/${entry.slug}/start.sh`,
    ports: [{ port: entry.port, proto: entry.proto, label: '游戏' }],
    installScript: 'steam-server-install.sh',
    slug: entry.slug,
    uninstall: {
      units: [`${svc}.service`, `${svc}-backup.service`, `${svc}-backup.timer`],
      files: [bin(`${entry.slug}-manager`)],
      dirs: [`/opt/${entry.slug}`, `/etc/${entry.slug}`],
      users: [],
    },
  };
}

/** 与内置重名（valheim/palworld）的 steam 条目跳过 */
export function listGameDefs(): GameDef[] {
  const defs: GameDef[] = [...BUILTINS];
  const builtinIds = new Set(BUILTINS.map((g) => g.id));
  for (const entry of loadSteamCatalog()) {
    if (builtinIds.has(entry.slug)) continue;
    defs.push(steamGameDef(entry));
  }
  return defs;
}

export function getGameDef(id: string): GameDef {
  if (!RE_GAME_ID.test(id)) throw notFound('未知游戏');
  const def = listGameDefs().find((g) => g.id === id);
  if (!def) throw notFound(`未知游戏: ${id}`);
  return def;
}

/** 安装脚本绝对路径（断言存在） */
export function installScriptPath(def: GameDef): string {
  const p = path.join(CONFIG.scriptsDir, def.installScript);
  return p;
}
