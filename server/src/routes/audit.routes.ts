import { Router } from 'express';
import { readAuditLog } from '../auditlog.js';
import { h, intParam, strQuery } from './helpers.js';

/** 审计页：/var/log/game-server-scripts/audit.log（JSONL）表格 + 筛选 */
export function auditRouter(): Router {
  const r = Router();

  r.get('/', h(async (req, res) => {
    const page = readAuditLog({
      game: strQuery(req.query.game, 40),
      action: strQuery(req.query.action, 60),
      q: strQuery(req.query.q, 120),
      limit: intParam(typeof req.query.limit === 'string' ? req.query.limit : undefined, 200, 1, 1000),
      offset: intParam(typeof req.query.offset === 'string' ? req.query.offset : undefined, 0, 0, 1_000_000),
    });
    res.json(page);
  }));

  return r;
}
