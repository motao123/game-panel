import { Router } from 'express';
import { z } from 'zod';
import { getGameDef } from '../exec/games.js';
import { runCommand } from '../exec/runner.js';
import { baseEnv } from '../util.js';
import { badRequest, notFound } from '../errors.js';
import { taskManager } from '../tasks/tasks.js';
import { h } from './helpers.js';
import { requireAdmin } from '../auth/middleware.js';

const LIFECYCLE_ACTIONS = ['start', 'stop', 'restart'] as const;
type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

const lifecycleSchema = z.object({ action: z.enum(LIFECYCLE_ACTIONS) }).strict();

/** 生命周期 + 更新。manager 是唯一入口，面板不做任何 systemctl 直接变更。 */
export function lifecycleRouter(): Router {
  const r = Router();

  r.post('/:game/lifecycle', requireAdmin, h(async (req, res) => {
    const def = getGameDef(req.params.game ?? '');
    const parsed = lifecycleSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('action 必须是 start|stop|restart');
    const action: LifecycleAction = parsed.data.action;
    const run = await runCommand(def.manager, [action], { timeoutMs: 150_000, env: baseEnv() });
    res.json({
      ok: !run.failed,
      action,
      unit: def.unit,
      exitCode: run.exitCode,
      output: `${run.stdout}${run.stderr}`.slice(-4000),
    });
  }));

  r.post('/:game/update', requireAdmin, h(async (req, res) => {
    const def = getGameDef(req.params.game ?? '');
    const task = taskManager.start({
      kind: 'update',
      title: `更新 ${def.label}`,
      gameId: def.id,
      file: def.manager,
      args: ['update'],
      env: baseEnv(),
    });
    res.json({ ok: true, task });
  }));

  r.get('/:game/info', h(async (req, res) => {
    const def = getGameDef(req.params.game ?? '');
    const run = await runCommand(def.manager, ['info'], { timeoutMs: 30_000, env: baseEnv() });
    if (run.failed) throw notFound(`info 失败（exit=${run.exitCode ?? '?'}）`);
    res.json({ output: `${run.stdout}${run.stderr}`.slice(-4000) });
  }));

  r.get('/:game/memory', h(async (req, res) => {
    const def = getGameDef(req.params.game ?? '');
    const run = await runCommand(def.manager, ['memory'], { timeoutMs: 30_000, env: baseEnv() });
    if (run.failed) throw notFound(`memory 失败（exit=${run.exitCode ?? '?'}）`);
    res.json({ output: `${run.stdout}${run.stderr}`.slice(-4000) });
  }));

  return r;
}
