import crypto from 'node:crypto';

/**
 * 登录限速：key 用 sha256 截断定长（不存明文账号/IP）。
 * 默认 账号+IP 双维度 10 次 / 5 分钟。
 */
const buckets = new Map<string, number[]>();
const CLEAN_THRESHOLD = 4096;

export function rateLimit(key: string, max = 10, windowMs = 5 * 60 * 1000): boolean {
  const k = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
  const now = Date.now();
  const arr = (buckets.get(k) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    buckets.set(k, arr);
    return false;
  }
  arr.push(now);
  buckets.set(k, arr);
  if (buckets.size > CLEAN_THRESHOLD) {
    for (const [bk, bv] of buckets) {
      const alive = bv.filter((t) => now - t < windowMs);
      if (alive.length === 0) buckets.delete(bk);
      else buckets.set(bk, alive);
    }
  }
  return true;
}
