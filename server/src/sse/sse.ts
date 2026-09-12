import type { Request, Response } from 'express';
import { CONFIG } from '../config.js';
import { extractToken, isTokenSessionValid } from '../auth/middleware.js';

export function sseInit(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
}

export function sseSend(res: Response, event: string, data: unknown): void {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export interface SseGuard {
  close: () => void;
}

/**
 * SSE 连接守卫：
 * - 每 CONFIG.sessionGuardIntervalMs 复检会话有效性（securityStamp）——
 *   登出/改密后旧 token 的 SSE 连接自动断开
 * - 15s 心跳注释帧
 * - 连接关闭时回调清理（杀子进程等）
 */
export function attachSseGuards(req: Request, res: Response, onEnd: () => void): SseGuard {
  const token = extractToken(req) ?? '';
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(guard);
    clearInterval(heartbeat);
    onEnd();
    if (!res.writableEnded) res.end();
  };
  const guard = setInterval(() => {
    if (token.length === 0 || !isTokenSessionValid(token)) {
      sseSend(res, 'expired', { message: '会话已失效，连接关闭' });
      close();
    }
  }, CONFIG.sessionGuardIntervalMs);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': hb\n\n');
  }, CONFIG.sseHeartbeatMs);
  res.on('close', close);
  res.on('error', close);
  return { close };
}
