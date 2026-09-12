import fsp from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { getGameDef } from '../exec/games.js';
import { runCommand } from '../exec/runner.js';
import { RE_ON_CALENDAR, RE_TASK_ID, assertMatch } from '../exec/validate.js';
import { baseEnv } from '../util.js';
import { badRequest, notFound } from '../errors.js';
import { h } from './helpers.js';
import { requireAdmin } from '../auth/middleware.js';

interface ScheduleItem {
  id: string;
  calendar: string;
  nextElapse: string | null;
  command: string;
  stale: boolean;
}

const addSchema = z
  .object({
    calendar: z.string().min(3).max(100),
    command: z.string().min(1).max(500),
  })
  .strict();

function timerUnitFor(def: ReturnType<typeof getGameDef>, id: string): string {
  return `${def.unit.replace(/\.service$/, '')}-task-${id}.timer`;
}

function parseShowProps(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

async function listSchedule(def: ReturnType<typeof getGameDef>): Promise<ScheduleItem[]> {
  let files: string[] = [];
  try {
    files = (await fsp.readdir(def.tasksDir)).filter((n) => n.endsWith('.cmd')).sort();
  } catch {
    return [];
  }
  const items: ScheduleItem[] = [];
  for (const file of files) {
    const id = file.slice(0, -4);
    if (!RE_TASK_ID.test(id)) continue;
    let command = '';
    try {
      const st = await fsp.stat(path.join(def.tasksDir, file));
      if (!st.isFile() || st.size > 4096) continue;
      command = (await fsp.readFile(path.join(def.tasksDir, file), 'utf8')).trimEnd().slice(0, 500);
    } catch {
      continue;
    }
    // systemd 255 不通过 show 暴露 OnCalendar 属性 → 用 systemctl cat 提取
    const catRun = await runCommand('systemctl', ['cat', timerUnitFor(def, id), '--no-pager'], { timeoutMs: 10_000 });
    const calendar = /^OnCalendar=(.+)$/m.exec(catRun.stdout)?.[1]?.trim() ?? '?';
    const nextRun = await runCommand(
      'systemctl',
      ['show', timerUnitFor(def, id), '-p', 'NextElapseUSecRealtime', '--no-pager'],
      { timeoutMs: 10_000 },
    );
    const nextElapse = parseShowProps(nextRun.stdout)['NextElapseUSecRealtime'] ?? null;
    items.push({
      id,
      calendar,
      nextElapse: nextElapse && nextElapse.length > 0 ? nextElapse : null,
      command,
      stale: catRun.failed || nextRun.failed,
    });
  }
  return items;
}

/** 计划任务可视化：变更一律走 <game>-manager schedule add|remove（数据源 /etc/<game>/tasks/*.cmd） */
export function scheduleRouter(): Router {
  const r = Router();

  r.get('/:game/schedule', h(async (req, res) => {
    const def = getGameDef(req.params.game ?? '');
    res.json({ items: await listSchedule(def) });
  }));

  r.post('/:game/schedule', requireAdmin, h(async (req, res) => {
    const def = getGameDef(req.params.game ?? '');
    const parsed = addSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('参数不合法');
    const { calendar, command } = parsed.data;
    assertMatch(RE_ON_CALENDAR, calendar, 'OnCalendar 表达式');
    if (/[\r\n\u0000\u0060$&;<>|\\]/.test(command)) {
      throw badRequest('命令包含非法控制字符');
    }
    const run = await runCommand(def.manager, ['schedule', 'add', calendar, command], {
      timeoutMs: 60_000,
      env: baseEnv(),
    });
    if (run.failed) {
      throw badRequest(`schedule add 失败（exit=${run.exitCode ?? '?'}）: ${`${run.stderr}${run.stdout}`.slice(-500)}`);
    }
    const created = /id=(\d+)/.exec(run.stdout)?.[1] ?? null;
    res.json({ ok: true, id: created, items: await listSchedule(def) });
  }));

  r.delete('/:game/schedule/:id', requireAdmin, h(async (req, res) => {
    const def = getGameDef(req.params.game ?? '');
    const id = assertMatch(RE_TASK_ID, req.params.id ?? '', '任务 ID');
    const run = await runCommand(def.manager, ['schedule', 'remove', id], { timeoutMs: 60_000, env: baseEnv() });
    if (run.failed) throw notFound(`schedule remove 失败（exit=${run.exitCode ?? '?'}）`);
    res.json({ ok: true, items: await listSchedule(def) });
  }));

  return r;
}
