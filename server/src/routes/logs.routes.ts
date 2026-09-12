import { Router } from 'express';
import { getGameDef } from '../exec/games.js';
import { RE_CURSOR, RE_UNIT, assertMatch } from '../exec/validate.js';
import { JournalStream } from '../journal/stream.js';
import { sseInit, sseSend, attachSseGuards } from '../sse/sse.js';
import { h, intParam } from './helpers.js';
import type { Request, Response } from 'express';

/**
 * 日志 SSE：journalctl -u <unit> 实时流
 * - unit 名白名单（正则 + 必须是已知游戏 unit）
 * - 断线游标续传（?cursor= 重连后 --after-cursor 追赶）
 * - 每连接 5s 会话复检 + 15s 心跳
 */
export function logsRouter(): Router {
  const r = Router();

  r.get('/:game/logs/stream', h(async (req: Request, res: Response) => {
    const def = getGameDef(req.params.game ?? '');
    assertMatch(RE_UNIT, def.unit, 'unit 名');
    const cursorRaw = typeof req.query.cursor === 'string' ? req.query.cursor : '';
    let cursor: string | null = null;
    if (cursorRaw.length > 0) {
      assertMatch(RE_CURSOR, cursorRaw, 'cursor');
      cursor = cursorRaw;
    }
    const lines = intParam(typeof req.query.lines === 'string' ? req.query.lines : undefined, 200, 0, 1000);

    sseInit(res);
    if (res.writableEnded) return;
    sseSend(res, 'hello', { unit: def.unit, resuming: cursor !== null });

    let stream: JournalStream | null = null;
    attachSseGuards(req, res, () => {
      if (stream) {
        stream.stop();
        stream = null;
      }
    });
    if (res.writableEnded) return;

    stream = new JournalStream(res, def.unit, cursor, lines);
  }));

  return r;
}
