/**
 * 输出打码：任务流（安装等）中的密码类值替换为 ******
 * 1) 显式收集的 secret 值（来自安装向导的密码字段）
 * 2) 通用兜底：KEY=VALUE 且 KEY 含 PASSWORD/PASSWD/SECRET/TOKEN
 */
export function maskText(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s.length >= 4) out = out.split(s).join('******');
  }
  return out.replace(
    /\b([A-Za-z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN)[A-Za-z0-9_]*)=(\S+)/g,
    (_m: string, key: string): string => `${key}=******`,
  );
}
