import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Response } from 'express';
import { sseSend } from '../sse/sse.js';

const execFileP = promisify(execFile);

const CURSOR_RE = /^-- cursor: (\S+)\s*$/;

/**
 * journalctl 实时流（两阶段，适配 systemd 255 的 --show-cursor 行为）：
 *  - 阶段一（追赶）：不带 -f 的批式输出（-n N 或 --after-cursor），批尾必带 "-- cursor:" 行
 *  - 阶段二（跟随）：--after-cursor=<cursor> -f 实时行
 *  - 期间每 10s 用 `journalctl -n 1 --show-cursor` 刷新最新 cursor，供断线重连续传
 */
export class JournalStream {
  private stopped = false;
  private children: ReturnType<typeof spawn>[] = [];
  private refresher: NodeJS.Timeout | null = null;
  private lastCursor: string | null;

  constructor(
    private readonly res: Response,
    private readonly unit: string,
    afterCursor: string | null,
    initialLines: number,
  ) {
    this.lastCursor = afterCursor;
    this.startCatchup(afterCursor, initialLines);
    this.refresher = setInterval(() => void this.refreshCursor(), 10_000);
  }

  private spawnJournal(args: string[]): ReturnType<typeof spawn> {
    const child = spawn('journalctl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.children.push(child);
    child.on('error', (err: Error) => {
      sseSend(this.res, 'fatal', { message: err.message });
    });
    return child;
  }

  private pump(child: ReturnType<typeof spawn>, onLine: (line: string) => void): void {
    let buf = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buf += chunk;
      let idx = buf.indexOf('\n');
      while (idx >= 0) {
        onLine(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
        idx = buf.indexOf('\n');
      }
      if (buf.length > 65536) buf = '';
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      const line = (chunk.split('\n')[0] ?? '').slice(0, 300);
      if (line.length > 0) sseSend(this.res, 'stderr', { line });
    });
  }

  private handleLine(line: string): void {
    const m = CURSOR_RE.exec(line);
    if (m && m[1]) {
      this.lastCursor = m[1];
      sseSend(this.res, 'cursor', { cursor: m[1] });
      return;
    }
    if (line.length > 0) sseSend(this.res, 'line', { line });
  }

  private startCatchup(afterCursor: string | null, initialLines: number): void {
    const args = ['-u', this.unit, '--no-pager', '-o', 'short-iso-precise', '--show-cursor'];
    if (afterCursor) args.push(`--after-cursor=${afterCursor}`);
    else args.push('-n', String(initialLines));
    const child = this.spawnJournal(args);
    this.pump(child, (line) => this.handleLine(line));
    child.on('close', (code: number | null) => {
      if (this.stopped) return;
      if (this.lastCursor) {
        // 阶段二：从已确认 cursor 之后实时跟随
        this.startFollow(this.lastCursor);
      } else {
        // 拿不到 cursor（异常情况）：退化为普通 -f
        this.startFollow(null);
      }
      void code;
    });
  }

  private startFollow(cursor: string | null): void {
    if (this.stopped) return;
    const args = ['-u', this.unit, '--no-pager', '-o', 'short-iso-precise', '-f'];
    if (cursor) args.push(`--after-cursor=${cursor}`);
    const child = this.spawnJournal(args);
    this.pump(child, (line) => this.handleLine(line));
    child.on('close', (code: number | null) => {
      if (!this.stopped) sseSend(this.res, 'end', { code });
    });
  }

  private async refreshCursor(): Promise<void> {
    if (this.stopped) return;
    try {
      const { stdout } = await execFileP(
        'journalctl',
        ['-u', this.unit, '-n', '1', '--show-cursor', '--no-pager', '-o', 'short-iso-precise'],
        { timeout: 8000 },
      );
      const lines = stdout.trimEnd().split('\n');
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const m = CURSOR_RE.exec(lines[i] ?? '');
        if (m && m[1] && m[1] !== this.lastCursor) {
          this.lastCursor = m[1];
          sseSend(this.res, 'cursor', { cursor: m[1] });
        }
      }
    } catch {
      /* journalctl 偶发失败忽略 */
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.refresher) clearInterval(this.refresher);
    for (const c of this.children) {
      try {
        c.kill('SIGTERM');
      } catch {
        /* already dead */
      }
    }
    this.children = [];
  }
}
