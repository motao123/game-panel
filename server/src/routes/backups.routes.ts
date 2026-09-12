import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { getGameDef } from '../exec/games.js';
import { RE_BACKUP_NAME, assertMatch, assertWithinDir } from '../exec/validate.js';
import { taskManager } from '../tasks/tasks.js';
import { baseEnv } from '../util.js';
import { badRequest, notFound } from '../errors.js';
import { h } from './helpers.js';
import { requireAdmin } from '../auth/middleware.js';

const restoreSchema = z.object({ file: z.string().min(1).max(200) }).strict();

/**
 * 备份/恢复：backup 与 restore 都走 *-manager（恢复自带 pre-restore 备份 + sha256 校验 + flock 互斥）。
 * restore 只接受 latest 或白名单备份目录内的 *.tar.gz 名，绝不接受任意路径。
 */
export function backupsRouter(): Router {
  const r = Router();

  r.post('/:game/backups', requireAdmin, h(async (req, res) => {
    const def = getGameDef(req.params.game ?? '');
    const task = taskManager.start({
      kind: 'backup',
      title: `备份 ${def.label}`,
      gameId: def.id,
      file: def.manager,
      args: ['backup'],
      env: baseEnv(),
      timeoutMs: 30 * 60 * 1000,
    });
    res.json({ ok: true, task });
  }));

  r.post('/:game/backups/restore', requireAdmin, h(async (req, res) => {
    const def = getGameDef(req.params.game ?? '');
    const parsed = restoreSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('file 必须是 latest 或备份文件名');
    const fileArg = parsed.data.file;

    let target: string;
    if (fileArg === 'latest') {
      target = 'latest';
    } else {
      assertMatch(RE_BACKUP_NAME, fileArg, '备份名');
      const name = fileArg.endsWith('.tar.gz') ? fileArg : `${fileArg}.tar.gz`;
      const resolved = assertWithinDir(def.backupDir, path.join(def.backupDir, name), '备份路径');
      if (!fs.existsSync(resolved)) throw notFound(`备份不存在: ${name}`);
      target = resolved;
    }

    const task = taskManager.start({
      kind: 'restore',
      title: `恢复 ${def.label} ← ${fileArg}`,
      gameId: def.id,
      file: def.manager,
      args: ['restore', target],
      env: baseEnv(),
      timeoutMs: 30 * 60 * 1000,
    });
    res.json({ ok: true, task });
  }));

  return r;
}
