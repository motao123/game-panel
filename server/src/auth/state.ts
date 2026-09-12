import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import { readJsonFile, writeJsonFileAtomic } from '../store.js';
import { randomHex } from '../util.js';

export interface AdminState {
  initialized: boolean;
  username: string;
  passwordHash: string;
  /** 会话印章：登出/改密后轮换，旧 JWT（含 SSE 连接）全部失效 */
  securityStamp: string;
  createdAt: string;
  updatedAt: string;
}

const stateFile = path.join(CONFIG.stateDir, 'panel-state.json');
let cached: AdminState | null = null;

export function getAdminState(): AdminState {
  if (cached) return cached;
  const loaded = readJsonFile<AdminState>(stateFile);
  cached = loaded ?? {
    initialized: false,
    username: '',
    passwordHash: '',
    securityStamp: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return cached;
}

export function saveAdminState(next: AdminState): void {
  next.updatedAt = new Date().toISOString();
  writeJsonFileAtomic(stateFile, next, 0o600);
  cached = next;
}

export function currentStamp(): string {
  return getAdminState().securityStamp;
}

export function rotateStamp(): string {
  const st = getAdminState();
  st.securityStamp = randomHex(32);
  saveAdminState(st);
  return st.securityStamp;
}

/** 状态目录（含临时子目录）初始化 */
export function ensureStateDir(): void {
  fs.mkdirSync(CONFIG.stateDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(CONFIG.stateDir, 'tmp'), { recursive: true, mode: 0o700 });
  fs.chmodSync(CONFIG.stateDir, 0o700);
}
