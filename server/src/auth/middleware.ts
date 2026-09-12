import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from './jwt.js';
import { getAdminState } from './state.js';

export interface AuthUser {
  username: string;
  stamp: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthUser;
  }
}

export const TOKEN_COOKIE = 'panel_token';

export function extractToken(req: Request): string | null {
  const hdr = req.headers.authorization;
  if (typeof hdr === 'string' && hdr.startsWith('Bearer ')) {
    const t = hdr.slice(7).trim();
    if (t.length > 0) return t;
  }
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const t = cookies?.[TOKEN_COOKIE];
  return typeof t === 'string' && t.length > 0 ? t : null;
}

/** 解析并校验 token：签名 + securityStamp 与当前状态一致 */
export function resolveAuth(req: Request): AuthUser | null {
  const token = extractToken(req);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  if (payload.stamp !== getAdminState().securityStamp) return null;
  return { username: payload.sub, stamp: payload.stamp };
}

export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const user = resolveAuth(req);
  if (!user) {
    res.status(401).json({ error: '未认证或会话已失效' });
    return;
  }
  req.auth = user;
  next();
}

/** 单管理员模式：已认证即管理员；保留中间件以显式标注高敏路由 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: '未认证' });
    return;
  }
  next();
}

/** SSE 连接复检用：仅校验 token 本身 + stamp（不依赖 req.cookies 刷新） */
export function isTokenSessionValid(token: string): boolean {
  const payload = verifyToken(token);
  if (!payload) return false;
  return payload.stamp === getAdminState().securityStamp;
}
