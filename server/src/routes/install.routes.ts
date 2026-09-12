import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { CONFIG } from '../config.js';
import { getGameDef, installScriptPath } from '../exec/games.js';
import { buildInstallCatalog, validateInstallValues } from '../tasks/install-catalog.js';
import { taskManager } from '../tasks/tasks.js';
import { baseEnv } from '../util.js';
import { badRequest } from '../errors.js';
import { h } from './helpers.js';
import { requireAdmin } from '../auth/middleware.js';

const installSchema = z
  .object({
    gameId: z.string().min(1).max(40),
    values: z.record(z.string(), z.unknown()),
  })
  .strict();

/** 安装向导数据源：4 个专用脚本 + catalog/steam-games.env 数据驱动 */
export function installRouter(): Router {
  const r = Router();

  r.get('/catalog', h(async (_req, res) => {
    res.json({ entries: buildInstallCatalog(), scriptsDir: CONFIG.scriptsDir });
  }));

  r.post('/', requireAdmin, h(async (req, res) => {
    const parsed = installSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('参数不合法');
    const { gameId, values } = parsed.data;

    const entry = buildInstallCatalog().find((e) => e.gameId === gameId);
    if (!entry) throw badRequest(`不支持安装: ${gameId}`);

    const def = getGameDef(gameId);
    const script = installScriptPath(def);
    if (!fs.existsSync(script)) throw badRequest(`安装脚本不存在: ${def.installScript}`);

    // 白名单字段校验 → 环境变量；密码类值不进命令行/日志
    const { env: valueEnv, secrets } = validateInstallValues(entry, values);
    const args = entry.kind === 'steam' ? [entry.slug ?? ''] : [];
    const task = taskManager.start({
      kind: 'install',
      title: `安装 ${entry.label}`,
      gameId: entry.gameId,
      file: 'bash',
      args: [script, ...args],
      env: baseEnv(valueEnv),
      secrets,
      timeoutMs: 40 * 60 * 1000,
    });
    res.json({ ok: true, task });
  }));

  return r;
}

export function assertInstallScriptExists(gameId: string): boolean {
  try {
    const p = path.join(CONFIG.scriptsDir, getGameDef(gameId).installScript);
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
