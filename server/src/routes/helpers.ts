import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** async 路由包装：异常统一交给错误中间件 */
export function h(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

export function sendOk(res: Response, data: unknown): void {
  res.json({ ok: true, ...((data as Record<string, unknown>) ?? {}) });
}

export function intParam(v: string | undefined, def: number, min: number, max: number): number {
  const n = Number.parseInt(v ?? '', 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export function strQuery(v: unknown, maxLen: number): string | undefined {
  if (typeof v !== 'string' || v.length === 0) return undefined;
  return v.slice(0, maxLen);
}
