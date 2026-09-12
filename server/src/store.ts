import fs from 'node:fs';
import path from 'node:path';

/**
 * JSON 原子落盘：写临时文件（0600）后 rename，避免半写状态。
 */
export function writeJsonFileAtomic(file: string, data: unknown, mode = 0o600): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}

export function readJsonFile<T>(file: string): T | null {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function readTextFile(file: string, maxBytes: number): string | null {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > maxBytes) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
