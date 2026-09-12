import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { CONFIG } from '../config.js';
import { conflict } from '../errors.js';
import { maskText } from '../masking.js';

export type TaskKind = 'install' | 'uninstall' | 'restore' | 'update' | 'backup';

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  install: '安装',
  uninstall: '卸载',
  restore: '恢复',
  update: '更新',
  backup: '备份',
};

export type TaskStatus = 'running' | 'success' | 'failed' | 'interrupted';

export interface TaskSnapshot {
  id: string;
  kind: TaskKind;
  kindLabel: string;
  title: string;
  gameId: string | null;
  status: TaskStatus;
  createdAt: number;
  endedAt: number | null;
  exitCode: number | null;
  output: string;
  truncated: boolean;
}

export interface TaskUpdate {
  id: string;
  status: TaskStatus;
  appended: string;
}

class RingBuffer {
  private buf = '';
  private truncated = false;
  constructor(private readonly maxBytes: number) {}

  push(s: string): void {
    this.buf += s;
    if (this.buf.length > this.maxBytes) {
      this.buf = this.buf.slice(this.buf.length - this.maxBytes);
      this.truncated = true;
    }
  }

  value(): string {
    return this.buf;
  }

  isTruncated(): boolean {
    return this.truncated;
  }

  tail(maxChars: number): string {
    return this.buf.length <= maxChars ? this.buf : this.buf.slice(this.buf.length - maxChars);
  }
}

interface InternalTask {
  id: string;
  kind: TaskKind;
  title: string;
  gameId: string | null;
  status: TaskStatus;
  createdAt: number;
  endedAt: number | null;
  exitCode: number | null;
  buf: RingBuffer;
  child: ReturnType<typeof spawn> | null;
}

export interface StartSpec {
  kind: TaskKind;
  title: string;
  gameId: string | null;
  file: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
  secrets?: readonly string[];
  timeoutMs?: number;
}

const HISTORY_LIMIT = 50;

/** 任务历史持久化路径（面板重启后任务不再凭空消失） */
const historyFile = path.join(CONFIG.stateDir, 'tasks-history.json');

interface PersistedTask {
  id: string;
  kind: TaskKind;
  title: string;
  gameId: string | null;
  status: TaskStatus;
  createdAt: number;
  endedAt: number | null;
  exitCode: number | null;
  output: string;
  truncated: boolean;
}

class TaskManager extends EventEmitter {
  private readonly tasks = new Map<string, InternalTask>();
  private readonly activeByKind = new Map<TaskKind, string>();

  constructor() {
    super();
    this.restoreHistory();
  }

  /** 启动时恢复上一次面板的历史任务；运行中被重启打断的标记为 interrupted */
  private restoreHistory(): void {
    try {
      const raw = fs.readFileSync(historyFile, 'utf-8');
      const items = JSON.parse(raw) as PersistedTask[];
      for (const p of items) {
        const interrupted = p.status === 'running';
        const task: InternalTask = {
          id: p.id,
          kind: p.kind,
          title: p.title,
          gameId: p.gameId,
          status: interrupted ? 'interrupted' : p.status,
          createdAt: p.createdAt,
          endedAt: p.endedAt ?? (interrupted ? Date.now() : null),
          exitCode: p.exitCode,
          buf: new RingBuffer(CONFIG.taskOutputMaxBytes),
          child: null,
        };
        if (interrupted) task.buf.push('\n[panel] 面板重启导致任务中断（进程已随面板终止）\n');
        else task.buf.push(p.output);
        this.tasks.set(p.id, task);
      }
    } catch {
      /* 首次启动或历史损坏：从空任务列表开始 */
    }
  }

  private persistHistory(): void {
    try {
      fs.mkdirSync(CONFIG.stateDir, { recursive: true });
      const items: PersistedTask[] = [...this.tasks.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, HISTORY_LIMIT)
        .map((t) => {
          const s = this.snapshot(t);
          return { ...s, output: s.output.slice(-4096) };
        });
      const tmp = path.join(CONFIG.stateDir, '.tasks-history.tmp');
      fs.writeFileSync(tmp, JSON.stringify(items), { mode: 0o600 });
      fs.renameSync(tmp, historyFile);
    } catch {
      /* 持久化失败不影响任务执行 */
    }
  }

  start(spec: StartSpec): TaskSnapshot {
    const activeId = this.activeByKind.get(spec.kind);
    if (activeId) {
      throw conflict(`已有「${TASK_KIND_LABEL[spec.kind]}」任务正在进行中（任务 ${activeId}），请等待完成`);
    }
    const id = crypto.randomBytes(8).toString('hex');
    const task: InternalTask = {
      id,
      kind: spec.kind,
      title: spec.title,
      gameId: spec.gameId,
      status: 'running',
      createdAt: Date.now(),
      endedAt: null,
      exitCode: null,
      buf: new RingBuffer(CONFIG.taskOutputMaxBytes),
      child: null,
    };
    this.tasks.set(id, task);
    this.activeByKind.set(spec.kind, id);
    this.persistHistory();

    const secrets = spec.secrets ?? [];
    const timer = setTimeout(
      () => {
        task.child?.kill('SIGKILL');
        task.buf.push('\n[panel] 任务超时被终止\n');
      },
      spec.timeoutMs ?? CONFIG.taskTimeoutMs,
    );

    const child = spawn(spec.file, [...spec.args], {
      env: spec.env,
      cwd: spec.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    task.child = child;

    const forward = (chunk: Buffer | string): void => {
      const text = maskText(typeof chunk === 'string' ? chunk : chunk.toString('utf8'), secrets);
      task.buf.push(text);
      this.emitUpdate(task, text);
    };
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', forward);
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', forward);

    const finish = (status: TaskStatus, exitCode: number | null): void => {
      if (task.status !== 'running') return;
      clearTimeout(timer);
      task.status = status;
      task.exitCode = exitCode;
      task.endedAt = Date.now();
      if (this.activeByKind.get(spec.kind) === id) this.activeByKind.delete(spec.kind);
      this.prune();
      this.persistHistory();
      this.emitUpdate(task, '');
    };

    child.on('error', (err: Error) => {
      task.buf.push(`\n[panel] 进程启动失败: ${err.message}\n`);
      finish('failed', -1);
    });
    child.on('close', (code: number | null) => {
      finish(code === 0 ? 'success' : 'failed', code);
    });

    return this.snapshot(task);
  }

  private emitUpdate(task: InternalTask, appended: string): void {
    const update: TaskUpdate = { id: task.id, status: task.status, appended };
    this.emit(`task:${task.id}`, update);
    this.emit('any', update);
  }

  private prune(): void {
    const finished = [...this.tasks.values()]
      .filter((t) => t.status !== 'running')
      .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
    while (finished.length > HISTORY_LIMIT) {
      const t = finished.shift();
      if (!t) break;
      this.tasks.delete(t.id);
    }
  }

  get(id: string): TaskSnapshot | null {
    const t = this.tasks.get(id);
    return t ? this.snapshot(t) : null;
  }

  tailOf(id: string, maxChars: number): string | null {
    const t = this.tasks.get(id);
    return t ? t.buf.tail(maxChars) : null;
  }

  list(): TaskSnapshot[] {
    return [...this.tasks.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((t) => {
        const s = this.snapshot(t);
        return { ...s, output: s.output.slice(-4096) };
      });
  }

  private snapshot(t: InternalTask): TaskSnapshot {
    return {
      id: t.id,
      kind: t.kind,
      kindLabel: TASK_KIND_LABEL[t.kind],
      title: t.title,
      gameId: t.gameId,
      status: t.status,
      createdAt: t.createdAt,
      endedAt: t.endedAt,
      exitCode: t.exitCode,
      output: t.buf.tail(CONFIG.taskSseTailBytes),
      truncated: t.buf.isTruncated(),
    };
  }
}

export const taskManager = new TaskManager();
