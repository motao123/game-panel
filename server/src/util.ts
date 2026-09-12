import crypto from 'node:crypto';

/** 定长比较（先 sha256 归一化长度），避免 timing 泄漏 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const da = crypto.createHash('sha256').update(a).digest();
  const db = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(da, db);
}

/** 输出尾部截断（按字节近似，按字符切） */
export function tail(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `...[截断]${text.slice(text.length - maxChars)}`;
}

export function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/** 输出白名单 env：绝不透传面板自身环境变量（防止 secret 泄漏进子进程） */
export function baseEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: process.env.HOME ?? '/root',
    LANG: 'C.UTF-8',
    TERM: 'dumb',
    DEBIAN_FRONTEND: 'noninteractive',
    NONINTERACTIVE: '1',
    ...extra,
  };
}
