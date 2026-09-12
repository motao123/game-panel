import fs from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import { CONFIG } from '../config.js';
import { getGameDef, installScriptPath } from '../exec/games.js';
import { taskManager } from '../tasks/tasks.js';
import { baseEnv } from '../util.js';
import { badRequest } from '../errors.js';
import { h } from './helpers.js';
import { requireAdmin } from '../auth/middleware.js';

const confirmSchema = z.object({ confirm: z.string().min(1).max(80) }).strict();

export interface UninstallPreview {
  gameId: string;
  label: string;
  confirmName: string;
  units: string[];
  files: string[];
  dirs: string[];
  users: string[];
  script: string;
}

/**
 * 一键卸载：显示将删除的单元/目录/用户清单，强制输入服务名确认后
 * 执行 `NONINTERACTIVE=1 FORCE_UNINSTALL=1 bash <script> --uninstall`（走任务模型）。
 */
export function uninstallRouter(): Router {
  const r = Router();

  r.get('/:game/uninstall/preview', h(async (req, res) => {
    const def = getGameDef(req.params.game ?? '');
    const preview: UninstallPreview = {
      gameId: def.id,
      label: def.label,
      confirmName: def.unit.replace(/\.service$/, ''),
      units: def.uninstall.units,
      files: def.uninstall.files,
      dirs: def.uninstall.dirs,
      users: def.uninstall.users,
      script: def.installScript,
    };
    res.json({ preview, scriptsDir: CONFIG.scriptsDir });
  }));

  r.post('/:game/uninstall', requireAdmin, h(async (req, res) => {
    const def = getGameDef(req.params.game ?? '');
    const parsed = confirmSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('参数不合法');
    const confirmName = def.unit.replace(/\.service$/, '');
    if (parsed.data.confirm !== confirmName) {
      throw badRequest(`确认文本不匹配：请输入服务名 ${confirmName}`);
    }
    const script = installScriptPath(def);
    if (!fs.existsSync(script)) throw badRequest(`安装脚本不存在: ${def.installScript}`);
    const args = def.kind === 'steam' ? [def.slug ?? '', '--uninstall'] : ['--uninstall'];
    const task = taskManager.start({
      kind: 'uninstall',
      title: `卸载 ${def.label}`,
      gameId: def.id,
      file: 'bash',
      args: [script, ...args],
      env: baseEnv({ FORCE_UNINSTALL: '1' }),
      timeoutMs: 15 * 60 * 1000,
    });
    res.json({ ok: true, task });
  }));

  return r;
}
