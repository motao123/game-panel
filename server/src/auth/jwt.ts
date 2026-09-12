import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { CONFIG } from '../config.js';
import { ensureStateDir } from './state.js';

const secretFile = path.join(CONFIG.stateDir, 'jwt-secret.key');
let secret: string | null = null;

/** JWT secret：首次启动 crypto.randomBytes 生成，0600 落盘，不进任何日志/命令行/URL */
function loadSecret(): string {
  if (secret) return secret;
  ensureStateDir();
  try {
    const raw = fs.readFileSync(secretFile, 'utf8').trim();
    if (/^[0-9a-f]{96}$/.test(raw)) {
      secret = raw;
      return secret;
    }
  } catch {
    /* 首次生成 */
  }
  const generated = crypto.randomBytes(48).toString('hex');
  const tmp = `${secretFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${generated}\n`, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, secretFile);
  fs.chmodSync(secretFile, 0o600);
  secret = generated;
  return secret;
}

export interface PanelToken {
  sub: string;
  stamp: string;
}

export function signToken(username: string, stamp: string): string {
  return jwt.sign({ sub: username, stamp }, loadSecret(), {
    algorithm: 'HS256',
    expiresIn: `${CONFIG.jwtTtlHours}h`,
  });
}

export function verifyToken(token: string): PanelToken | null {
  try {
    const decoded = jwt.verify(token, loadSecret(), { algorithms: ['HS256'] });
    if (typeof decoded === 'object' && decoded !== null) {
      const p = decoded as jwt.JwtPayload;
      if (typeof p.sub === 'string' && typeof p.stamp === 'string') {
        return { sub: p.sub, stamp: p.stamp };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function jwtCookieMaxAgeMs(): number {
  return CONFIG.jwtTtlHours * 3600 * 1000;
}
