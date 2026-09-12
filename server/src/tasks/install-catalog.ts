import { badRequest } from '../errors.js';
import { listGameDefs, loadSteamCatalog, type GameDef } from '../exec/games.js';

export type InstallFieldType = 'text' | 'number' | 'password' | 'select' | 'bool';

export interface InstallField {
  /** 透传给安装脚本的环境变量名（白名单） */
  name: string;
  label: string;
  type: InstallFieldType;
  required: boolean;
  defaultValue: string;
  /** 全串匹配正则 */
  pattern: string;
  maxLength: number;
  secret: boolean;
  help: string;
  options?: { value: string; label: string }[];
}

export interface InstallEntry {
  gameId: string;
  label: string;
  kind: 'builtin' | 'steam';
  script: string;
  /** steam 泛型游戏为 slug，其余为 null */
  slug: string | null;
  description: string;
  fields: InstallField[];
  /** 端口提示（来自 catalog/注册表，只读展示） */
  defaultPort: number | null;
}

const f = (field: Partial<InstallField> & { name: string; label: string }): InstallField => ({
  type: 'text',
  required: false,
  defaultValue: '',
  pattern: '^.{0,200}$',
  maxLength: 200,
  secret: false,
  help: '',
  ...field,
});

function builtinEntry(def: GameDef): InstallEntry {
  const fields: Record<string, InstallField[]> = {
    minecraft: [
      f({ name: 'SERVER_TYPE', label: '服务端类型', type: 'select', required: true, defaultValue: 'paper', pattern: '^(paper|vanilla|fabric|forge)$', options: [
        { value: 'paper', label: 'Paper（推荐）' },
        { value: 'vanilla', label: '官方原版' },
        { value: 'fabric', label: 'Fabric' },
        { value: 'forge', label: 'Forge' },
      ] }),
      f({ name: 'MC_VERSION', label: 'MC 版本', defaultValue: '1.21.11', pattern: '^[0-9][0-9.]{0,15}$', help: '如 1.21.11' }),
      f({ name: 'MC_MEMORY', label: '内存上限 -Xmx', defaultValue: '4G', pattern: '^[0-9]+[GgMm]$', maxLength: 8 }),
      f({ name: 'MC_MEMORY_MIN', label: '内存下限 -Xms', defaultValue: '1G', pattern: '^[0-9]+[GgMm]$', maxLength: 8 }),
      f({ name: 'MC_PORT', label: '游戏端口', type: 'number', defaultValue: '25565', pattern: '^[0-9]{1,5}$', maxLength: 5 }),
      f({ name: 'MC_MAX_PLAYERS', label: '最大玩家数', type: 'number', defaultValue: '20', pattern: '^[0-9]{1,4}$', maxLength: 4 }),
      f({ name: 'MC_ENABLE_RCON', label: '启用 RCON', type: 'select', defaultValue: 'false', pattern: '^(true|false)$', options: [
        { value: 'false', label: '关闭（推荐）' },
        { value: 'true', label: '开启' },
      ] }),
      f({ name: 'MC_RCON_PASSWORD', label: 'RCON 密码', type: 'password', secret: true, pattern: '^[A-Za-z0-9_-]{8,64}$', maxLength: 64, help: '仅 MC_ENABLE_RCON=true 时需要' }),
    ],
    terraria: [
      f({ name: 'TS_PORT', label: '游戏端口', type: 'number', defaultValue: '7777', pattern: '^[0-9]{1,5}$', maxLength: 5 }),
      f({ name: 'TS_MAX_PLAYERS', label: '最大玩家数', type: 'number', defaultValue: '8', pattern: '^[0-9]{1,3}$', maxLength: 3 }),
      f({ name: 'TS_SERVER_NAME', label: '服务器名', defaultValue: 'Terraria Server', pattern: '^[A-Za-z0-9 _-]{0,60}$' }),
      f({ name: 'TS_SERVER_PASSWORD', label: '进服密码', type: 'password', secret: true, pattern: '^[A-Za-z0-9_-]{0,64}$' }),
      f({ name: 'TS_WORLD_NAME', label: '世界名', defaultValue: 'world', pattern: '^[A-Za-z0-9_-]{1,40}$' }),
      f({ name: 'TS_DIFFICULTY', label: '难度', type: 'select', defaultValue: '1', pattern: '^[0-3]$', options: [
        { value: '0', label: '普通' },
        { value: '1', label: '专家' },
        { value: '2', label: '大师' },
        { value: '3', label: '旅途' },
      ] }),
      f({ name: 'TS_SEED', label: '种子', pattern: '^[A-Za-z0-9_-]{0,60}$' }),
      f({ name: 'TS_VERSION', label: '固定版本', defaultValue: '1455', pattern: '^[0-9]{3,5}$', help: '官方版本号，如 1455' }),
      f({ name: 'TS_MEMORY_MAX', label: '内存上限', defaultValue: '2G', pattern: '^[0-9]+[GgMm]$', maxLength: 8 }),
    ],
    valheim: [
      f({ name: 'VH_SERVER_NAME', label: '服务器名', defaultValue: 'Valheim Server', pattern: '^[A-Za-z0-9 _-]{0,60}$' }),
      f({ name: 'VH_SERVER_PORT', label: '主端口', type: 'number', defaultValue: '2456', pattern: '^[0-9]{1,5}$', maxLength: 5 }),
      f({ name: 'VH_WORLD_NAME', label: '世界名', defaultValue: 'Dedicated', pattern: '^[A-Za-z0-9_-]{1,40}$' }),
      f({ name: 'VH_SERVER_PASSWORD', label: '进服密码（≥5 位）', type: 'password', required: true, secret: true, pattern: '^.{5,64}$', maxLength: 64 }),
      f({ name: 'VH_PUBLIC', label: '是否公开', type: 'select', defaultValue: '1', pattern: '^[01]$', options: [
        { value: '1', label: '公开' },
        { value: '0', label: '仅好友/局域网' },
      ] }),
      f({ name: 'VH_CROSSPLAY', label: '跨平台', type: 'select', defaultValue: 'false', pattern: '^(true|false)$', options: [
        { value: 'false', label: '关闭' },
        { value: 'true', label: '开启' },
      ] }),
      f({ name: 'VH_MEMORY_MAX', label: '内存上限', defaultValue: '4G', pattern: '^[0-9]+[GgMm]$', maxLength: 8 }),
    ],
    palworld: [
      f({ name: 'SERVER_NAME', label: '服务器名', defaultValue: 'Palworld Server', pattern: '^[A-Za-z0-9 _-]{0,60}$' }),
      f({ name: 'ADMIN_PASSWORD', label: '管理员/RCON 密码（≥12 位）', type: 'password', required: true, secret: true, pattern: '^.{12,64}$', maxLength: 64 }),
      f({ name: 'SERVER_PASSWORD', label: '进服密码', type: 'password', secret: true, pattern: '^.{0,64}$', maxLength: 64 }),
      f({ name: 'MAX_PLAYERS', label: '最大玩家数', type: 'number', defaultValue: '32', pattern: '^[0-9]{1,3}$', maxLength: 3 }),
      f({ name: 'DEFAULT_PORT', label: '游戏端口', type: 'number', defaultValue: '8211', pattern: '^[0-9]{1,5}$', maxLength: 5 }),
      f({ name: 'QUERY_PORT', label: '查询端口', type: 'number', defaultValue: '27015', pattern: '^[0-9]{1,5}$', maxLength: 5 }),
      f({ name: 'SWAP_SIZE', label: '目标 Swap', defaultValue: '16G', pattern: '^[0-9]+[GgMm]$', maxLength: 8 }),
      f({ name: 'STEAMCMD_PROXY', label: 'SteamCMD 代理', pattern: '^[A-Za-z0-9:/.=_-]{0,120}$', help: '如 socks5://127.0.0.1:7890' }),
    ],
  };
  return {
    gameId: def.id,
    label: def.label,
    kind: 'builtin',
    script: def.installScript,
    slug: null,
    description: `${def.label} 专用安装脚本（${def.installScript}）`,
    fields: fields[def.id] ?? [],
    defaultPort: def.ports[0]?.port ?? null,
  };
}

function steamEntry(slug: string, name: string, port: number): InstallEntry {
  return {
    gameId: slug,
    label: `${name} (steam)`,
    kind: 'steam',
    script: 'steam-server-install.sh',
    slug,
    description: `数据驱动 Steam 游戏部署（catalog/steam-games.env）`,
    fields: [
      f({ name: 'SG_PORT', label: '游戏端口', type: 'number', defaultValue: String(port || 0), pattern: '^[0-9]{1,5}$', maxLength: 5 }),
      f({ name: 'SG_MEMORY_MAX', label: '内存上限', defaultValue: '8G', pattern: '^[0-9]+[GgMm]$', maxLength: 8 }),
      f({ name: 'SG_EXTRA_ARGS', label: '附加启动参数', pattern: '^[A-Za-z0-9=:,._/-]{0,200}$', help: '追加到启动命令后的参数' }),
      f({ name: 'SG_BACKUP_KEEP', label: '备份保留份数', type: 'number', defaultValue: '10', pattern: '^[0-9]{1,3}$', maxLength: 3 }),
    ],
    defaultPort: port || null,
  };
}

export function buildInstallCatalog(): InstallEntry[] {
  const out: InstallEntry[] = [];
  for (const def of listGameDefs()) {
    if (def.kind === 'builtin') out.push(builtinEntry(def));
  }
  const seen = new Set(out.map((e) => e.gameId));
  for (const entry of loadSteamCatalog()) {
    if (seen.has(entry.slug)) continue;
    out.push(steamEntry(entry.slug, entry.name, entry.port));
  }
  return out;
}

export interface ValidatedInstall {
  env: Record<string, string>;
  secrets: string[];
  entry: InstallEntry;
}

/** 表单值 → 白名单 env；未知键/非法值一律拒绝 */
export function validateInstallValues(entry: InstallEntry, rawValues: Record<string, unknown>): ValidatedInstall {
  const env: Record<string, string> = {};
  const secrets: string[] = [];
  for (const field of entry.fields) {
    const raw = rawValues[field.name];
    let value = typeof raw === 'string' ? raw.trim() : '';
    if (value.length === 0) {
      if (field.required && field.defaultValue.length === 0) {
        throw badRequest(`缺少必填字段: ${field.label}`);
      }
      value = field.defaultValue;
    }
    if (value.length > field.maxLength) {
      throw badRequest(`字段 ${field.label} 超长（>${field.maxLength}）`);
    }
    if (value.length > 0 && !new RegExp(field.pattern).test(value)) {
      throw badRequest(`字段 ${field.label} 值不合法`);
    }
    if (value.length > 0) {
      env[field.name] = value;
      if (field.secret) secrets.push(value);
    }
  }
  for (const key of Object.keys(rawValues)) {
    if (!entry.fields.some((fd) => fd.name === key)) {
      throw badRequest(`不允许的字段: ${key.slice(0, 40)}`);
    }
  }
  return { env, secrets, entry };
}
