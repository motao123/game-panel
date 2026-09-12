import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqualStr } from '../util.js';

export const CSRF_COOKIE = 'panel_csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** 下发 CSRF token（双重提交：非 httpOnly Cookie + 请求头回传） */
export function issueCsrfToken(res: Response): string {
  const token = crypto.randomBytes(24).toString('hex');
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: 'strict',
    path: '/',
    maxAge: 7 * 24 * 3600 * 1000,
  });
  return token;
}

/**
 * 非 GET 请求强制 CSRF 双重提交校验。
 * 挂载在 authenticateToken 之后：未认证 → 401，已认证缺头 → 403。
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const cookieToken = cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];
  if (
    typeof cookieToken === 'string' &&
    typeof headerToken === 'string' &&
    cookieToken.length > 0 &&
    timingSafeEqualStr(cookieToken, headerToken)
  ) {
    next();
    return;
  }
  res.status(403).json({ error: 'CSRF 校验失败' });
}
