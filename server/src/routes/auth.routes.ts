import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { badRequest, HttpError } from '../errors.js';
import { rateLimit } from '../auth/ratelimit.js';
import { issueCsrfToken } from '../auth/csrf.js';
import { jwtCookieMaxAgeMs, signToken } from '../auth/jwt.js';
import { TOKEN_COOKIE } from '../auth/middleware.js';
import { getAdminState, rotateStamp, saveAdminState } from '../auth/state.js';
import { h } from './helpers.js';
import type { Response } from 'express';

/**
 * 认证路由：公开部分（status/init/login）+ 私有部分（logout/me/password）。
 * 初始化完成后 init 接口永久 403（注册面收敛为零）。
 */
const credentialsSchema = z
  .object({
    username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/),
    password: z.string().min(8).max(72),
  })
  .strict();

const loginSchema = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(128),
  })
  .strict();

function setAuthCookie(res: Response, token: string, secure: boolean): void {
  res.cookie(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: jwtCookieMaxAgeMs(),
  });
}

function issueSession(res: Response, username: string, secure: boolean): { csrf: string } {
  const stamp = getAdminState().securityStamp;
  const token = signToken(username, stamp);
  setAuthCookie(res, token, secure);
  const csrf = issueCsrfToken(res);
  return { csrf };
}

export function publicAuthRouter(): Router {
  const r = Router();

  r.get('/status', (_req, res) => {
    res.json({ initialized: getAdminState().initialized });
  });

  r.post('/init', h(async (req, res) => {
    if (!rateLimit(`init|${req.ip ?? 'unknown'}`, 10, 5 * 60 * 1000)) {
      throw new HttpError(429, '尝试过于频繁，请 5 分钟后再试');
    }
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('用户名 3-32 位字母数字_.-，密码 8-72 位');
    const st = getAdminState();
    if (st.initialized) throw new HttpError(403, '面板已初始化，注册接口已禁用');
    st.initialized = true;
    st.username = parsed.data.username;
    st.passwordHash = await bcrypt.hash(parsed.data.password, 10);
    st.securityStamp = rotateStamp();
    saveAdminState(st);
    issueSession(res, st.username, req.secure);
    res.json({ ok: true, username: st.username });
  }));

  r.post('/login', h(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('参数不合法');
    const { username, password } = parsed.data;
    const st = getAdminState();
    // 账号+IP 双维度限速，key 定长哈希
    for (const key of [`login|u|${username.toLowerCase()}|${req.ip ?? ''}`, `login|ip|${req.ip ?? ''}`]) {
      if (!rateLimit(key, 10, 5 * 60 * 1000)) {
        throw new HttpError(429, '登录尝试过于频繁，请 5 分钟后再试');
      }
    }
    const userOk = st.initialized && username === st.username;
    const passOk = userOk ? await bcrypt.compare(password, st.passwordHash) : false;
    if (!userOk || !passOk) {
      // 统一失败响应，不区分用户名/密码错误
      throw new HttpError(401, '用户名或密码错误');
    }
    issueSession(res, st.username, req.secure);
    res.json({ ok: true, username: st.username });
  }));

  return r;
}

export function privateAuthRouter(): Router {
  const r = Router();

  r.get('/me', (req, res) => {
    res.json({ username: req.auth?.username ?? '' });
  });

  r.post('/logout', (req, res) => {
    rotateStamp(); // 使所有旧 token（含 SSE 连接）失效
    res.clearCookie(TOKEN_COOKIE, { path: '/' });
    res.clearCookie('panel_csrf', { path: '/' });
    res.json({ ok: true });
  });

  r.post('/password', h(async (req, res) => {
    const schema = z
      .object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(8).max(72) })
      .strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw badRequest('新密码需 8-72 位');
    const st = getAdminState();
    const ok = await bcrypt.compare(parsed.data.currentPassword, st.passwordHash);
    if (!ok) throw new HttpError(401, '当前密码错误');
    st.passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    rotateStamp();
    saveAdminState(st);
    issueSession(res, st.username, req.secure); // 旧会话全部失效，重发新 token
    res.json({ ok: true });
  }));

  return r;
}
