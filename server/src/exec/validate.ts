import path from 'node:path';
import { badRequest } from '../errors.js';

/** 备份名（允许带 .tar.gz 后缀） */
export const RE_BACKUP_NAME = /^[A-Za-z0-9_-]+(\.tar\.gz)?$/;
/** 计划任务 ID：纯数字 */
export const RE_TASK_ID = /^\d{1,15}$/;
/** systemd unit 名 */
export const RE_UNIT = /^[A-Za-z0-9_.@-]+$/;
/** OnCalendar（无换行/引号/分号） */
export const RE_ON_CALENDAR = /^[A-Za-z0-9*,:/_. -]+$/;
/** journalctl cursor（s=xxx） */
export const RE_CURSOR = /^[A-Za-z0-9_.=-]+$/;
/** 面板游戏 ID */
export const RE_GAME_ID = /^[a-z0-9][a-z0-9_-]{0,40}$/;
/** journalctl --after-cursor 参数 */
export const RE_JOURNAL_ARG = /^[A-Za-z0-9_.=:-]+$/;

export function assertMatch(re: RegExp, value: string, what: string): string {
  if (!re.test(value)) throw badRequest(`${what} 格式非法`);
  return value;
}

/** path.resolve 后断言在白名单目录内（不允许目录本身） */
export function assertWithinDir(rootDir: string, target: string, what: string): string {
  const root = path.resolve(rootDir);
  const abs = path.resolve(target);
  if (abs === root || !abs.startsWith(root + path.sep)) {
    throw badRequest(`${what} 超出允许目录`);
  }
  return abs;
}
