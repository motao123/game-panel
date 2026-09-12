import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { CONFIG } from './config.js';
import { HttpError } from './errors.js';
import { authenticateToken } from './auth/middleware.js';
import { csrfGuard } from './auth/csrf.js';
import { publicAuthRouter, privateAuthRouter } from './routes/auth.routes.js';
import { gamesRouter } from './routes/games.routes.js';
import { lifecycleRouter } from './routes/lifecycle.routes.js';
import { logsRouter } from './routes/logs.routes.js';
import { backupsRouter } from './routes/backups.routes.js';
import { installRouter } from './routes/install.routes.js';
import { tasksRouter } from './routes/tasks.routes.js';
import { scheduleRouter } from './routes/schedule.routes.js';
import { configRouter } from './routes/config.routes.js';
import { auditRouter } from './routes/audit.routes.js';
import { uninstallRouter } from './routes/uninstall.routes.js';
import type { ZodError } from 'zod';

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
  );
  next();
}

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(cookieParser());
  app.use(securityHeaders);

  // 健康检查：唯一无认证路由（与登录/初始化一起构成公开面）
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'game-panel' });
  });

  const jsonAuth = express.json({ limit: '16kb' });
  const jsonApi = express.json({ limit: '1mb' });

  // 公开认证面：登录/初始化单独 16kb body
  app.use('/api/auth', jsonAuth, publicAuthRouter());

  // —— 以下所有 /api 路由必须认证，非 GET 再过 CSRF 双重提交 ——
  app.use('/api', authenticateToken);
  app.use('/api', csrfGuard);

  app.use('/api/auth', privateAuthRouter());
  app.use('/api', jsonApi);
  app.use('/api/games', gamesRouter());
  app.use('/api/games', lifecycleRouter());
  app.use('/api/games', logsRouter());
  app.use('/api/games', backupsRouter());
  app.use('/api/games', scheduleRouter());
  app.use('/api/games', configRouter());
  app.use('/api/games', uninstallRouter());
  app.use('/api/install', installRouter());
  app.use('/api/tasks', tasksRouter());
  app.use('/api/audit', auditRouter());

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });

  // 前端静态托管（构建产物）+ SPA 回退
  if (fs.existsSync(CONFIG.clientDir)) {
    app.use(express.static(CONFIG.clientDir, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(CONFIG.clientDir, 'index.html'), (err) => {
        if (err) next(err);
      });
    });
  }

  // 统一错误处理
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const zodErr = err as ZodError | undefined;
    if (zodErr && typeof zodErr === 'object' && Array.isArray((zodErr as ZodError).issues)) {
      res.status(400).json({ error: (zodErr as ZodError).issues[0]?.message ?? '参数不合法' });
      return;
    }
    const e = err as { status?: unknown; message?: unknown } | null;
    if (e && typeof e.status === 'number' && e.status >= 400 && e.status < 500) {
      res.status(e.status).json({ error: typeof e.message === 'string' ? e.message : '请求错误' });
      return;
    }
    console.error('[panel] internal error:', err);
    res.status(500).json({ error: '服务器内部错误' });
  });

  return app;
}
