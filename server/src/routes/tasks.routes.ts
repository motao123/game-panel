import { Router } from 'express';
import { taskManager, type TaskUpdate } from '../tasks/tasks.js';
import { notFound } from '../errors.js';
import { sseInit, sseSend, attachSseGuards } from '../sse/sse.js';
import { h } from './helpers.js';
import type { Request, Response } from 'express';

/** 长任务查询与输出订阅（SSE） */
export function tasksRouter(): Router {
  const r = Router();

  r.get('/', (_req, res) => {
    res.json({ tasks: taskManager.list() });
  });

  r.get('/:id', h(async (req, res) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const task = taskManager.get(id);
    if (!task) throw notFound('任务不存在或已过期');
    res.json({ task });
  }));

  r.get('/:id/stream', h(async (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const task = taskManager.get(id);
    if (!task) throw notFound('任务不存在或已过期');

    sseInit(res);
    if (res.writableEnded) return;
    sseSend(res, 'snapshot', task);

    let guardRef: { close: () => void } | null = null;
    const finishIfDone = (): void => {
      const snap = taskManager.get(id);
      if (snap && snap.status !== 'running') {
        sseSend(res, 'end', { status: snap.status, exitCode: snap.exitCode });
        guardRef?.close();
      }
    };

    const listener = (update: TaskUpdate): void => {
      if (update.id !== id) return;
      if (update.appended.length > 0) sseSend(res, 'output', { appended: update.appended });
      finishIfDone();
    };
    taskManager.on(`task:${id}`, listener);

    guardRef = attachSseGuards(req, res, () => {
      taskManager.removeListener(`task:${id}`, listener);
    });

    // 连接时任务已是终态：补发 end 并关闭
    if (task.status !== 'running') finishIfDone();
  }));

  return r;
}
