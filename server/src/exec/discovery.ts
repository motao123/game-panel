import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from './runner.js';
import { CONFIG } from '../config.js';
import type { GameDef } from './games.js';
import { listGameDefs } from './games.js';

export interface BackupItem {
  name: string;
  sizeBytes: number;
  mtimeMs: number;
  sha256: string | null;
}

export interface BackupSummary {
  count: number;
  latest: BackupItem | null;
}

export interface GameStatus {
  id: string;
  kind: 'builtin' | 'steam';
  label: string;
  unit: string;
  manager: string;
  installed: boolean;
  serviceExists: boolean;
  managerExists: boolean;
  active: string;
  sub: string;
  mainPID: number;
  memoryCurrent: number | null;
  memoryPeak: number | null;
  memoryMax: number | null;
  cpuPercent: number | null;
  since: string | null;
  ports: GameDef['ports'];
  configEditable: boolean;
  configPath: string | null;
  backupDir: string;
  backupPrefix: string;
  lastBackup: BackupSummary;
  installScript: string;
}

interface CpuSample {
  wallMs: number;
  ticks: number;
}

const cpuSamples = new Map<string, CpuSample>();
const CLK_TCK = 100; // Linux USER_HZ

async function loadUnitSet(): Promise<Set<string>> {
  const r = await runCommand('systemctl', ['list-units', '--type=service', '--all', '--no-legend', '--no-pager'], {
    timeoutMs: 15_000,
  });
  const set = new Set<string>();
  for (const line of r.stdout.split('\n')) {
    const unit = line.trim().split(/\s+/)[0];
    if (unit && unit.endsWith('.service')) set.add(unit);
  }
  return set;
}

async function showUnitProps(unit: string, props: readonly string[]): Promise<Record<string, string>> {
  const args: string[] = ['show', unit];
  for (const p of props) args.push('-p', p);
  args.push('--no-pager');
  const r = await runCommand('systemctl', args, { timeoutMs: 15_000 });
  const out: Record<string, string> = {};
  for (const line of r.stdout.split('\n')) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

function parseBytes(v: string | undefined): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number.parseInt(v, 10);
  return null;
}

async function readCpuTicks(pid: number): Promise<number | null> {
  try {
    const stat = await fsp.readFile(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    if (close < 0) return null;
    const rest = stat.slice(close + 2).split(' ');
    const utime = Number.parseInt(rest[10] ?? '', 10);
    const stime = Number.parseInt(rest[11] ?? '', 10);
    if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
    return utime + stime;
  } catch {
    return null;
  }
}

function cpuPercentOf(unit: string, ticks: number): number | null {
  const now = Date.now();
  const prev = cpuSamples.get(unit);
  if (!prev) {
    cpuSamples.set(unit, { wallMs: now, ticks });
    return null;
  }
  const dWall = (now - prev.wallMs) / 1000;
  if (dWall < 2) return null; // 窗口太短，保留旧样本待下次计算
  const dTicks = ticks - prev.ticks;
  cpuSamples.set(unit, { wallMs: now, ticks });
  if (dTicks < 0) return null; // 进程重启
  return Math.round((dTicks / CLK_TCK / dWall) * 1000) / 10;
}

export async function listBackups(def: GameDef): Promise<BackupItem[]> {
  let names: string[];
  try {
    names = await fsp.readdir(def.backupDir);
  } catch {
    return [];
  }
  const items: BackupItem[] = [];
  for (const name of names) {
    if (!name.startsWith(def.backupPrefix) || !name.endsWith('.tar.gz')) continue;
    try {
      const st = await fsp.stat(path.join(def.backupDir, name));
      if (!st.isFile()) continue;
      let sha256: string | null = null;
      try {
        const sum = await fsp.readFile(path.join(def.backupDir, `${name}.sha256`), 'utf8');
        const tok = sum.trim().split(/\s+/)[0];
        if (tok && /^[0-9a-f]{64}$/i.test(tok)) sha256 = tok.toLowerCase();
      } catch {
        /* 无校验文件 */
      }
      items.push({ name, sizeBytes: st.size, mtimeMs: st.mtimeMs, sha256 });
    } catch {
      /* 忽略瞬时变化 */
    }
  }
  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return items;
}

export async function backupSummary(def: GameDef): Promise<BackupSummary> {
  const items = await listBackups(def);
  return { count: items.length, latest: items[0] ?? null };
}

function managerExists(def: GameDef): boolean {
  try {
    fs.accessSync(def.manager, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function gameStatus(def: GameDef, unitSet: Set<string>): Promise<GameStatus> {
  const svcExists = unitSet.has(def.unit);
  const mgrExists = managerExists(def);
  const installed = mgrExists || svcExists || fs.existsSync(def.etcDir);
  const base: GameStatus = {
    id: def.id,
    kind: def.kind,
    label: def.label,
    unit: def.unit,
    manager: def.manager,
    installed,
    serviceExists: svcExists,
    managerExists: mgrExists,
    active: 'unknown',
    sub: 'unknown',
    mainPID: 0,
    memoryCurrent: null,
    memoryPeak: null,
    memoryMax: null,
    cpuPercent: null,
    since: null,
    ports: def.ports,
    configEditable: def.configPath !== null,
    configPath: def.configPath,
    backupDir: def.backupDir,
    backupPrefix: def.backupPrefix,
    lastBackup: { count: 0, latest: null },
    installScript: def.installScript,
  };
  if (!svcExists) return base;
  const props = await showUnitProps(def.unit, [
    'ActiveState',
    'SubState',
    'MainPID',
    'MemoryCurrent',
    'MemoryPeak',
    'MemoryMax',
    'ExecMainStartTimestamp',
  ]);
  base.active = props['ActiveState'] ?? 'unknown';
  base.sub = props['SubState'] ?? 'unknown';
  base.mainPID = parseBytes(props['MainPID']) ?? 0;
  base.memoryCurrent = parseBytes(props['MemoryCurrent']);
  base.memoryPeak = parseBytes(props['MemoryPeak']);
  base.memoryMax = parseBytes(props['MemoryMax']);
  base.since = props['ExecMainStartTimestamp'] ?? null;
  if (base.mainPID > 0) {
    const ticks = await readCpuTicks(base.mainPID);
    if (ticks !== null) base.cpuPercent = cpuPercentOf(def.unit, ticks);
  }
  base.lastBackup = await backupSummary(def);
  return base;
}

export async function listGamesStatus(): Promise<GameStatus[]> {
  const defs = listGameDefs();
  const unitSet = await loadUnitSet();
  return Promise.all(defs.map((d) => gameStatus(d, unitSet)));
}

export function taskOutputLimit(): number {
  return CONFIG.taskOutputMaxBytes;
}
