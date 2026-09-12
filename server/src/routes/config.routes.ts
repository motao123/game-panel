import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { CONFIG } from '../config.js';
import { getGameDef } from '../exec/games.js';
import { runCommand } from '../exec/runner.js';
import { baseEnv } from '../util.js';
import { badRequest, notFound } from '../errors.js';
import { h } from './helpers.js';
import { requireAdmin } from '../auth/middleware.js';

const saveSchema = z.object({ content: z.string().max(CONFIG.configMaxBytes) }).strict();

export type ConfigApplyStatus = 'applied' | 'rolled_back' | 'unchanged' | 'no_change_detected';

export interface ConfigApplyResult {
  status: ConfigApplyStatus;
  output: string;
  problemConfigPath: string | null;
  preChangeBackupPath: string | null;
  exitCode: number | null;
}

function tmpDir(): string {
  const dir = path.join(CONFIG.stateDir, 'tmp');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/**
 * config-apply 语义（由 <game>-manager 完成）：备份 → EDITOR 写入 → restart → 15s is-active 轮询 → 失败自动回滚。
 * EDITOR 注入走临时包装脚本 + 环境变量，新内容经 0600 暂存文件传递，绝不拼 shell、不进命令行。
 */
async function runConfigApply(content: string, game: ReturnType<typeof getGameDef>): Promise<ConfigApplyResult> {
  const cfgPath = game.configPath;
  if (!cfgPath) throw badRequest('该游戏没有可编辑配置');

  const dir = tmpDir();
  const token = crypto.randomBytes(6).toString('hex');
  const staged = path.join(dir, `cfg-${game.id}-${token}`);
  const wrapper = path.join(dir, `editor-${game.id}-${token}.sh`);
  await fsp.writeFile(staged, content, { mode: 0o600 });
  await fsp.chmod(staged, 0o600);
  // 包装脚本：把暂存内容写到 manager 传入的目标路径（$1），保留原文件 inode/权限
  const wrapperBody = [
    '#!/bin/bash',
    'set -euo pipefail',
    'target="$1"',
    'cat "$PANEL_CFG_SRC" > "$target"',
    '',
  ].join('\n');
  await fsp.writeFile(wrapper, wrapperBody, { mode: 0o700 });
  await fsp.chmod(wrapper, 0o700);

  try {
    const run = await runCommand(game.manager, ['config-apply'], {
      timeoutMs: 180_000,
      env: baseEnv({ EDITOR: wrapper, PANEL_CFG_SRC: staged }),
    });
    const output = `${run.stdout}\n${run.stderr}`.trim();
    const preChangeBackupPath = /变更前配置:\s*([^\s）)]+)/.exec(output)?.[1] ?? null;
    const problemConfigPath = /问题配置保留[于在]\s*([^\s）)]+)/.exec(output)?.[1] ?? preChangeBackupPath;
    let status: ConfigApplyStatus;
    if (run.failed) status = 'rolled_back';
    else if (/配置未变更/.test(output)) status = 'unchanged';
    else status = 'applied';
    return { status, output: output.slice(-8000), problemConfigPath, preChangeBackupPath, exitCode: run.exitCode };
  } finally {
    await fsp.rm(staged, { force: true });
    await fsp.rm(wrapper, { force: true });
  }
}

/** 配置编辑 + 安全应用（保存即触发 config-apply） */
export function configRouter(): Router {
  const r = Router();

  r.get('/:game/config', h(async (req, res) => {
    const def = getGameDef(req.params.game ?? '');
    if (!def.configPath) throw badRequest('该游戏没有可编辑配置');
    let st: fs.Stats;
    try {
      st = fs.statSync(def.configPath);
    } catch {
      throw notFound('配置文件不存在（未安装？）');
    }
    if (!st.isFile() || st.size > CONFIG.configMaxBytes) throw badRequest('配置文件不可读或超限');
    const content = await fsp.readFile(def.configPath, 'utf8');
    res.json({ path: def.configPath, content, sizeBytes: st.size, mtimeMs: st.mtimeMs });
  }));

  r.put('/:game/config', requireAdmin, h(async (req, res) => {
    const def = getGameDef(req.params.game ?? '');
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('content 非法或超限');
    const result = await runConfigApply(parsed.data.content, def);
    res.json({ ok: result.status !== 'rolled_back', result });
  }));

  return r;
}
