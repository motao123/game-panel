import { Router } from 'express';
import { getGameDef } from '../exec/games.js';
import { listBackups, backupSummary, listGamesStatus } from '../exec/discovery.js';
import { h } from './helpers.js';

/** Dashboard：自动发现已安装游戏 + 运行状态/CPU/内存/端口/最近备份（前端 5 秒轮询） */
export function gamesRouter(): Router {
  const r = Router();

  r.get('/', h(async (_req, res) => {
    const games = await listGamesStatus();
    res.json({ games });
  }));

  r.get('/:game', h(async (req, res) => {
    const def = getGameDef(req.params.game ?? '');
    const games = await listGamesStatus();
    const one = games.find((g) => g.id === def.id);
    if (!one) throw new Error('status unavailable');
    res.json({ game: one });
  }));

  r.get('/:game/backups', h(async (req, res) => {
    const def = getGameDef(req.params.game ?? '');
    const items = await listBackups(def);
    const summary = await backupSummary(def);
    res.json({ items, count: summary.count, backupDir: def.backupDir });
  }));

  return r;
}
