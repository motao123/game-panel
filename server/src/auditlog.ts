import fs from 'node:fs';
import { CONFIG } from './config.js';

export interface AuditRow {
  time: string;
  game: string;
  user: string;
  action: string;
  detail: string;
  raw: string;
}

const MAX_READ_BYTES = 4 * 1024 * 1024;

export interface AuditPage {
  exists: boolean;
  total: number;
  rows: AuditRow[];
}

function parseLine(line: string): AuditRow | null {
  const t = line.trim();
  if (t.length === 0) return null;
  try {
    const obj = JSON.parse(t) as Record<string, unknown>;
    const str = (k: string): string => {
      const v = obj[k];
      return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
    };
    return {
      time: str('time'),
      game: str('game'),
      user: str('user'),
      action: str('action'),
      detail: str('detail'),
      raw: t.slice(0, 500),
    };
  } catch {
    return null;
  }
}

/** 读 /var/log/game-server-scripts/audit.log（JSONL），新→旧返回 */
export function readAuditLog(filter: {
  game?: string;
  action?: string;
  q?: string;
  limit: number;
  offset: number;
}): AuditPage {
  let text: string;
  try {
    const st = fs.statSync(CONFIG.auditLogPath);
    const size = st.size;
    const start = Math.max(0, size - MAX_READ_BYTES);
    const fd = fs.openSync(CONFIG.auditLogPath, 'r');
    try {
      const len = size - start;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      text = buf.toString('utf8');
      if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { exists: false, total: 0, rows: [] };
  }

  const all: AuditRow[] = [];
  for (const line of text.split('\n')) {
    const row = parseLine(line);
    if (!row) continue;
    if (filter.game && row.game !== filter.game) continue;
    if (filter.action && !row.action.toLowerCase().includes(filter.action.toLowerCase())) continue;
    if (filter.q && !`${row.detail} ${row.raw}`.toLowerCase().includes(filter.q.toLowerCase())) continue;
    all.push(row);
  }
  const total = all.length;
  const rows = all.reverse().slice(filter.offset, filter.offset + filter.limit);
  return { exists: true, total, rows };
}
